"""Decide: picks exactly one next step (architecture §8.3, MASTER_PLAN_2
Phase 5). A pure function: the same profile, conversation state and
extraction always give the same answer.

Rules, checked in order; the first that applies wins:
  1. stop              the customer opted out
  2. handoff           they asked for a person, are clearly upset, sound
                       urgent, or declined a visit 3 times with a staff-only
                       question still open (MASTER_PLAN_3 B4 item 8)
  3. clarify           they asked what our last message meant: re-explain it
  4. answer            they have questions: answer first, then at most one
                       follow-up (a visit offer or a confirmation, and an
                       ask - unless a visit is still pending, see below)
  5. confirm           a value is waiting for confirmation (plus one ask)
  6. offer_visit       a visit can be offered (nothing else this reply,
                       decision 107 revised) - MASTER_PLAN_3 B4: every
                       qualified or partly-qualified lead is offered a
                       visit before anything is passed to staff
  7. ask               a required detail can be asked (two per message)
  8. qualified         nothing missing
  9. partly_qualified  every detail still missing has been asked twice: hand
                       what we have to the team, and stop asking
  10. acknowledge      nothing to ask right now: reply without a question

At most MAX_ASKS_PER_MESSAGE questions per message (MASTER_PLAN_3 Bq,
architecture §15 decision 35): a confirmation counts as one.

Asking (architecture §15, decision 13): the least-asked detail first; never the detail our last message
asked for; a detail asked twice is parked until 3 other replies have gone out;
a customer frustrated with the conversation is asked nothing; a lead already
handed on as partly qualified is asked nothing again. The send check can hold
questions too (MASTER_PLAN_3 C1): a possible opt-out gets a plain reply with
no asks and no confirmations, and so does a reply in an outbound conversation
outside 8:00-21:00 customer time (architecture §15 decision 29). So does the
after-hours choice (MASTER_PLAN_3 B1, agent/after_hours.py): a reply that
offers "now or when we open?" has that as its only question, and the
thank-you after "later" asks nothing.

Every rule's result is returned too, so the Debug UI can show why.
"""

from dataclasses import dataclass, field
from typing import Any

from upsell_agent.agent.pipeline import DECIDE_RULES
from upsell_agent.slots.display import display_value
from upsell_agent.slots.profile import Profile
from upsell_agent.slots.requirements import Requirement
from upsell_agent.slots.schema import SCHEMA

# Questions per message, a confirmation included (MASTER_PLAN_3 Bq, decision 35).
MAX_ASKS_PER_MESSAGE = 2
MAX_ASKS_PER_SLOT = 2
# A parked detail can be asked again once this many other replies have gone out.
PARKED_FOR_REPLIES = 3
# Upset is a handoff signal only when this sure (MASTER_PLAN_2 Phase 4): one
# ambiguous message isn't enough. Frustration with the bot itself never is.
UPSET_HANDOFF_CONFIDENCE = 0.8
# Urgent is a handoff signal at the same bar (MASTER_PLAN_3 B0.13 decision 26, built in B4 item 8).
URGENT_HANDOFF_CONFIDENCE = 0.8


