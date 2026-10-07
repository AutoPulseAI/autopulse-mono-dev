""""Speak to a human" -> a call or a text (PLAN_4 stream H; client action item, Friday meeting: "review the
AI's response when a customer asks to speak with a human and address the requested call-or-text choice").

  asked for a person, said how ("can someone call me", "have a person text me")
        -> that, straight away (a handoff, as before)
  asked for a person, didn't say how
        -> one warm reply offering the choice: a call (at the number on file, read out as its last 4 digits
           only) or a text from a team member. Nothing else is asked or offered in that reply (the client's goal
           is still the appointment, but this turn honours the request). The lead is NOT handed off yet.
  their answer (the next message, read in code):
        call -> a staff call task opens right away (agent/call_tasks.py, not the 60-minute timer), under the
                call rules (compliance/call_check.py). Outside calling hours the task waits for the next allowed
                time and the reply says when someone will call, never "now". Handoff.
        text -> a staff notice "the customer wants a text from a person" (the CRM's AI Alerts) and a handoff:
                the AI stops replying, as today.
        "either" -> a call; anything else (no clear answer) -> a text, since the request for a person stands;
        "never mind" -> back to the normal conversation.
  clearly upset / urgent (slots/policy.py's handoff rule) -> still an immediate handoff, never the question:
        their own choice if they gave one, otherwise a call (a text when a call isn't possible).
  a voice opt-out, no usable phone or the lead on DND -> never a call: text only, and no question.

Pure code, no model: the method is read with regexes, like the other rare, high-stakes bits of Decide
(cancel/reschedule, "call me Friday"). `plan()` is pure; Decide supplies the call check's result.
"""

import re
from dataclasses import dataclass, field
from typing import Any

CALL, TEXT, OFFER = "call", "text", "offer"

# "Don't call me", "no calls please", "I can't talk right now": never a call, whatever else they said.
_NO_CALLS = re.compile(
    r"\b(?:do\s*n[o']?t|dont|never|no\s+need\s+to|please\s+don'?t)\s+(?:\w+\s+){0,2}?(?:call|calling|phone|ring)\b"
    r"|\bno\s+(?:phone\s+)?calls?\b|\bcan'?t\s+(?:talk|take\s+(?:a\s+)?calls?|answer\s+(?:the|my)\s+phone)\b",
    re.IGNORECASE)
_CALL = re.compile(
    r"\b(?:call|phone|ring)\s+(?:me|us|my\s+(?:cell|phone|number))\b|\bcall\s*back\b|\bgive\s+me\s+a\s+(?:call|ring)\b"
    r"|\b(?:a|the)\s+(?:phone\s+)?call\b|\b(?:by|over\s+the|on\s+the)\s+phone\b"
    r"|\b(?:someone|somebody|anyone|person|human|manager|salesperson|sales\s+rep|rep|you|they|guy)\s+"
    r"(?:can\s+|could\s+|to\s+|should\s+|will\s+)?(?:call|phone|ring)\b"
    r"|^\W*(?:call|phone|calling)\b|\bcall(?:ing)?\s+(?:is|would\s+be|works|please|pls|plz|thanks)\b|\bprefer\s+a?\s*call\b",
    re.IGNORECASE)
_TEXT = re.compile(
    r"\b(?:text|txt|message|msg)\s+(?:me|us)\b|\b(?:a|by|via|over|through)\s+(?:text|txt|sms|message)\b"
    r"|^\W*(?:text|txt|texting|sms|message)\b|\btext(?:ing)?\s+(?:is|would\s+be|works|please|pls|plz|back|instead)\b"
    r"|\b(?:someone|somebody|person|human|manager|salesperson|rep|you|they)\s+(?:can\s+|could\s+|to\s+|should\s+)?"
    r"(?:text|message)\b|\bprefer\s+(?:a\s+)?text\b|\b(?:email|e-mail)\s+(?:me|is|works|please)\b|\bby\s+e-?mail\b",
    re.IGNORECASE)
