"""The SOLD PENDING workflow's own rules (MASTER_PLAN_4 D2; client spec
docs/data/4/AutoPulse_SOLD_PENDING_Workflow_Developer_Spec.pdf).

SOLD PENDING is "an active deal-completion and customer-engagement status ...
not an unsold lead" (§1): the dealership recorded the deal as sold, the vehicle
isn't delivered yet. The customer is kept engaged without ever implying they
are holding anything up.

    touch 1-4   weekly        one per week, each with its own theme (§5)
                              day 1, 8, 15, 22 after the outcome was set
    touch 5+    every 2 weeks day 36, 50, 64, ... for as long as it stays SOLD PENDING (§6)

There is **no expiry** (§2, §4, §12): no Day 90, no age threshold. Only staff
picking SOLD - DELIVERED or CLOSED LOST, or an opt-out, stops it (§10). Every
touch is text + email + the 60-minute call task (§3, §8: agent/call_tasks.py,
reused as is).

Our choices where the spec gives none (stream A3 notes):
- The first touch goes out the day after the outcome, at 10:00 dealer time
  (cadence.TOUCH_HOUR): the outcome is usually set the day of the visit.
- The touches are the client's own wording (§5's "Recommended intent"), not an
  AI-written message: fixed text can't invent a missing document, a delivery
  date, a financing status or a reason the deal is pending (§7). A reply from
  the customer is answered by the AI turn under the same guardrails
  (`reply_hold`), or routed to a person (`classify_reply`, §9).

Nothing here touches the database or the clock.
"""

import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, time, timedelta
from typing import Any

from upsell_agent.agent.cadence import TOUCH_HOUR

WEEKLY_TOUCHES = 4
FIRST_TOUCH_AFTER_DAYS = 1
WEEKLY_EVERY_DAYS = 7
BIWEEKLY_EVERY_DAYS = 14


@dataclass(frozen=True)
class Theme:
    id: str
    label: str


# SOLD PENDING PDF §5 (weeks 1-4) and §6 (after week 4), in the client's order.
WEEK_THEMES: list[Theme] = [
    Theme("documentation_questions", "Documentation + questions"),
    Theme("support_check_in", "Support check-in"),
    Theme("purchase_vehicle_check_in", "Purchase / vehicle check-in"),
    Theme("relationship_check_in", "Relationship check-in"),
]
BIWEEKLY_THEME = Theme("biweekly_check_in", "Every-two-weeks check-in")
BY_ID = {t.id: t for t in (*WEEK_THEMES, BIWEEKLY_THEME)}


@dataclass
class SoldPendingState:
    """`ai_lead_state.sold_pending` (§11's recommended fields). `touch_number` is the touch this lead sends next."""
    started_at: datetime | None = None
    touch_number: int = 1
    last_followup_at: datetime | None = None
    next_followup_at: datetime | None = None
    # The customer told us they've given the salesperson everything: we stop asking (§7 "Do not repeatedly ask
    # questions already answered").
    documents_confirmed: bool = False
    documents_asked_at: datetime | None = None
    last_meaningful_contact_at: datetime | None = None
    ended_at: datetime | None = None
    outcome: str | None = None
    escalations: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def load(cls, lead_state: dict | None) -> "SoldPendingState":
        raw = (lead_state or {}).get("sold_pending") or {}
        known = {k: raw[k] for k in cls.__dataclass_fields__ if k in raw}
        state = cls(**known)
        state.touch_number = int(state.touch_number or 1)
        state.escalations = list(state.escalations or [])
        return state

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def week_number(touch_number: int) -> int:
    """Which week of SOLD PENDING the touch belongs to (§11 `sold_pending_week_number`)."""
    return touch_due_day(touch_number) // 7 + 1


def phase(touch_number: int) -> str:
    return "weekly" if touch_number <= WEEKLY_TOUCHES else "every_two_weeks"


def touch_due_day(touch_number: int) -> int:
    """Days after SOLD PENDING started that touch `touch_number` (1-based) is due: one a week for weeks 1-4, then
    every two weeks after the week-4 touch, forever (§4, §6)."""
    n = max(1, touch_number)
    if n <= WEEKLY_TOUCHES:
        return FIRST_TOUCH_AFTER_DAYS + WEEKLY_EVERY_DAYS * (n - 1)
    last_weekly = FIRST_TOUCH_AFTER_DAYS + WEEKLY_EVERY_DAYS * (WEEKLY_TOUCHES - 1)
    return last_weekly + BIWEEKLY_EVERY_DAYS * (n - WEEKLY_TOUCHES)


def theme_for(touch_number: int) -> Theme:
    return WEEK_THEMES[touch_number - 1] if 1 <= touch_number <= WEEKLY_TOUCHES else BIWEEKLY_THEME


def due_at(started_at: datetime, touch_number: int, tz) -> datetime:
    started = started_at.astimezone(tz) if started_at.tzinfo else started_at.replace(tzinfo=tz)
    day = started.date() + timedelta(days=touch_due_day(touch_number))
    return datetime.combine(day, time(TOUCH_HOUR), tzinfo=tz)


