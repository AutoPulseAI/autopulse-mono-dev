"""Validate (architecture §7): checks every value Extract returned, saves the
good ones, and settles pending confirmations. Plain code.

The four checks, in order:
  1. slot_exists   the path is in slots/schema.py
  2. value_valid   the value passes that slot's validator (slots/validators.py)
  3. quote_found   the quoted words really appear in the customer's message:
                   the AI cannot invent a value it can't point to
  4. confident     confidence >= 0.7; otherwise it's saved as "needs confirming"

Before that: if a value is waiting for confirmation and the customer
answered "yes" / "no", it's confirmed or dropped (no AI involved).

Dates (MASTER_PLAN_2 Phase 8): a date value arrives as the customer's words
("tomorrow"). It's worked out here, in code, against the dealer's local now
(slots/dates.py): a past date is rejected with the reason, an ambiguous one
("next Friday") is saved as needs-confirming, and the timeline slot is set
from the date when the message didn't give one.
"""

import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from upsell_agent import clock
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.nodes.load_context import load_profile
from upsell_agent.agent.qualification import FactSource
from upsell_agent.agent.state import AgentState
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.dates import resolve, timeline_for
from upsell_agent.slots.display import plain_date
from upsell_agent.slots.schema import SCHEMA
from upsell_agent.slots.store import confirm_fact, reject_fact, save_fact
from upsell_agent.slots.validators import known_enum_text
from upsell_agent.slots.validators import validate as validate_value

CONFIDENCE_THRESHOLD = 0.7
# An ambiguous date is always confirmed with the customer.
AMBIGUOUS_DATE_CONFIDENCE = 0.6
_YES = re.compile(r"^\s*(yes|yeah|yep|yup|correct|that'?s (?:right|correct)|right|exactly|sure|affirmative)\b", re.IGNORECASE)
_NO = re.compile(r"^\s*(no|nope|not quite|wrong|incorrect|that'?s not right)\b", re.IGNORECASE)


# PLAN_4 stream Q (seen with gpt-5-mini): "Carvana offered me 24k" was saved as the payoff owed, and the next
# reply asked "Is that your final payoff owed, $24,000?". Someone else's offer for the car is never what they owe.
_OFFER_WORDS = re.compile(r"\b(offer(?:ed|ing|s)?|quote[ds]?|quoting|apprais\w*|carvana|carmax|vroom|kbb|kelley|"
                          r"would give|will give|gave me|worth)\b", re.IGNORECASE)
_OWED_WORDS = re.compile(r"\b(owe[ds]?|owing|payoff|pay off|paid off|loan|balance|financed|left on)\b", re.IGNORECASE)


def offer_not_payoff(path: str, customer_text: str) -> bool:
    """A payoff "value" taken from a message about someone's offer for the car, with nothing about a loan."""
    return path == "trade_in.payoff" and bool(_OFFER_WORDS.search(customer_text or "")) and not _OWED_WORDS.search(
        customer_text or "")


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s$.,/-]", " ", text.lower())).strip()


def run_checks(value: dict[str, Any], customer_text: str) -> dict[str, Any]:
    """The four checks for one extracted value. Returns the checks, the
    normalised value and, if it failed, why."""
    path = value.get("path", "")
    defn = SCHEMA.get(path)
    checks = {"slot_exists": defn is not None, "value_valid": False, "quote_found": False, "confident": False}
    reason, normalised = "", None
    if defn is None:
        reason = f"unknown slot {path!r}"
    else:
        result = validate_value(defn, value.get("value"))
        checks["value_valid"], normalised = result.ok, result.value
        reason = result.reason
    quote = normalise(str(value.get("quote") or ""))
    checks["quote_found"] = bool(quote) and quote in normalise(customer_text)
    checks["confident"] = float(value.get("confidence") or 0) >= CONFIDENCE_THRESHOLD
    if not reason and not checks["quote_found"]:
        reason = "quoted words are not in the customer's message"
    return {"checks": checks, "value": normalised, "reason": reason}


def _dealer_now(state: AgentState) -> datetime:
    zone = ((state.context_pack or {}).get("now") or {}).get("timezone") or "America/New_York"
    return clock.now().astimezone(ZoneInfo(zone))


def _is_iso(value: Any) -> bool:
    try:
        datetime.fromisoformat(str(value))
        return True
    except ValueError:
        return False