_EITHER = re.compile(r"\b(?:either|whichever|any(?:thing)?\s+(?:is|works)|doesn'?t\s+matter|whatever|both)\b",
                     re.IGNORECASE)
# Answering "a call at the number ending in 1234, or a text?" with "yes, that number" / "the 1234 one".
_THAT_NUMBER = re.compile(r"\b(?:that|this|same|the)\s+(?:number|one|cell|phone)\b|\b\d{4}\b", re.IGNORECASE)
_NEVER_MIND = re.compile(r"\b(?:never\s*mind|nvm|no\s+need|you\s+can\s+help|forget\s+it|all\s+good\s+now|"
                         r"i'?ll\s+stick\s+with\s+you|you'?re\s+fine)\b", re.IGNORECASE)
# A number they give for the call ("call me at 555-123-4567").
_PHONE = re.compile(r"(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}")

REASON_CALL = "Customer asked for a call"
REASON_TEXT = "Customer asked for a text from a person"
NOTICE_TEXT_KIND = "text_requested"
NOTICE_CALL_WAITING_KIND = "call_requested"


def wants_no_calls(text: str) -> bool:
    return bool(_NO_CALLS.search(text or ""))


def said_method(text: str, *, answering: bool = False) -> str | None:
    """How the customer wants to hear from a person, in their own words, or None. A "no calls" wins.
    `answering`: the message answers our "call or text?" question, so "either" and "that number" count."""
    text = text or ""
    if wants_no_calls(text):
        return TEXT
    call, sms = bool(_CALL.search(text)), bool(_TEXT.search(text))
    if call and not sms:
        return CALL
    if sms and not call:
        return TEXT
    if call and sms:
        # "Call or text, either is fine" / "call me or text me": a person reaches out faster by phone.
        return CALL
    if answering and (_EITHER.search(text) or _THAT_NUMBER.search(text)):
        return CALL
    return None


_PERSON = re.compile(r"\b(?:a\s+(?:real\s+|actual\s+)?person|human|someone|somebody|manager|salesperson|sales\s+rep|"
                     r"team\s+member)\b", re.IGNORECASE)


def asks_for_person(text: str) -> bool:
    """The message asks for a person at all (used where Extract hasn't run yet: events/handlers.py)."""
    return bool(_PERSON.search(text or ""))


def never_mind(text: str) -> bool:
    return bool(_NEVER_MIND.search(text or ""))


def given_phone(text: str) -> str | None:
    match = _PHONE.search(text or "")
    return match.group(0) if match else None


def last4(phone: str | None) -> str | None:
    digits = re.sub(r"\D", "", phone or "")
    return digits[-4:] if len(digits) >= 4 else None


@dataclass
class CallCheck:
    """compliance/call_check.can_call's answer, as Decide passes it in: ALLOW / HOLD (with `when`, the next
    allowed time in the customer's words, e.g. "9:00 AM tomorrow") / BLOCK (with why), and the phone."""
    outcome: str
    reason: str = ""
    code: str = ""
    phone: str | None = None
    until: str | None = None  # ISO
    when: str | None = None

    @property
    def possible(self) -> bool:
        return self.outcome in ("ALLOW", "HOLD")


@dataclass
class HumanContactPlan:
    # None: not about a person; "offer": ask call-or-text; "call" / "text": hand off that way.
    mode: str | None = None
    why: str = ""
    chosen_by: str | None = None  # "customer" | "default"
    # What the conversation keeps (agent/conversation.HumanContactState), or None to leave it.
    record: dict[str, Any] | None = None
    call: CallCheck | None = None
    phone: str | None = None
    # When a person will text, if the dealership is closed now ("9:00 AM tomorrow"), else None.
    text_when: str | None = None
    written: str = "text"  # "text" on SMS, "email" on the email channel
    escalated: bool = False
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        """What travels in the decision (Compose and the post-send step read it). The full phone stays out of
        anything Compose sees: compose_payload() only passes `for_compose()`."""
        return {"mode": self.mode, "why": self.why, "chosen_by": self.chosen_by, "record": self.record,
                "phone": self.phone, "phone_last4": last4(self.phone),
                "call": None if self.call is None else {
                    "outcome": self.call.outcome, "reason": self.call.reason, "code": self.call.code,
                    "until": self.call.until, "when": self.call.when},
                "text_when": self.text_when, "written": self.written, "escalated": self.escalated,
                "reason": REASON_CALL if self.mode == CALL else REASON_TEXT if self.mode == TEXT else None}


