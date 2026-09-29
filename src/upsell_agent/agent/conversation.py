"""Conversation state (MASTER_PLAN_2 Phase 1): what the AI remembers about the
conversation itself, beyond the slot values. Stored on
`ai_lead_state.conversation` and part of every turn's context pack.

  turn            replies sent so far (the reply index asks and promises refer to)
  asks            per slot: how many replies asked for it, and in which reply
  last_asked      what the last reply asked for
  open_questions  the customer's questions no AI-written reply has answered yet
  promises        what our replies said the team would do
  last_topic      what the last reply was about
  after_hours     the "now or when we open?" choice (MASTER_PLAN_3 B1,
                  agent/after_hours.py): offered / now / later, how many times
                  it was offered, and the reply that last offered it
  visit           the visit offer (MASTER_PLAN_3 B4/B5, agent/visit_offer.py):
                  how many times it's been offered, the angle and times each
                  attempt used, whether it's been declined out, and any
                  active booking

Updated only after a turn whose reply went out (sent, or failed and handed
to the channel switch). Shadow turns change nothing: the customer never saw
those drafts.
"""

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, computed_field

MAX_OPEN_QUESTIONS = 10
MAX_PROMISES = 10
# A clarification re-explains our last question: it doesn't count as asking again,
# and what we last asked stays what the customer is answering.
KEEPS_LAST_ASK = {"clarify"}
DELIVERED = {"sent", "failed"}


class SlotAsks(BaseModel):
    count: int = 0
    last_turn: int = 0


class OpenQuestion(BaseModel):
    text: str
    # agent/llm.py QUESTION_LABELS: answerable, restricted, off_topic, clarify, about_me.
    label: str = "answerable"
    asked_at: str | None = None
    turn: int = 0


class Promise(BaseModel):
    text: str
    made_at: str | None = None
    turn: int = 0


class AfterHoursChoice(BaseModel):
    # offered: asked, no answer yet; now: carry on; later: the team picks it up at opening.
    choice: Literal["offered", "now", "later"] = "offered"
    times_offered: int = 0
    # The reply (ConversationState.turn) that last offered the choice.
    offered_turn: int = 0
    decided_at: str | None = None
    # Why the choice ended up as it is, for the Debug UI.
    why: str | None = None


class VisitState(BaseModel):
    """The visit offer (MASTER_PLAN_3 B4/B5, agent/visit_offer.py)."""

    attempts: int = 0
    # One per attempt made so far (agent/visit_offer.py's ANGLES ids), so no attempt repeats one.
    angles_used: list[str] = Field(default_factory=list)
    # The times our last offer named (booking_tool.format_offer() dicts): {iso, date, time, display}.
    offered_times: list[dict[str, str]] = Field(default_factory=list)
    # The reply (ConversationState.turn) that last made an offer.
    offered_turn: int = 0
    declined: bool = False
    # The reply (ConversationState.turn) that recorded the last decline, so a declined offer is
    # parked for a few replies before being offered again (B4 item 4, like Plan 2's parked asks).
    declined_turn: int = 0
    # 3 declines reached: never offered again in this conversation (a dated visit_followup may still).
    stopped: bool = False
    # Objections seen so far (Extract's visit_objection), so attempt 2 doesn't reuse attempt 1's angle.
    objections: list[str] = Field(default_factory=list)
    # The date the customer asked to be offered again ("next month"), else None (visit_followup
    # falls back to 3 days after the 3rd decline).
    followup_due: str | None = None
    # The time the customer picked while we still needed their email or phone to book it
    # (B5 item 3); booked on the reply that gives it.
    pending_pick: dict[str, str] | None = None
    # 1 while the offered times are kept on the table for one extra reply (decision 115).
    held_over: int = 0
    why: str | None = None


class ConversationState(BaseModel):
    turn: int = 0
    asks: dict[str, SlotAsks] = Field(default_factory=dict)
    last_asked: list[str] = Field(default_factory=list)
    open_questions: list[OpenQuestion] = Field(default_factory=list)
    promises: list[Promise] = Field(default_factory=list)
    last_topic: str | None = None
    after_hours: AfterHoursChoice | None = None
    visit: VisitState | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def awaiting_contact_choice(self) -> bool:
        """Our last reply offered "now or when we open?" (Extract reads the answer against it)."""
        return bool(self.after_hours and self.after_hours.choice in ("offered", "later")
                    and self.after_hours.offered_turn == self.turn and self.turn > 0)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def awaiting_visit_pick(self) -> bool:
        """Our last reply offered specific visit times (agent/visit_offer.py
        reads the customer's next message against them, in code, not via Extract)."""
        return bool(self.visit and self.visit.offered_times and self.visit.offered_turn == self.turn
                    and self.turn > 0)


