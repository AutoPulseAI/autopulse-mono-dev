"""Extract (architecture §7): the AI reads the customer's words and returns
typed slot values, each with the exact words it came from and a confidence.
It does not decide anything; Validate checks every value.

Cheap model (MODEL_EXTRACT), 3-second limit, one call. Any failure routes
the turn to the template (architecture §7: a limit sends the template,
never nothing).
"""

import re
from typing import Any

from upsell_agent.agent.context import AiBudgetExceeded, TurnContext
from upsell_agent.agent.context_pack import HELD_FROM_MODELS
from upsell_agent.agent.llm import extract_agent, run_agent
from upsell_agent.agent.state import AgentState
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.schema import SCHEMA, SLOTS

OUTPUT_TOKENS = 500


# The answer to "now, or when we open?" (MASTER_PLAN_3 B1). Offered to the model
# like a slot while our last message asked it (models reliably fill values;
# a separate field was often skipped), then moved out of the values: it is
# never saved as a slot.
CONTACT_PREFERENCE = "contact_preference"
CONTACT_PREFERENCE_SLOT = {"path": CONTACT_PREFERENCE, "label": "Talk now, or when the dealership opens",
                           "kind": "enum", "choices": ["now", "later"]}


def _allowed_slots(awaiting_contact_choice: bool = False) -> list[dict[str, Any]]:
    slots = [{"path": s.path, "label": s.label, "kind": s.kind, "choices": list(s.choices)}
             for s in SLOTS if s.extractable]
    return [*slots, CONTACT_PREFERENCE_SLOT] if awaiting_contact_choice else slots


def extract_payload(state: AgentState) -> dict[str, Any]:
    """What Extract is given: the new messages to read, and the same context
    pack Compose gets, for understanding them (MASTER_PLAN_2 Phase 1)."""
    pack = state.context_pack or {}
    # Our last message asked "now, or when we open?" (MASTER_PLAN_3 B1).
    awaiting = bool((pack.get("conversation") or {}).get("awaiting_contact_choice"))
    return {
        "customer_text": state.customer_text or state.inbound_text,
        "lead_type": (state.profile or {}).get("effective_lead_type") or "general",
        "allowed_slots": _allowed_slots(awaiting),
        "recently_asked": (pack.get("conversation") or {}).get("last_asked", []),
        # Client, 13 Oct 2026 (Artem: "About what time will you arrive?" -> "520" was read as a $520 budget): the
        # question the customer is answering, word for word, whoever wrote it.
        "our_last_message": next((m.get("text") for m in reversed(pack.get("working_memory") or [])
                                  if m.get("direction") == "outbound" and m.get("text")), None),
        "awaiting_contact_choice": awaiting,
        "context": {k: v for k, v in pack.items() if k not in HELD_FROM_MODELS},
    }