def for_compose(plan: dict[str, Any] | None) -> dict[str, Any] | None:
    """The part Compose writes from: never the full number (last 4 digits only)."""
    if not plan or not plan.get("mode"):
        return None
    call = plan.get("call") or {}
    return {"mode": plan["mode"], "phone_last4": plan.get("phone_last4"),
            "call_when": call.get("when") if call.get("outcome") == "HOLD" else None,
            "text_when": plan.get("text_when"), "written": plan.get("written"),
            "calls_blocked": bool(call) and call.get("outcome") == "BLOCK"}


def plan(*, text: str, wants_human: bool, awaiting: bool, escalate: bool, hold: str | None, channel: str,
         call: CallCheck | None, text_when: str | None, turn: int) -> HumanContactPlan:
    """The pure part. `awaiting`: our last reply offered call-or-text. `escalate`: clearly upset / urgent (the
    handoff fires anyway). `hold`: questions are held this turn (a possible opt-out, quiet hours). `call`: the
    call check, already run (None when no call is possible to check). `turn`: the conversation's reply count."""
    written = "email" if channel == "email" else "text"
    out = HumanContactPlan(written=written, escalated=escalate)
    if not (wants_human or awaiting):
        return out
    if awaiting and not wants_human and never_mind(text) and said_method(text, answering=True) is None:
        out.record = {"choice": "withdrawn", "offered_turn": turn}
        out.why = "They said never mind to the call-or-text question: back to the normal conversation."
        return out

    method = said_method(text, answering=awaiting)
    out.chosen_by = "customer" if method else None
    if method is None:
        if awaiting:
            method, out.chosen_by = TEXT, "default"
            out.notes.append("No clear answer to call-or-text: a person will text, since they asked for one.")
        elif escalate:
            method, out.chosen_by = CALL, "default"
            out.notes.append("Upset/urgent and didn't say how: a call, so it's handled fastest.")
        elif hold:
            method, out.chosen_by = TEXT, "default"
            out.notes.append(f"No question this turn ({hold}): a person will {written} them here.")
        else:
            method = OFFER

    if method in (CALL, OFFER) and not (call and call.possible):
        why = (call.reason if call else "no call check")
        out.notes.append(f"A call isn't possible ({why}): text only, no question.")
        method = TEXT
        if out.chosen_by is None:
            out.chosen_by = "default"
    out.mode = method
    out.call = call
    if method in (CALL, OFFER):
        out.phone = call.phone if call else None
    if method == TEXT:
        out.text_when = text_when
    out.record = {"choice": "offered" if method == OFFER else method, "offered_turn": turn + 1}
    out.why = {
        OFFER: "Asked for a person without saying how: offer a call (number on file, last 4 only) or a text, once.",
        CALL: ("Wants a call: a staff call task opens " + (f"at the next calling time ({call.when})"
               if call and call.outcome == "HOLD" else "right away") + "; handed to staff."),
        TEXT: "Wants a text from a person: staff notice on AI Alerts; handed to staff.",
    }[method]
    if out.chosen_by == "default" and method != OFFER:
        out.why += " (Chosen for them: " + "; ".join(out.notes) + ")"
    return out