@dataclass
class PlannedTouch:
    touch_number: int
    theme: Theme
    due_at: datetime
    week: int
    phase: str

    def as_dict(self) -> dict[str, Any]:
        return {"touch_number": self.touch_number, "theme": self.theme.id, "theme_label": self.theme.label,
                "due_at": self.due_at.isoformat(), "week": self.week, "phase": self.phase}


def plan_touch(state: SoldPendingState, *, now: datetime, tz) -> PlannedTouch:
    """The next touch. One a week (then every two weeks) on a fixed grid from the start, so exactly one goes out
    per period (§12). A touch whose time already passed (the worker was down, a hold ran over) goes out now
    rather than being skipped; the one after it keeps its own grid day."""
    assert state.started_at is not None
    n = state.touch_number
    due = due_at(state.started_at, n, tz)
    due = max(now, due)
    return PlannedTouch(touch_number=n, theme=theme_for(n), due_at=due, week=week_number(n), phase=phase(n))


def after_touch(state: SoldPendingState, planned_number: int, *, at: datetime, asked_documents: bool,
                sent: bool) -> SoldPendingState:
    """The state once a touch went out (or was skipped: the cadence moves on either way, §9 "No response:
    continue")."""
    data = state.as_dict()
    data["touch_number"] = planned_number + 1
    if sent:
        data["last_followup_at"] = at
        if asked_documents:
            data["documents_asked_at"] = at
    return SoldPendingState(**data)


# --- The touch messages -------------------------------------------------------------------------------------------

def asks_documents(touch_number: int, state: SoldPendingState) -> bool:
    """Week 1 asks whether they've provided everything the salesperson asked for (§5); after week 4 only "where
    appropriate" (§6): every other biweekly touch, and never once they've told us they have."""
    if state.documents_confirmed:
        return False
    if touch_number == 1:
        return True
    return touch_number > WEEKLY_TOUCHES and (touch_number - WEEKLY_TOUCHES) % 2 == 0


def render_touch(touch_number: int, *, first_name: str | None, dealership: str | None, vehicle: str | None,
                 documents: bool) -> dict[str, str]:
    """The client's own intent for each touch (§5, §6), as {sms_text, email_subject, email_body}. Only what we
    know is used: no vehicle on record -> "your vehicle"; never a document, a date, a status or a reason."""
    hi = f"Hi {first_name}" if first_name else "Hi there"
    car = f"your {vehicle}" if vehicle else "your vehicle"
    team = f"the team at {dealership}" if dealership else "our team"
    theme = theme_for(touch_number).id
    if theme == "documentation_questions":
        body = (f"{hi}, thanks again for choosing us for {car}! Just checking in: have you been able to provide "
                "everything your salesperson requested? And do you have any questions about your purchase?")
    elif theme == "support_check_in":
        body = (f"{hi}, checking in from {team}. Is there anything you need from your salesperson or from us? "
                "Have any questions come up about your purchase?")
    elif theme == "purchase_vehicle_check_in":
        body = (f"{hi}, if you have any questions about {car} or about the purchase process, we're happy to help. "
                "Is there anything we can answer for you?")
    elif theme == "relationship_check_in":
        # The client's recommended intent, word for word (§5).
        body = (f"{hi}, we just wanted to stay in touch while your purchase is being completed. Do you have any "
                "questions about your vehicle or is there anything our team can help you with at this time?")
    else:
        body = (f"{hi}, just checking in from {team}. Do you have any questions about {car} or your purchase, "
                "or is there anything you need from us or your salesperson?")
        if documents:
            body += " And if your salesperson asked for anything, do you have everything you need for that?"
    subject = f"Checking in about {car}" if vehicle else "Checking in about your purchase"
    sign = f"\n\nThank you,\n{dealership}" if dealership else "\n\nThank you"
    return {"sms_text": body, "email_subject": subject, "email_body": body + sign, "theme": theme}


# §7 and §12: never imply the customer is delaying the deal, never invent documents, dates, approvals or reasons.
# Used by the tests on every touch, and on the AI-written replies' instructions (`reply_hold`).
_DELAY_OR_INVENTED = re.compile(
    r"\b(holding (?:things|it|us) up|hold(?:ing)? up|delay(?:ed|ing)?|waiting on you|still waiting for your|"
    r"we(?:'re| are) still missing|you(?:'re| are) missing|missing (?:your|the) |overdue|outstanding documents?|"
    r"approved|approval came|delivery date is|will be delivered on|your (?:loan|financing) (?:is|was|has)|"
    r"(?:pay ?stubs?|proof of (?:income|insurance|residence)|driver'?s licen[cs]e)\b)", re.IGNORECASE)