async def extract(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    model = ctx.settings.model_extract
    payload = extract_payload(state)
    span.metrics = {"model": model}
    try:
        ctx.spend_ai_call()
        result, call = await run_agent(extract_agent(model), model, payload,
                                       timeout_s=ctx.settings.extract_timeout_s, output_tokens_limit=OUTPUT_TOKENS)
    except TimeoutError:
        return _failed(span, f"no answer within {ctx.settings.extract_timeout_s}s")
    except AiBudgetExceeded as exc:
        return _failed(span, str(exc))
    except Exception as exc:  # noqa: BLE001 - any model/provider error sends the template
        return _failed(span, f"{type(exc).__name__}: {exc}")

    extraction = result.model_dump()
    lift_contact_preference(extraction, awaiting=payload["awaiting_contact_choice"])
    lift_wants_visit(extraction)
    drop_values_of_the_wrong_kind(extraction, payload["customer_text"] or "", payload.get("our_last_message"))
    ctx.model_calls.append({"step": "extract", **call.as_metrics()})
    from upsell_agent.agent.visit_offer import ANSWER_THEN_ASK
    if extraction.get("annoyed_at_bot") and str(extraction.get("visit_objection") or "") in ANSWER_THEN_ASK:
        # Eval, 22 Oct 2026 (Betsy's credit example): "I'm not trying to waste my time if I can't get approved" is a
        # worry about the deal, answered and asked again - not annoyance with the AI ("I won't keep bugging you").
        extraction["annoyed_at_bot"] = False
    span.output = extraction
    span.metrics = call.as_metrics()
    span.reasoning = [
        f"'{v['quote']}' → {v['path']} ({SCHEMA[v['path']].label if v['path'] in SCHEMA else 'unknown slot'}) = "
        f"{v['value']!r}, confidence {v['confidence']:.2f}"
        for v in extraction["values"]
    ] or ["No slot values in the message."]
    for question in extraction["questions"]:
        span.reasoning.append(f"Question ({question['label'].replace('_', ' ')}): \"{question['text']}\"")
    if extraction["wants_human"]:
        span.reasoning.append("The customer asked for a person.")
    if extraction["upset"]:
        span.reasoning.append(f"The customer sounds upset (confidence {extraction['upset_confidence']:.2f}).")
    if extraction["annoyed_at_bot"]:
        span.reasoning.append("The customer is frustrated with this conversation: change approach, don't hand off.")
    if extraction.get("contact_preference"):
        span.reasoning.append(f"Answer to \"now or when we open?\": {extraction['contact_preference']}.")
    if extraction.get("wants_visit"):
        span.reasoning.append(f"Asks to visit (confidence {extraction.get('wants_visit_confidence', 0):.2f}).")
    n = len(extraction["values"])
    span.edge_label = f"{n} value{'s' if n != 1 else ''} found"
    return {"extraction": extraction}


# What our last message asked for, by its words -> the only kind of value a short answer can be (None: a clock time,
# which is never a slot - the booking reads it).
_ASKED_KIND = [
    (re.compile(r"\bwhat time\b|\bwhen will you (?:arrive|be here|get here)\b|\bwhat time works\b", re.IGNORECASE), None),
    (re.compile(r"\bmiles?\b|\bmileage\b|\bodometer\b", re.IGNORECASE), "mileage"),
    (re.compile(r"\bwhat year\b|\byear is\b", re.IGNORECASE), "year"),
    (re.compile(r"\bspend\b|\bbudget\b|\bpayment\b|\bper month\b|\ba month\b|\bhow much\b|\bdown\b", re.IGNORECASE), "money"),
]


_SAID_KIND = [
    ("money", re.compile(r"\$|\b(?:a|per) month\b|/\s*mo\b|\bmonthly\b|\bbudget\b|\bdown\b|\bpayment\b|\bdollars?\b|"
                         r"\bbucks\b|\bcash\b", re.IGNORECASE)),
    ("mileage", re.compile(r"\bmiles?\b|\bmi\b|\bmileage\b|\bodometer\b", re.IGNORECASE)),
    ("year", re.compile(r"\b(?:19[89]\d|20[0-3]\d)\b")),
]


def drop_values_of_the_wrong_kind(extraction: dict[str, Any], text: str, asked: str | None) -> None:
    """Client, 13 Oct 2026 (Artem answered "About what time will you arrive?" with "520" and the AI then spoke of
    "your $520-a-month target"; "it should understand the answer from the conversation"): a short reply is what our
    last message asked for. A value of another kind (money for a time, a budget for miles) is dropped, whatever the
    model said."""
    said = (text or "").strip()
    if not said or len(said.split()) > 4 or not asked or not re.search(r"\d", said):
        return  # only a number can be misread as another kind of number; words ("in red") always stay
    kinds = {k for pattern, k in _ASKED_KIND if pattern.search(asked)}
    if len(kinds) != 1:
        return  # nothing recognised, or several things asked at once ("what year, and how many miles?")
    kind = kinds.pop()
    # Only stored facts are checked: what isn't a slot (visit_when - the time the booking reads) always stays.
    numeric = {"money", "mileage", "year"}
    # Their own words can say what the number is ("around 500 a month" is money whatever we asked - George, 16 Oct).
    stated = {k for k, pattern in _SAID_KIND if pattern.search(said)}
    extraction["values"] = [v for v in extraction.get("values", [])
                            if v.get("path") not in SCHEMA or SCHEMA[v["path"]].kind not in numeric
                            or SCHEMA[v["path"]].kind in ({kind} | stated)]


def lift_wants_visit(extraction: dict[str, Any]) -> None:
    """A model sometimes lists `wants_visit` as a slot value too (seen live, 1
    Oct, alongside the real `wants_visit` field): it isn't a real slot, so
    Validate would reject it as "unknown slot". Strip it, and let it back the
    field when the model hadn't already set it there."""
    found = [v for v in extraction.get("values", []) if v.get("path") == "wants_visit"]
    if not found:
        return
    extraction["values"] = [v for v in extraction["values"] if v.get("path") != "wants_visit"]
    if not extraction.get("wants_visit") and found[0].get("value"):
        extraction["wants_visit"] = True
        extraction["wants_visit_confidence"] = max(extraction.get("wants_visit_confidence") or 0.0,
                                                    float(found[0].get("confidence") or 0.0))


def lift_contact_preference(extraction: dict[str, Any], *, awaiting: bool) -> None:
    """Moves the `contact_preference` value out of the slot values into its own
    field (None when there's none, or our last message didn't ask). It is
    never a slot, so it never reaches Validate."""
    found = [v for v in extraction.get("values", []) if v.get("path") == CONTACT_PREFERENCE]
    extraction["values"] = [v for v in extraction.get("values", []) if v.get("path") != CONTACT_PREFERENCE]
    value = str(found[0].get("value") or "").strip().lower() if found else ""
    extraction[CONTACT_PREFERENCE] = value if awaiting and value in ("now", "later") else None


def _failed(span: NodeSpan, reason: str) -> dict[str, Any]:
    span.output = {"error": reason, "values": []}
    span.reasoning = [f"Extract failed: {reason}. Sending the template instead."]
    span.edge_label = "failed"
    return {"extraction": {"error": reason, "values": [], "questions": [], "wants_human": False, "upset": False,
                           "upset_confidence": 0.0, "annoyed_at_bot": False, "possible_opt_out": False,
                           "opt_out_confidence": 0.0},
            "fallback_reason": f"extract failed: {reason}"}