async def act_after_send(db: Any, decision: dict[str, Any], *, lead_id: str, customer_id: str,
                         customer_name: str | None, turn_id: str) -> dict[str, Any] | None:
    """After the handoff reply went out (agent/turn.py; never on a shadow turn): the staff side of the choice.
    call -> a call task open now (agent/call_tasks.py), or, outside calling hours, waiting for the next allowed
    time (the scheduler's `call_task` kind re-checks and opens it then); text -> a staff notice on AI Alerts."""
    from datetime import datetime

    from upsell_agent import clock
    from upsell_agent.agent import call_tasks
    from upsell_agent.integrations.mongodb import (
        AI_LEAD_STATE_COLLECTION,
        SCHEDULED_FOLLOWUPS_COLLECTION,
    )
    from upsell_agent.scheduler.followups import KIND_CALL_TASK

    person = decision.get("human_contact") or {}
    if decision.get("action") != "handoff" or person.get("mode") not in (CALL, TEXT):
        return None
    now = clock.now()
    who = customer_name or "The customer"
    states = db.collection(AI_LEAD_STATE_COLLECTION)
    upset = " They're upset or it's urgent: please call first." if person.get("escalated") else ""
    if person["mode"] == TEXT:
        when = person.get("text_when")
        no_calls = " Don't call: calls aren't allowed for them." if (person.get("call") or {}).get(
            "outcome") == "BLOCK" else ""
        text = (f"{who} wants a text from a person, not a call. Reply to them in the conversation"
                + (f" - they were told someone will {person.get('written') or 'text'} them at {when}." if when
                   else " - they were told someone will be in touch shortly.") + no_calls)
        await states.update_one({"lead_id": lead_id}, {"$set": {"staff_notice": {
            "at": now, "kind": NOTICE_TEXT_KIND, "text": text, "reason": REASON_TEXT}}})
        return {"mode": TEXT, "notice": NOTICE_TEXT_KIND, "reason": "staff notice: the customer wants a text"}

    phone = person.get("phone")
    call = person.get("call") or {}
    if call.get("outcome") == "HOLD" and call.get("until"):
        due = datetime.fromisoformat(call["until"])
        followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
        await followups.update_many(
            {"lead_id": lead_id, "kind": KIND_CALL_TASK, "status": {"$in": ["pending", "standby"]}},
            {"$set": {"status": "superseded", "reason": "the customer asked for a call", "closed_at": now}})
        inserted = await followups.insert_one({
            "kind": KIND_CALL_TASK, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": turn_id,
            "from_channel": "sms", "to_channel": "voice", "to": phone, "sent_channels": [], "status": "pending",
            "due_at": due, "created_at": now, "claim_count": 0, "requested": True, "task_reason": REASON_CALL,
            "reason": f"{REASON_CALL}: waiting for calling hours ({call.get('reason')})"})
        await states.update_one({"lead_id": lead_id}, {"$set": {"staff_notice": {
            "at": now, "kind": NOTICE_CALL_WAITING_KIND, "reason": REASON_CALL, "due_at": due,
            "text": (f"{who} asked for a call at {phone}. It's outside calling hours, so the call task opens "
                     f"{call.get('when')} - they were told someone will call then.{upset}")}}})
        return {"mode": CALL, "call_task": "waiting", "followup_id": str(inserted.inserted_id),
                "due_at": due.isoformat(), "reason": f"call task waits for calling hours ({call.get('when')})"}
    task = await call_tasks.open_task(
        db, lead_id=lead_id, customer_id=customer_id, phone=phone, customer_name=customer_name,
        reason=REASON_CALL, source_turn_id=turn_id, followup_id=None, created_at=now, requested=True,
        notice=f"Please call {who} at {phone}: they asked to speak with a person by phone.{upset}")
    # The 60-minute timer behind a touch isn't needed any more: this call covers it.
    await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
        {"lead_id": lead_id, "kind": KIND_CALL_TASK, "status": {"$in": ["pending", "standby"]},
         "requested": {"$ne": True}},
        {"$set": {"status": "superseded", "reason": "the customer asked for a call", "closed_at": now}})
    return {"mode": CALL, "call_task": "open", "task_id": str(task["_id"]), "reason": "call task opened for staff"}
