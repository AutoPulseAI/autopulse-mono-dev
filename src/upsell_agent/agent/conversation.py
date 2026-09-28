"""Conversation state (MASTER_PLAN_2 Phase 1): what the AI remembers about the
conversation itself, beyond the slot values. Stored on
`ai_lead_state.conversation` and part of every turn's context pack.

  turn            replies sent so far (the reply index asks and promises refer to)
  asks            per slot: how many replies asked for it, and in which reply
  last_asked      what the last reply asked for
  open_questions  the customer's questions no AI-written reply has answered yet
  promises        what our replies said the team would do
  last_topic      what the last reply was about
  shown_vehicles  VINs this reply named (MASTER_PLAN_3 Phase 3 decision F), so
                  the next turn doesn't offer the same vehicle as new. Stored
                  on this lead's own state, so nothing is shared across leads
                  or dealers.

Updated only after a turn whose reply went out (sent, or failed and handed
to the channel switch). Shadow turns change nothing: the customer never saw
those drafts.
"""

import re
from datetime import datetime

from pydantic import BaseModel, Field

MAX_OPEN_QUESTIONS = 10
MAX_PROMISES = 10
MAX_SHOWN_VEHICLES = 10
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


class ShownVehicle(BaseModel):
    vin: str
    turn: int = 0
    channel: str | None = None


class ConversationState(BaseModel):
    turn: int = 0
    asks: dict[str, SlotAsks] = Field(default_factory=dict)
    last_asked: list[str] = Field(default_factory=list)
    open_questions: list[OpenQuestion] = Field(default_factory=list)
    promises: list[Promise] = Field(default_factory=list)
    last_topic: str | None = None
    shown_vehicles: list[ShownVehicle] = Field(default_factory=list)


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
    shown_vins: list[str] | None = None,
    channel: str | None = None,
) -> ConversationState:
    """The state after one turn. `asked_slots`: what the reply that went out
    asked for (Decide's slots, or the template's own question). `answered`:
    the questions the AI-written reply says it answered. The customer's new
    questions are recorded even if nothing was sent, so they're answered next
    time. `shown_vins`: the vehicles the reply that actually went out named
    (MASTER_PLAN_3 Phase 3 decision F), so the next turn doesn't offer them
    again as new."""
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
        shown = {v.vin for v in updated.shown_vehicles}
        for vin in shown_vins or []:
            if vin and vin not in shown:
                updated.shown_vehicles.append(ShownVehicle(vin=vin, turn=updated.turn, channel=channel))
                shown.add(vin)
        updated.last_topic = _topic(action, asked_slots, used_template)

    updated.open_questions = updated.open_questions[-MAX_OPEN_QUESTIONS:]
    updated.promises = updated.promises[-MAX_PROMISES:]
    updated.shown_vehicles = updated.shown_vehicles[-MAX_SHOWN_VEHICLES:]
    return updated