def resolve_dates(values: list[dict[str, Any]], now: datetime, timeline_known: bool,
                  reasoning: list[str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Date values in the customer's words → real dates, plus the timeline
    derived from them. Returns (values to check, values rejected here)."""
    out: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    extracted = {v.get("path") for v in values}
    for value in values:
        defn = SCHEMA.get(value.get("path", ""))
        # The real model doesn't always follow "dates go on the date slot": a named
        # month/date can land straight on interest.timeline instead of
        # interest.needed_by ("November" -> interest.timeline). Read it as a date
        # before the plain enum check would otherwise reject it outright.
        if defn is not None and defn.path == "interest.timeline" and defn.kind == "enum" \
                and not known_enum_text(defn, value.get("value")):
            words = str(value.get("quote") or value.get("value") or "")
            found = resolve(words, now)
            if found is not None and not found.ambiguous and found.day >= now.date():
                bucket = timeline_for(found.day, now.date())
                out.append({**value, "value": bucket, "said": words})
                reasoning.append(f"Timeline: {words!r} → {bucket.replace('_', ' ')} ({found.note}).")
                continue
            out.append(value)
            continue
        if defn is None or defn.kind != "date" or _is_iso(value.get("value")):
            out.append(value)
            continue
        words = str(value.get("value") or value.get("quote") or "")
        found = resolve(words, now) or resolve(str(value.get("quote") or ""), now)
        if found is None:
            rejected.append({**value, "checks": {}, "reason": f"couldn't work out a date from {words!r}"})
            reasoning.append(f"✗ {value['path']}: couldn't work out a date from {words!r}")
            continue
        if found.day < now.date():
            reason = f"{words!r} is in the past ({plain_date(found.day)})"
            rejected.append({**value, "checks": {}, "reason": reason})
            reasoning.append(f"✗ {value['path']}: {reason}")
            continue
        confidence = float(value.get("confidence") or 0)
        if found.ambiguous:
            confidence = min(confidence, AMBIGUOUS_DATE_CONFIDENCE)
        resolved = {**value, "value": found.iso(), "confidence": confidence, "said": words}
        out.append(resolved)
        reasoning.append(f"Date: {words!r} → {plain_date(found.value, now.date())} ({found.note}"
                         + ("; to confirm" if found.ambiguous else "") + ")")
        # An ambiguous date sets the timeline only once the customer confirms it
        # (below): otherwise we'd be checking a timeline instead of the date.
        if not timeline_known and "interest.timeline" not in extracted and not found.ambiguous:
            bucket = timeline_for(found.day, now.date())
            out.append({"path": "interest.timeline", "value": bucket, "quote": value.get("quote"),
                        "confidence": confidence, "derived_from": value["path"]})
            reasoning.append(f"Timeline set from that date: {bucket.replace('_', ' ')}.")
    return out, rejected


_VISIT_DAY_PATHS = {"interest.needed_by", "interest.timeline"}


def _visit_day_reply(state: AgentState, extraction: dict[str, Any], text: str) -> bool:
    """The message names a day (no time) to come in: answering the times we just offered, or asking to
    visit (MASTER_PLAN_3 B5 day requests)."""
    from upsell_agent.agent.conversation import ConversationState
    from upsell_agent.agent.visit_offer import declines_visit, wants_visit
    from upsell_agent.tools.booking_tool import day_without_time

    conversation = ConversationState.model_validate((state.context_pack or {}).get("conversation") or {})
    if declines_visit(extraction) or not (conversation.awaiting_visit_pick or wants_visit(extraction)):
        return False
    return day_without_time(text or "", _dealer_now(state)) is not None


async def validate(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    # The customer's own words: a quoted earlier email doesn't count.
    text = state.customer_text or state.inbound_text
    extraction = state.extraction or {}
    extracted_paths = {v.get("path") for v in extraction.get("values", [])}
    accepted, needs_confirming, confirmed, dropped = [], [], [], []
    reasoning: list[str] = []

    # Settle a pending confirmation first, from a plain yes / no.
    pending = [s for s in (state.profile or {}).get("slots", []) if s["state"] == "needs_confirming"]
    for slot in pending[:1]:
        fact = next((f for f in await _pending_fact_ids(ctx, state) if f["path"] == slot["path"]), None)
        if not fact or slot["path"] in extracted_paths:
            continue
        if _YES.search(text):
            await confirm_fact(ctx.db, fact["id"])
            confirmed.append(slot["path"])
            reasoning.append(f"✓ Customer confirmed {slot['label']} = {slot['value']!r}.")
            await _timeline_from_confirmed_date(ctx, state, slot, reasoning)
        elif _NO.search(text):
            await reject_fact(ctx.db, fact["id"])
            dropped.append(slot["path"])
            reasoning.append(f"✗ Customer said {slot['label']} = {slot['value']!r} is wrong; it will be asked again.")

    timeline_known = any(s["path"] == "interest.timeline" and s["state"] == "filled"
                         for s in (state.profile or {}).get("slots", []))
    raw_values = list(extraction.get("values", []))
    if _visit_day_reply(state, extraction, text):
        # "Not Wednesday, what about Monday?" answering our visit times names the day they'd come in, not
        # when they need the car: it isn't saved as a needed-by date or a timeline (Decide offers that day).
        skipped = [v for v in raw_values if v.get("path") in _VISIT_DAY_PATHS]
        raw_values = [v for v in raw_values if v.get("path") not in _VISIT_DAY_PATHS]
        reasoning += [f"Not saved: {v.get('path')} = {v.get('value')!r} is the day they'd visit, not a deadline."
                      for v in skipped]
    values, rejected = resolve_dates(raw_values, _dealer_now(state), timeline_known, reasoning)
    for value in values:
        outcome = run_checks(value, text)
        item = {**value, "checks": outcome["checks"]}
        checks = outcome["checks"]
        if checks["slot_exists"] and offer_not_payoff(str(value.get("path")), text):
            outcome["reason"] = "an offer for their car from someone else, not what they owe on it"
            checks["value_valid"] = False
        if not (checks["slot_exists"] and checks["value_valid"] and checks["quote_found"]):
            rejected.append({**item, "reason": outcome["reason"]})
            reasoning.append(f"✗ {value.get('path')} rejected: {outcome['reason']}")
            continue
        confident = checks["confident"]
        await save_fact(ctx.db, customer_id=state.customer_id, lead_id=state.lead_id, path=value["path"],
                        value=outcome["value"], source=FactSource.BOT_EXTRACTED,
                        source_message_id=ctx.source_message_id, quote=value.get("quote"),
                        confidence=value.get("confidence"), pending=not confident, turn_id=state.turn_id)
        item["value"] = outcome["value"]
        (accepted if confident else needs_confirming).append(item)
        reasoning.append(f"{'✓' if confident else '?'} {value['path']} = {outcome['value']!r} "
                         + ("saved" if confident else f"saved, needs confirming (confidence {value.get('confidence')})"))

    profile = await load_profile(ctx, state)
    validation = {"accepted": accepted, "needs_confirming": needs_confirming, "rejected": rejected,
                  "confirmed": confirmed, "dropped": dropped}
    span.output = validation
    span.reasoning = reasoning or ["Nothing to validate."]
    span.edge_label = f"{len(accepted)} ok · {len(needs_confirming)} ? · {len(rejected)} ✗"
    return {"validation": validation, "profile": profile.to_api()}


async def _timeline_from_confirmed_date(ctx: TurnContext, state: AgentState, slot: dict[str, Any],
                                        reasoning: list[str]) -> None:
    """A date the customer just confirmed also sets the timeline, if we don't have one."""
    defn = SCHEMA.get(slot["path"])
    profile = {s["path"]: s for s in (state.profile or {}).get("slots", [])}
    if defn is None or defn.kind != "date" or not defn.volunteered or \
            profile.get("interest.timeline", {}).get("state") == "filled":
        return
    today = _dealer_now(state).date()
    day = datetime.fromisoformat(str(slot["value"])).date()
    bucket = timeline_for(day, today)
    await save_fact(ctx.db, customer_id=state.customer_id, lead_id=state.lead_id, path="interest.timeline",
                    value=bucket, source=FactSource.BOT_EXTRACTED, source_message_id=ctx.source_message_id,
                    quote=slot.get("quote"), confidence=0.9, pending=False, turn_id=state.turn_id)
    reasoning.append(f"Timeline set from the confirmed date: {bucket.replace('_', ' ')}.")


async def _pending_fact_ids(ctx: TurnContext, state: AgentState) -> list[dict[str, str]]:
    profile = await load_profile(ctx, state)
    return [{"path": s.path, "id": s.fact_id} for s in profile.pending()]
