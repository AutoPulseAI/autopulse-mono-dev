"""The after-hours first reply (MASTER_PLAN_3 B1, architecture §15 decisions
56-57): a new inbound lead that arrives while the dealership is closed is
asked whether to carry on now or have the team pick it up when it opens.

A pure function of the turn: what triggered it, the lead's origin, whether the
dealer is open (the context pack's `now` layer), the conversation state's
`after_hours` record and what Extract read. Decide calls it; the turn (after
the send) records the choice and schedules or cancels the morning message.

Rules (agreed with the user, 29 Sept):

- **Offer** on the first reply of an inbound lead (a lead form or the
  customer's first text/email), only while the dealer is closed. The reply
  answers what they wrote and ends with the choice instead of any ask.
  Outbound leads never get it (decision 29's quiet-hours rule covers them).
  "Now" really means now at any hour (decision 56).
- **Every closed period on its own** (client, 8 Oct 2026): a customer who writes while the dealer is
  closed - a new lead or a conversation already going, whatever its origin - is asked once for that closed
  period. An answer from an earlier night doesn't carry over (`period` = the next opening it was given for).
- **No answer = wait** (client, 8 Oct 2026): offering the choice also plans the morning message, so a
  customer who never answers is picked up when the dealer opens and gets nothing before. "Now" (or a
  visit request, or anything but a plain acknowledgement) cancels it and carries on; "later" keeps it.
- **Answer to the offer:** "later" → a short thank-you, no questions, and the
  `resume_at_opening` follow-up at the next opening. "now", a visit request,
  or anything else (the customer ignored the choice) → the normal
  conversation carries on, and the choice is never offered again.
- **The customer writes again after "later", while still closed:** answer
  them and offer the choice again (every time). "later" again → keep waiting;
  "now", a visit request, or ignoring the re-offer → the conversation
  carries on and the morning message is cancelled.
- **The dealer has opened** by the time the customer answers or writes: the
  choice is about the dealer's hours, so it no longer applies: the
  conversation carries on and any pending morning message is cancelled.
- A visit request (Extract's `wants_visit`) is never met with the choice. The
  booking itself is MASTER_PLAN_3 B5; until then the reply carries on as usual.
- **A plain acknowledgement while closed** ("ok", "thanks", "sounds good", nothing
  else in the message) is a no-op: not an answer, not "ignoring the choice". It
  never gets a re-offer, never flips the choice to "now", and the state doesn't
  change. Agreed with the user 1 Oct, after a live test showed the choice being
  re-offered (with a repeated greeting) on a bare "ok".
"""

import re
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Literal

from upsell_agent.agent.conversation import ConversationState

# Extract's wants_visit counts at this confidence (our default: the same bar as upset).
WANTS_VISIT_CONFIDENCE = 0.8
TRIGGER_RESUME = "resume_at_opening"
FIRST_CONTACT_TRIGGERS = ("lead_created", "inbound_message")

Mode = Literal["offer", "later", "resume"]

# A short "ok" / "thanks" and nothing else: not a real answer to anything
# (agreed with the user, 1 Oct). The whole (stripped) message must match.
_PLAIN_ACK = re.compile(
    r"^(ok(?:ay)?|k|kk|sure|sure thing|sounds good|sounds great|great|perfect|cool|alright|all right|"
    r"got it|gotcha|no problem|np|thanks|thank you|ty|yep|yup|yeah|will do|noted|understood|"
    r"appreciate it|appreciated)[\s.!,]*$", re.IGNORECASE)


def is_plain_acknowledgement(text: str) -> bool:
    """The whole message is a short ack, nothing else: it isn't answering the
    after-hours choice, and isn't "ignoring" it either."""
    return bool(_PLAIN_ACK.match(text.strip()))


@dataclass
class AfterHoursPlan:
    # offer: end the reply with the choice; later: thank-you, no questions;
    # resume: the morning message; None: nothing after-hours about this reply.
    mode: Mode | None = None
    # The conversation state's after_hours record once this reply goes out (None: unchanged).
    record: dict[str, Any] | None = None
    schedule_resume: bool = False
    cancel_resume: bool = False
    why: str = ""
    # When the dealership opens next, as the customer reads it ("9:00 AM tomorrow"); None
    # when the dealer has no hours on record (default hours are never told to a customer).
    opens_at: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def wants_visit(extraction: dict[str, Any]) -> bool:
    return bool(extraction.get("wants_visit")) and float(
        extraction.get("wants_visit_confidence") or 0.0) >= WANTS_VISIT_CONFIDENCE