@dataclass
class Flags:
    opted_out: bool = False
    wants_human: bool = False
    upset: bool = False
    upset_confidence: float = 0.0
    annoyed_at_bot: bool = False
    # {text, label} per question still to answer (agent/conversation.py).
    questions: list[dict[str, str]] = field(default_factory=list)
    # From the conversation state: per slot (times asked, reply it was last
    # asked in), what the last reply asked, and how many replies have gone out.
    asks: dict[str, tuple[int, int]] = field(default_factory=dict)
    last_asked: list[str] = field(default_factory=list)
    replies: int = 0
    # The lead's status: already qualified / handed on as partly qualified.
    already_qualified: bool = False
    stop_asking: bool = False
    # Why this reply must ask nothing at all (a possible opt-out, quiet hours).
    hold_questions: str | None = None
    # The after-hours choice this reply carries (agent/after_hours.py): "offer" (the
    # choice is the only question) or "later" (a thank-you, nothing asked).
    contact_choice: str | None = None
    # Urgent-need signals (MASTER_PLAN_3 B0.13 decision 26, agent/nodes/decide.py): Extract's
    # `urgent`/`urgent_confidence`, or the pure-code 48h `needed_by` backstop.
    urgent: bool = False
    urgent_confidence: float = 0.0
    # The visit offer Decide should carry this turn (agent/visit_offer.py's VisitOfferPlan,
    # only when it fires), or None. MASTER_PLAN_3 B4.
    visit_offer: dict[str, Any] | None = None
    # 3rd decline with a staff-only question still open (agent/visit_offer.py, B4 item 8).
    visit_handoff: bool = False
    # A visit offer is live this turn (visit_offer above) or still awaiting the customer's
    # pick from last turn (conversation.awaiting_visit_pick, incl. the one-reply hold-over).
    # While true, a reply stays on the visit topic: no bonus slot-ask stacked alongside it
    # (architecture §15 decision 107, revised: a customer mid-conversation about the offer
    # got a trade-in question shoved in with it - confusing, not "strike while the iron's hot").
    visit_pending: bool = False

    @property
    def clearly_upset(self) -> bool:
        return self.upset and self.upset_confidence >= UPSET_HANDOFF_CONFIDENCE

    @property
    def clearly_urgent(self) -> bool:
        return self.urgent and self.urgent_confidence >= URGENT_HANDOFF_CONFIDENCE


def _unfilled(profile: Profile, requirement: Requirement) -> list[str]:
    if requirement.mode == "any":
        return list(requirement.slots)
    return [p for p in requirement.slots if not profile.is_current(p)]


def times_asked(profile: Profile, requirement: Requirement, flags: Flags) -> int:
    return max(flags.asks.get(p, (0, 0))[0] for p in _unfilled(profile, requirement))


def ask_block(profile: Profile, requirement: Requirement, flags: Flags) -> str | None:
    """Why this requirement can't be asked now, or None if it can."""
    slots = _unfilled(profile, requirement)
    if any(p in flags.last_asked for p in slots):
        return "asked in our last message"
    history = [flags.asks.get(p, (0, 0)) for p in slots]
    times = max(count for count, _ in history)
    last = max(turn for _, turn in history)
    if times >= MAX_ASKS_PER_SLOT and flags.replies - last < PARKED_FOR_REPLIES + 1:
        return f"parked: asked {times} times, last in reply #{last}"
    return None


def _ask_item(profile: Profile, requirement: Requirement) -> dict[str, Any]:
    return {"requirement": requirement.id, "label": requirement.label, "slots": _unfilled(profile, requirement),
            "hint": requirement.ask_hint, "question": requirement.customer_question,
            "explanation": requirement.explanation}