def guardrail_problems(text: str) -> list[str]:
    """Phrases a SOLD PENDING message must never contain (§7, §12): blame for the pending status, or a document,
    date, approval or financing status we have no verified record of."""
    return sorted({m.group(0).strip().lower() for m in _DELAY_OR_INVENTED.finditer(text or "")})


# --- The response router (§9) ----------------------------------------------------------------------------------

# "Questions requiring salesperson, manager, finance, title, trade, insurance, or other human review must be
# routed/escalated with context" (§7). Delivery timing and deal status are in here too: only a person knows them.
_NEEDS_HUMAN = re.compile(
    r"\b(financ\w*|loan|lender|bank|credit|apr|interest rate|payment|monthly|down ?payment|approv\w*|"
    r"title|registration|register|plates?|tags?|dmv|paperwork|contract|sign(?:ing)?|"
    r"trade[- ]?in|my trade|payoff|insurance|insur\w*|warranty|gap|"
    r"deliver\w*|pick(?:\s|-)?up|ready|when (?:can|will|do) i (?:get|have)|eta|how long|status|"
    # Stream X2: "When can I pick it up?", "can I come get it", "when do I get my car".
    r"pick (?:it|her|him|them|the \w+|my \w+) up|(?:come|coming) (?:get|grab) (?:it|her|him|my \w+)|"
    r"manager|salesperson|sales ?(?:man|rep)|refund|deposit|price|cancel)\b", re.IGNORECASE)
# "Customer provides requested information" (§9): they sent or did something for the deal.
_PROVIDES_INFO = re.compile(
    r"\b(attached|attaching|i(?:'ve| have)? (?:just )?(?:sent|emailed|uploaded|dropped off|signed|faxed|texted)|"
    r"here(?:'s| is| are) (?:my|the)|uploaded|sending (?:it|them|you)|just sent|"
    r"my (?:insurance|license|licence|pay ?stubs?|proof of \w+) (?:is|are)\b)", re.IGNORECASE)
# The customer says they've given the salesperson everything (answers week 1's question).
_ALL_PROVIDED = re.compile(
    # Stream X2: "I have a question about the color" is not "I have (provided everything)".
    r"\b(yes|yep|yeah|all set|all good|already (?:did|sent|provided|gave)|"
    r"i (?:did|have)\b(?!\s+(?:a|an|one|some|another|any|more|questions?|concerns?|no)\b)|"
    r"provided everything|sent everything|gave (?:them|him|her) everything|everything(?:'s| is) (?:in|done|sent))\b",
    re.IGNORECASE)


def classify_reply(text: str, *, documents_asked: bool) -> tuple[str, str]:
    """(route, why) for a customer reply while SOLD PENDING (§9):
    - "info": the customer provided requested information -> record it and route it to the dealership user;
    - "human": a question only a person can answer -> escalate with context;
    - "documents_confirmed": they answered our documents question with a yes (we stop asking it);
    - "ai": anything else -> the AI answers from verified context only.
    The lead stays SOLD PENDING in every case: only staff change it."""
    body = (text or "").strip()
    if _PROVIDES_INFO.search(body):
        return "info", "the customer sent or provided something for the deal"
    if _NEEDS_HUMAN.search(body) and ("?" in body or re.search(r"\b(when|what|how|can|could|is|are|do|does|will)\b",
                                                                  body, re.IGNORECASE)):
        return "human", f"a question for a person ({_NEEDS_HUMAN.search(body).group(0).lower()})"
    if documents_asked and _ALL_PROVIDED.search(body) and "?" not in body:
        return "documents_confirmed", "the customer says they've provided everything requested"
    return "ai", "a reply the AI can answer from verified context"


def escalation_reply(first_name: str | None) -> str:
    hi = f"Thanks, {first_name}" if first_name else "Thanks"
    return (f"{hi}! That's a great question for your salesperson, so I've passed it to them with your message. "
            "They'll get back to you with an accurate answer.")


def info_received_reply(first_name: str | None) -> str:
    hi = f"Thank you, {first_name}" if first_name else "Thank you"
    return f"{hi}! I've passed that along to your salesperson. If anything else comes up, just let me know."


def reply_hold(stage: str | None) -> str | None:
    """Decide's `hold_questions` for an AI-written reply to a sold customer (agent/nodes/decide.py): answer
    only, ask and offer nothing (no visit, no vehicle, no deal). The words travel to Compose as is."""
    if stage == "sold_pending":
        return ("the customer's purchase is Sold Pending (SOLD PENDING PDF §7): continue the existing purchase "
                "relationship, never a new sales pitch, and never say or suggest the customer is delaying it. Never "
                "state or guess a delivery date, a missing document, a financing or approval status or why the deal "
                "is pending - say the salesperson will confirm anything like that")
    if stage in ("sold_delivered", "closed_no_longer_owns"):
        return ("the customer already bought their vehicle (SOLD-DELIVERED PDF §12): answer only, no sales pitch, "
                "no trade-in or upgrade talk. Never state a maintenance interval, mileage, recall or appointment time "
                "we don't have on record - the service team confirms those")
    return None