def plan_after_hours(
    *,
    trigger: str,
    origin: str | None,
    now: dict[str, Any],
    conversation: ConversationState,
    extraction: dict[str, Any],
    at: datetime,
    text: str = "",
) -> AfterHoursPlan:
    """`now`: the context pack's `now` layer (`open_now`, `next_open_text`)."""
    record = conversation.after_hours
    open_now = bool(now.get("open_now", True))
    opens_at = now.get("next_open_text")
    reply = conversation.turn + 1
    stamp = at.isoformat()

    period = now.get("next_open")

    def decided(choice: str, why: str) -> dict[str, Any]:
        base = record.model_dump() if record else {"times_offered": 0, "offered_turn": 0}
        return {**base, "choice": choice, "decided_at": stamp, "why": why, "period": period}

    def offered(choice: str, why: str) -> dict[str, Any]:
        base = record.model_dump() if record else {"decided_at": None}
        return {**base, "choice": choice, "times_offered": (record.times_offered if record else 0) + 1,
                "offered_turn": reply, "why": why, "period": period}

    # A record from an earlier closed period (or from while the dealer was open) doesn't answer for this one.
    if record is not None and not open_now and record.period != period and trigger == "inbound_message":
        record = None

    if trigger == TRIGGER_RESUME:
        why = "The dealership is open: the morning message picks the conversation up."
        return AfterHoursPlan(mode="resume", record=decided("now", why), why=why)

    if record is None:
        customer_wrote = trigger == "inbound_message"
        if trigger not in FIRST_CONTACT_TRIGGERS or (conversation.turn > 0 and not customer_wrote):
            return AfterHoursPlan(why="Not the first reply: no after-hours choice.")
        if origin != "inbound" and not customer_wrote:
            return AfterHoursPlan(why=f"An {origin or 'unknown'}-origin lead: the choice is only for inbound leads.")
        if open_now:
            return AfterHoursPlan(why="The dealership is open: no after-hours choice.")
        if wants_visit(extraction):
            why = "Closed, but the customer asked to visit: no choice offered, the conversation carries on."
            return AfterHoursPlan(record=decided("now", why), why=why)
        if conversation.turn > 0 and is_plain_acknowledgement(text):
            return AfterHoursPlan(why="A plain acknowledgement while closed: nothing to ask.")
        why = ("The customer wrote while the dealership is closed" if conversation.turn > 0
               else "A new inbound lead while the dealership is closed") + (
            ": offer to help now or when it opens; with no answer, the team picks it up at opening.")
        return AfterHoursPlan(mode="offer", record=offered("offered", why), schedule_resume=True, why=why,
                              opens_at=opens_at)

    if record.choice == "now":
        return AfterHoursPlan(why="The customer already chose to carry on now.")

    answer = extraction.get("contact_preference") if conversation.awaiting_contact_choice else None
    visit = wants_visit(extraction)

    if open_now:
        why = "The dealership is open now, so the after-hours choice no longer applies: the conversation carries on."
        return AfterHoursPlan(record=decided("now", why), cancel_resume=record.choice in ("later", "offered"),
                              why=why)

    if answer is None and not visit and is_plain_acknowledgement(text):
        return AfterHoursPlan(why="A plain acknowledgement: not an answer, no change.")

    if record.choice == "offered":
        if answer == "later" and not visit:
            why = "The customer chose to be picked up when the dealership opens."
            return AfterHoursPlan(mode="later", record=decided("later", why), schedule_resume=True, why=why,
                                  opens_at=opens_at)
        why = ("The customer asked to visit" if visit else "The customer chose now" if answer == "now"
               else "The customer didn't pick either option, so it counts as now") + (
            ": the conversation carries on and the morning message is cancelled.")
        return AfterHoursPlan(record=decided("now", why), cancel_resume=True, why=why)

    # choice == "later": they wrote again before the morning message.
    if visit:
        why = "The customer asked to visit: the conversation carries on and the morning message is cancelled."
        return AfterHoursPlan(record=decided("now", why), cancel_resume=True, why=why)
    if answer == "now":
        why = "The customer now wants to carry on: the morning message is cancelled."
        return AfterHoursPlan(record=decided("now", why), cancel_resume=True, why=why)
    if conversation.awaiting_contact_choice:
        if answer == "later":
            why = "The customer again chose to be picked up when the dealership opens."
            return AfterHoursPlan(mode="later", record=decided("later", why), why=why, opens_at=opens_at)
        why = ("The customer didn't pick either option when asked again, so it counts as now: "
               "the morning message is cancelled.")
        return AfterHoursPlan(record=decided("now", why), cancel_resume=True, why=why)
    why = "The customer wrote again while waiting for the dealership to open: answer, then offer the choice again."
    return AfterHoursPlan(mode="offer", record=offered("later", why), why=why, opens_at=opens_at)