def next_action(profile: Profile, flags: Flags) -> dict[str, Any]:
    pending = profile.pending()
    missing = profile.missing()
    filled, total = profile.progress()
    clarify_questions = [q for q in flags.questions if q.get("label") == "clarify"]
    other_questions = [q for q in flags.questions if q.get("label") != "clarify"]

    blocked = {r.id: ask_block(profile, r, flags) for r in missing}
    # "Asked out": every missing detail has had its two asks. Checked without the
    # cooldown, so a customer who never answers isn't asked round and round forever.
    all_parked = bool(missing) and all(times_asked(profile, r, flags) >= MAX_ASKS_PER_SLOT for r in missing)
    held = flags.hold_questions or flags.contact_choice
    may_ask = not flags.annoyed_at_bot and not flags.stop_asking and not all_parked and not held
    if held:
        pending = []
    # Least-asked first, then by priority: every detail gets its first ask, then
    # its second, before anything is asked a third time.
    confirming = {pending[0].path} if pending else set()
    askable = sorted((r for r in missing if blocked[r.id] is None and not confirming & set(r.slots)),
                     key=lambda r: (times_asked(profile, r, flags), r.priority)) if may_ask else []

    conditions: dict[str, tuple[bool, str]] = {
        "stop": (flags.opted_out, "Customer opted out"),
        "handoff": (flags.wants_human or flags.clearly_upset or flags.clearly_urgent or flags.visit_handoff,
                    "Customer asked for a person" if flags.wants_human
                    else f"Customer is clearly upset (confidence {flags.upset_confidence:.2f})" if flags.clearly_upset
                    else f"Customer sounds urgent (confidence {flags.urgent_confidence:.2f})" if flags.clearly_urgent
                    else "Declined a visit 3 times and a staff-only question is still open"),
        "clarify": (bool(clarify_questions and flags.last_asked),
                    f"Asked what we meant: {clarify_questions[0]['text']!r}" if clarify_questions else ""),
        "answer": (bool(other_questions or clarify_questions),
                   f"{len(other_questions or clarify_questions)} question(s) to answer"),
        "confirm": (bool(pending), f"Confirm {SCHEMA[pending[0].path].label}: {pending[0].value!r}" if pending else ""),
        "offer_visit": (bool(flags.visit_offer),
                        flags.visit_offer.get("why", "Offering a visit") if flags.visit_offer else ""),
        "ask": (bool(askable), "Missing: " + ", ".join(r.label for r in askable[:MAX_ASKS_PER_MESSAGE])
                if askable else ""),
        "qualified": (not missing and not flags.already_qualified, f"All {total} required details collected"),
        "partly_qualified": (all_parked and not flags.stop_asking,
                             "Everything still missing was asked twice: "
                             + ", ".join(r.label for r in missing) if missing else ""),
        "acknowledge": (True, "Nothing to ask right now"),
    }

    rules, fired = [], None
    for rule in DECIDE_RULES:
        hit, why = conditions[rule["id"]]
        if fired is None and hit:
            fired = rule["id"]
            rules.append({"id": rule["id"], "result": "fired", "why": why})
        else:
            rules.append({"id": rule["id"], "result": "skipped" if fired else "no", "why": ""})

    decision: dict[str, Any] = {
        "action": fired,
        "answer_questions": [],
        "annoyed_at_bot": flags.annoyed_at_bot,
        "hold_questions": flags.hold_questions,
        "rules": rules,
        "required_total": total,
        "required_filled": filled,
        "lead_type": profile.lead_type.value,
        "effective_lead_type": profile.effective_lead_type.value,
        "slots": [],
        "asks": [],
        "not_asked": [{"label": r.label, "why": blocked[r.id]} for r in missing if blocked[r.id]],
    }

    def add_confirm() -> None:
        slot = pending[0]
        decision["slots"].append(slot.path)
        decision["confirm"] = {"path": slot.path, "label": SCHEMA[slot.path].label, "value": slot.value,
                               "display": display_value(SCHEMA[slot.path], slot.value), "kind": SCHEMA[slot.path].kind,
                               "fact_id": slot.fact_id}

    def add_visit_offer() -> None:
        decision["visit_offer"] = flags.visit_offer

    def add_asks() -> None:
        room = MAX_ASKS_PER_MESSAGE - (1 if ("confirm" in decision or "visit_offer" in decision) else 0)
        decision["asks"] = [_ask_item(profile, r) for r in askable[:room]]
        for item in decision["asks"]:
            decision["slots"] += [p for p in item["slots"] if p not in decision["slots"]]

    if fired == "clarify":
        # One entry per distinct question (year, make and model share one).
        items: list[dict[str, str]] = []
        for p in flags.last_asked:
            if p in SCHEMA and all(i["question"] != SCHEMA[p].customer_question for i in items):
                items.append({"path": p, "label": SCHEMA[p].label, "hint": SCHEMA[p].ask_hint,
                              "question": SCHEMA[p].customer_question, "explanation": SCHEMA[p].explanation})
        decision["clarify"] = {"items": items}
        decision["answer_questions"] = clarify_questions + other_questions
    elif fired == "answer":
        decision["answer_questions"] = other_questions or clarify_questions
        # At most two follow-up questions after the answers, never when they're frustrated with us.
        # A visit offer takes the bonus-question slot a confirmation would otherwise take (architecture
        # §15 decision 107).
        if flags.visit_offer and not flags.annoyed_at_bot:
            add_visit_offer()
        elif pending and not flags.annoyed_at_bot:
            add_confirm()
        # ...but never on top of a visit still pending (decision 107, revised): the reply stays
        # on the visit topic until it's resolved, instead of also opening a new required slot.
        if not flags.visit_pending:
            add_asks()
    elif fired == "confirm":
        add_confirm()
        add_asks()
    elif fired == "offer_visit":
        # The offer is the whole reply now (decision 107, revised): no bonus slot-ask stacked
        # alongside it, so the customer isn't answering two unrelated things at once.
        add_visit_offer()
    elif fired == "ask":
        add_asks()
    return decision
