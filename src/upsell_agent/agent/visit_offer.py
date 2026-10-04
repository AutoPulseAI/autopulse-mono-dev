"""The visit offer (MASTER_PLAN_3 B4, architecture §15 decisions 106-110):
every qualified or partly-qualified lead is offered a visit instead of being
handed to staff, up to 3 attempts, each with a different angle. Every lead
type gets it (decision 106: sales, trade-in, service and general).

MASTER_PLAN_4 F2 (client, scope Q16): a SERVICE visit is offered but never
booked in this SOW. Its offer (`service=True`) carries no times: it asks
which day and time suit them, and agent/service_request.py passes their
answer to the service team with notes.

A pure function of the turn (like agent/after_hours.py): the profile, the
conversation state's `visit` record, what Extract read, and the times Decide
already built with tools/booking_tool.py (building them, and any booking
itself, needs the database, so that I/O happens in agent/nodes/decide.py,
not here). Decide calls plan_visit(); the turn (after the send) records the
plan and schedules or cancels the dated visit_followup.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal

from upsell_agent.agent.conversation import ConversationState, VisitState
from upsell_agent.slots.profile import Profile

# The bar for "wants a visit" / "declines" (architecture §15 decision 108: the same bar as
# upset/urgent/wants_visit).
SIGNAL_CONFIDENCE = 0.8
MAX_ATTEMPTS = 3
# 3 days after the 3rd decline, when the customer named no date of their own (B4 item 4).
DEFAULT_FOLLOWUP_DAYS = 3
# A declined offer isn't made again until this many other replies have gone out (B4 item 4:
# "the visit isn't offered again for 3 replies in between attempts", like Plan 2's parked asks -
# slots/policy.py's PARKED_FOR_REPLIES).
PARKED_FOR_REPLIES = 3

Angle = Literal["primary_interest", "objection", "value_proposition"]

# Attempt 2's objection angle (B4 item 4, architecture §15 decision 108): a seen objection first,
# else the customer's own stated priority (decided in _angle_for_attempt).
_OBJECTION_REASON = {
    "time_convenience": "we can work around your schedule",
    "just_looking": "there's no pressure - coming by just lets you see it in person, no obligation",
    "wants_numbers": "sitting down with the team is the fastest way to get real numbers",
    "credit_worry": "the team can walk through your options in person, no obligation",
    "trade_value_unsure": "we can take a real look at your trade and give you a number",
}
# Attempt 3's value-proposition angle, by lead bucket (B4 item 4, from the Omnichannel PDF's
# Day 6 truthful-reasons list). PLAN_4 stream X3 item 2: no "while it's still available" (an availability
# claim with no vehicle behind it - the guard rejected every draft that repeated it, so the customer got the
# "I've made a note of that" template instead of the offer) and no unbacked duration ("only takes a few minutes").
_VALUE_PROP_BY_TYPE = {
    "trade_in": "so we can give your trade a proper appraisal",
    "sales": "so you can compare it side by side with other options before you decide",
    "service": "so the team can take a proper look and confirm what it actually needs",
    "general": "so we can walk you through your options in person",
}


@dataclass
class VisitOfferPlan:
    fire: bool = False  # Decide's offer_visit rule should fire this turn
    attempt: int = 0
    angle: Angle | None = None
    value_proposition: str | None = None
    times: list[dict[str, str]] = field(default_factory=list)
    # The conversation state's `visit` record once this reply goes out (None: unchanged).
    record: dict[str, Any] | None = None
    schedule_followup: bool = False
    followup_due: str | None = None  # ISO date
    # 3rd decline with a staff-only question still open (B0.13 decision 64, B4 item 8).
    handoff: bool = False
    # MASTER_PLAN_4 F2: a service visit - ask for a preferred day/time, offer no times, book nothing.
    service_request: bool = False
    why: str = ""

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def wants_visit(extraction: dict[str, Any]) -> bool:
    return bool(extraction.get("wants_visit")) and float(extraction.get("wants_visit_confidence") or 0.0) >= SIGNAL_CONFIDENCE


def declines_visit(extraction: dict[str, Any]) -> bool:
    return bool(extraction.get("declines_visit")) and float(
        extraction.get("declines_visit_confidence") or 0.0) >= SIGNAL_CONFIDENCE


def _values(profile: Profile) -> dict[str, Any]:
    return profile.values(include_stale=True)


def eligible(profile: Profile, extraction: dict[str, Any]) -> bool:
    """B0.12: as soon as we know what they want (model or type) and roughly
    when, or right away on a buying signal. Applies to every lead type
    (decision 106): trade-in's "what" is their trade vehicle, service's is
    the vehicle being serviced."""
    if wants_visit(extraction):
        return True
    values = _values(profile)
    knows_what = bool(values.get("interest.model") or values.get("interest.body_type")
                      or values.get("trade_in.model") or values.get("vehicle.model"))
    knows_when = bool(values.get("interest.timeline") or values.get("interest.needed_by")
                      or values.get("contact.best_time"))
    # PLAN_4 stream X3 item 2: a stated objective (payment target, budget, payoff) is a reason to come in by
    # itself - "keep it under 400 a month" is answered with a visit built on it, not "I've made a note".
    has_objective = bool(values.get("interest.monthly_payment") or values.get("interest.budget")
                         or values.get("trade_in.payoff"))
    return knows_what and (knows_when or has_objective)


def _money(value: Any) -> str | None:
    """A customer's own amount as words for the reason ("$400"), or None when it isn't a plain amount."""
    if isinstance(value, bool) or value is None:
        return None
    raw = str(value).replace("$", "").replace(",", "").strip().lower()
    multiplier = 1000 if raw.endswith("k") else 1
    try:
        amount = float(raw.rstrip("k")) * multiplier
    except ValueError:
        return None
    if amount <= 0:
        return None
    return f"${amount:,.0f}" if amount == int(amount) else f"${amount:,.2f}"


def customer_objective(profile: Profile) -> str | None:
    """PLAN_4 stream X3 item 2 (conversations.md: capture -> interpret -> LEVERAGE -> advance; "a customer answer
    should NEVER just become another stored field"): what the customer told us they want to achieve, made the
    objective of the visit. Built only from their own slot values, so every number in it is theirs (the guard
    allows the customer's own numbers and nothing else). None when they have told us nothing to leverage."""
    values = _values(profile)
    payment = _money(values.get("interest.monthly_payment"))
    payoff = _money(values.get("trade_in.payoff"))
    budget = _money(values.get("interest.budget"))
    trade = values.get("trade_in.model")
    if payment:
        return f"so the team can work the numbers toward your {payment}-a-month target"
    if payoff and trade:
        return f"so the team can look at your {trade} in person and see where your {payoff} payoff leaves you"
    if payoff:
        return f"so the team can see where your {payoff} payoff leaves you"
    if budget:
        return f"so the team can show you what fits your {budget} budget"
    if trade:
        return f"so the team can take a real look at your {trade} and give you an actual number"
    return None


def _primary_interest_reason(profile: Profile) -> str:
    values = _values(profile)
    model = values.get("interest.model") or values.get("trade_in.model") or values.get("vehicle.model")
    if objective := customer_objective(profile):
        if model and model != values.get("trade_in.model"):
            return f"to see the {model} in person, {objective}"
        return objective
    return (f"to see the {model} in person and make sure it's the right fit" if model
           else "to see it in person and make sure it's the right fit")


def _fallback_priority_reason(profile: Profile) -> str:
    """No objection was seen: fall back to the customer's own stated
    priority (B4 item 4) - their objective, their timeline, else their main interest."""
    values = _values(profile)
    if objective := customer_objective(profile):
        return objective
    if timeline := values.get("interest.timeline"):
        return f"since you're looking to do this {str(timeline).replace('_', ' ')}, coming by now saves you time later"
    if model := (values.get("interest.model") or values.get("trade_in.model") or values.get("vehicle.model")):
        return f"since you're interested in the {model}, it's worth seeing it in person before you decide"
    return "you'll have real answers instead of guesses"


def _angle_for_attempt(attempt: int, last_objection: str | None, profile: Profile) -> tuple[Angle, str]:
    if attempt == 1:
        return "primary_interest", _primary_interest_reason(profile)
    objective = customer_objective(profile)
    if attempt == 2:
        if last_objection and last_objection in _OBJECTION_REASON:
            reason = _OBJECTION_REASON[last_objection]
            # The objection answered, with their own objective still the point of coming in.
            return "objection", f"{reason}, {objective}" if objective else reason
        return "objection", _fallback_priority_reason(profile)
    return "value_proposition", objective or _VALUE_PROP_BY_TYPE.get(profile.effective_lead_type.value,
                                                                      _VALUE_PROP_BY_TYPE["general"])


def _followup_date(customer_words: str | None, now: datetime) -> str:
    if customer_words:
        from upsell_agent.slots.dates import resolve as resolve_date
        if resolved := resolve_date(customer_words, now):
            return resolved.day.isoformat()
    return (now.date() + timedelta(days=DEFAULT_FOLLOWUP_DAYS)).isoformat()


def plan_day_offer(*, profile: Profile, conversation: ConversationState, built_times: list[dict[str, str]],
                   why: str, asked_day: str | None = None) -> VisitOfferPlan:
    """The customer answered our times with a day of their own ("not Wednesday, what about Monday?"), or
    asked to move their booking to a day: times on that day are offered. It continues the offer they're
    answering, so it isn't another attempt (the first one when nothing was offered before)."""
    record = conversation.visit or VisitState()
    attempt = record.attempts or 1
    angles = record.angles_used or ["primary_interest"]
    _, value_prop = _angle_for_attempt(attempt, None, profile)
    new_record = record.model_copy(update={
        "attempts": attempt, "angles_used": angles, "offered_times": built_times,
        "offered_turn": conversation.turn + 1, "held_over": 0, "declined": False, "pending_pick": None,
        "why": why, "asked_day": asked_day or record.asked_day,
        "asked_turn": conversation.turn + 1 if asked_day else record.asked_turn})
    return VisitOfferPlan(fire=True, attempt=attempt, angle=angles[-1], value_proposition=value_prop,
                          times=built_times, record=new_record.model_dump(), why=why)


def plan_visit(
    *,
    profile: Profile,
    extraction: dict[str, Any],
    conversation: ConversationState,
    active_booking: dict[str, Any] | None,
    built_times: list[dict[str, str]],
    booked_this_turn: bool,
    now: datetime,
    same_attempt: bool = False,
    service: bool = False,
) -> VisitOfferPlan:
    """`active_booking`: tools/booking_tool.find_active_booking()'s result,
    read fresh this turn. `built_times`: the offer already built with
    booking_tool (empty when not eligible, or a booking already exists).
    `booked_this_turn`: decide.py already created a booking this turn (the
    customer's pick matched). `same_attempt`: the time they picked was just
    taken (B5 item 3) - fresh times, but it doesn't count as another attempt."""
    record = conversation.visit or VisitState()

    if same_attempt and built_times and record.attempts:
        why = f"The time the customer picked was just taken: fresh times (still attempt {record.attempts})."
        new_record = record.model_copy(update={"offered_times": built_times, "offered_turn": conversation.turn + 1,
                                               "why": why})
        angle = record.angles_used[-1] if record.angles_used else "primary_interest"
        _, value_prop = _angle_for_attempt(record.attempts, None, profile)
        return VisitOfferPlan(fire=True, attempt=record.attempts, angle=angle, value_proposition=value_prop,
                              times=built_times, record=new_record.model_dump(), why=why)

    if active_booking or booked_this_turn:
        why = "The visit is already booked: no more offers."
        return VisitOfferPlan(record=({**record.model_dump(), "why": why} if conversation.visit else None), why=why)

    # A service offer asked for a day/time instead of naming times (MASTER_PLAN_4 F2): still "just offered".
    just_offered = (bool(record.offered_times or record.service_ask) and record.offered_turn == conversation.turn
                    and conversation.turn > 0)
    if just_offered and declines_visit(extraction):
        objection = str(extraction.get("visit_objection") or "none")
        objections = [*record.objections, objection] if objection != "none" else list(record.objections)
        stopped = record.attempts >= MAX_ATTEMPTS
        handoff = False
        followup_due = None
        if stopped:
            followup_due = _followup_date(extraction.get("visit_later_when"), now)
            handoff = any(q.label == "restricted" for q in conversation.open_questions)
            why = (f"Declined a third time: no more offers in this conversation; a dated follow-up is due "
                  f"{followup_due}" + ("; a staff-only question is still open, so this hands off." if handoff
                                       else "."))
        else:
            why = f"Declined (attempt {record.attempts} of {MAX_ATTEMPTS}): not offered again for a few replies."
        new_record = VisitState(attempts=record.attempts, angles_used=record.angles_used, offered_times=[],
                                offered_turn=record.offered_turn, declined=True, declined_turn=conversation.turn + 1,
                                stopped=stopped, objections=objections, followup_due=followup_due, why=why)
        return VisitOfferPlan(record=new_record.model_dump(), schedule_followup=stopped,
                              followup_due=followup_due, handoff=handoff, why=why)

    if just_offered:
        # Neither a pick nor a decline (a question, say): the times stay on the table for one more reply,
        # without a new offer or a used-up attempt; after that they come off it, and the next offer uses
        # the next angle (architecture §15 decision 115).
        if record.held_over:
            why = "The times offered went unanswered twice: they come off the table."
            return VisitOfferPlan(record={**record.model_dump(), "offered_times": [], "service_ask": False,
                                          "held_over": 0, "why": why},
                                  why=why)
        why = "The customer answered something else: the times offered stay on the table for one more reply."
        return VisitOfferPlan(record={**record.model_dump(), "offered_turn": conversation.turn + 1, "held_over": 1,
                                      "why": why}, why=why)
    if record.stopped:
        return VisitOfferPlan(why="Already declined 3 times: not offered again in this conversation.")
    if record.declined and conversation.turn - record.declined_turn < PARKED_FOR_REPLIES:
        return VisitOfferPlan(why=f"Declined last at reply #{record.declined_turn}: parked for "
                                  f"{PARKED_FOR_REPLIES} replies, not offered again yet.")
    if not built_times and not service:
        return VisitOfferPlan(why="Not eligible for a visit offer yet, or there's nothing to offer.")

    attempt = record.attempts + 1
    last_objection = str(extraction.get("visit_objection") or "") or (record.objections[-1] if record.objections
                                                                       else None)
    angle, value_prop = _angle_for_attempt(attempt, last_objection, profile)
    why = f"Offering a visit (attempt {attempt} of {MAX_ATTEMPTS}, angle: {angle})."
    if service:
        why = (f"Offering a service visit (attempt {attempt} of {MAX_ATTEMPTS}, angle: {angle}): asking which day "
               "and time suit them - no times, no booking (MASTER_PLAN_4 F2).")
    new_record = VisitState(attempts=attempt, angles_used=[*record.angles_used, angle],
                            offered_times=[] if service else built_times, offered_turn=conversation.turn + 1,
                            declined=False, stopped=False, objections=record.objections, followup_due=None,
                            service_ask=service, why=why)
    return VisitOfferPlan(fire=True, attempt=attempt, angle=angle, value_proposition=value_prop,
                          times=[] if service else built_times, record=new_record.model_dump(),
                          service_request=service, why=why)