def _key(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", text.lower())).strip()


def load_conversation(lead_state: dict | None) -> ConversationState:
    """The stored state, or a fresh one. A lead from before Phase 1 only has
    `last_asked_slots`; it becomes `last_asked`."""
    lead_state = lead_state or {}
    stored = lead_state.get("conversation")
    if stored:
        return ConversationState.model_validate(stored)
    return ConversationState(last_asked=list(lead_state.get("last_asked_slots") or []))


def _question(q: dict | str) -> dict[str, str]:
    return {"text": q.strip(), "label": "answerable"} if isinstance(q, str) else {
        "text": str(q.get("text", "")).strip(), "label": q.get("label") or "answerable"}


def questions_for_turn(state: ConversationState, new_questions: list[dict | str]) -> list[dict[str, str]]:
    """Still-open questions first, then this turn's new ones, without repeats,
    each as {text, label}."""
    seen: set[str] = set()
    questions: list[dict[str, str]] = []
    for q in [{"text": o.text, "label": o.label} for o in state.open_questions] + [_question(q) for q in new_questions]:
        key = _key(q["text"])
        if key and key not in seen:
            seen.add(key)
            questions.append(q)
    return questions


def _topic(action: str | None, asked: list[str], used_template: bool) -> str | None:
    if used_template:
        return "template reply" + (f": asked {', '.join(asked)}" if asked else "")
    if action in ("ask", "confirm") and asked:
        return f"{action}: {', '.join(asked)}"
    return action


def after_turn(
    state: ConversationState,
    *,
    now: datetime,
    send_status: str | None,
    shadow: bool,
    action: str | None,
    asked_slots: list[str],
    answered: list[str],
    new_questions: list[dict | str],
    used_template: bool,
    promises: list[str],
    after_hours: dict | None = None,
    visit: dict | None = None,
) -> ConversationState:
    """The state after one turn. `asked_slots`: what the reply that went out
    asked for (Decide's slots, or the template's own question). `answered`:
    the questions the AI-written reply says it answered. The customer's new
    questions are recorded even if nothing was sent, so they're answered next
    time. `after_hours`: the after-hours choice as this turn left it
    (agent/after_hours.py), kept only when the reply went out. `visit`: the
    visit offer as this turn left it (agent/visit_offer.py), same rule."""
    if shadow:
        return state
    at = now.isoformat()
    updated = state.model_copy(deep=True)

    known = {_key(q.text) for q in updated.open_questions}
    for question in map(_question, new_questions):
        if _key(question["text"]) and _key(question["text"]) not in known:
            updated.open_questions.append(OpenQuestion(**question, asked_at=at, turn=updated.turn + 1))
            known.add(_key(question["text"]))

    if send_status in DELIVERED:
        updated.turn += 1
        if action not in KEEPS_LAST_ASK or used_template:
            for path in asked_slots:
                asks = updated.asks.setdefault(path, SlotAsks())
                asks.count += 1
                asks.last_turn = updated.turn
            updated.last_asked = list(asked_slots)
        if not used_template:
            closed = {_key(text) for text in answered}
            updated.open_questions = [q for q in updated.open_questions if _key(q.text) not in closed]
        made = {_key(p.text) for p in updated.promises}
        for text in promises:
            if _key(text) and _key(text) not in made:
                updated.promises.append(Promise(text=text.strip(), made_at=at, turn=updated.turn))
                made.add(_key(text))
        updated.last_topic = _topic(action, asked_slots, used_template)
        if after_hours is not None:
            updated.after_hours = AfterHoursChoice.model_validate(after_hours)
        if visit is not None:
            updated.visit = VisitState.model_validate(visit)

    updated.open_questions = updated.open_questions[-MAX_OPEN_QUESTIONS:]
    updated.promises = updated.promises[-MAX_PROMISES:]
    return updated
