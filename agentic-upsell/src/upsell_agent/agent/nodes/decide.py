"""Decide (architecture §8.3, MASTER_PLAN_2 Phase 5): one next step, from the
rules in slots/policy.py, fed the profile, what the customer said, the
conversation state (what we asked and how often) and the lead's status.

It also works out:
- the after-hours choice (MASTER_PLAN_3 B1, agent/after_hours.py): whether
  this reply offers "now or when we open?", is the thank-you after "later",
  or is the morning message;
- urgent-need handoff (MASTER_PLAN_3 B4 item 8, B0.13 decision 26): Extract's
  signal, or the pure-code 48h `interest.needed_by` backstop;
- the visit offer and booking (MASTER_PLAN_3 B4/B5, agent/visit_offer.py,
  tools/booking_tool.py): matching a pick against times we just offered
  (creating the booking before Compose runs, so Guard's booking-wording
  check - architecture §15 decision 60 - always sees a real booking, never
  one this same turn only claims), a plain-language cancel or reschedule of
  an existing booking, and otherwise whether to offer times at all.

Every plan travels in the decision dict; the turn (after the send) acts on
the parts with a side effect still pending (scheduling / cancelling the
after-hours morning message and the dated visit_followup)."""

import dataclasses
import re
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Any

from upsell_agent import ai_studio, clock
from upsell_agent.agent import (
    buyers_order,
    cadence,
    cannot_supply,
    human_contact,
    lead_bucket,
    service_request,
    specialists,
)
from upsell_agent.agent.after_hours import plan_after_hours
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.conversation import ConversationState, VisitState, questions_for_turn
from upsell_agent.agent.language import SPANISH, customer_language, dates_to_english
from upsell_agent.agent.nodes.load_context import load_profile
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.sold_pending import reply_hold
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.templates import first_name
from upsell_agent.agent.visit_offer import MAX_ATTEMPTS as MAX_VISIT_ATTEMPTS
from upsell_agent.agent.visit_offer import VisitOfferPlan, plan_day_offer, plan_visit
from upsell_agent.agent.visit_offer import declines_visit as visit_declines
from upsell_agent.agent.visit_offer import eligible as visit_eligible
from upsell_agent.agent.visit_offer import wants_visit as visit_wants_visit
from upsell_agent.channels.consent import resolve_recipient
from upsell_agent.compliance.opt_out import POSSIBLE_OPT_OUT_REVIEW_CONFIDENCE
from upsell_agent.integrations.dealer_profile import DealerProfile, dealer_profile
from upsell_agent.integrations.platform_client import SlotTakenError
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.policy import (
    UPSET_ALONE_CONFIDENCE,
    UPSET_HANDOFF_CONFIDENCE,
    URGENT_HANDOFF_CONFIDENCE,
    Flags,
    next_action,
    upset_words,
)
from upsell_agent.slots.profile import Profile
from upsell_agent.tools import booking_tool

URGENT_BACKSTOP_HOURS = 48
# PLAN_4 stream Q (client, 25 Sept: "The goal is not to escalate every customer ... strike while the iron is hot
# and get the customer in the dealership"): only an urgent PROBLEM goes to a person straight away - a car that is
# unsafe to drive, or a customer left with no working car. Buying urgency ("I need a truck asap", "by tomorrow",
# another offer expiring, the 48h needed-by backstop) drives the appointment instead: the visit is offered now,
# with the soonest open times. Architecture decision 26 is narrowed accordingly (stream_Q.md).
ESCALATING_URGENT_REASONS = frozenset({"safety_problem", "no_transportation"})
# "Not interested" counts at the same bar as the other signals (MASTER_PLAN_3 C3).
NOT_INTERESTED_CONFIDENCE = 0.8
# A dated next step with no time of its own goes out at this dealer-local hour (Omnichannel PDF §6:
# "dealer-configurable approved default"; ours until a per-dealer setting exists, like VISIT_FOLLOWUP_HOUR).
NEXT_ACTION_DEFAULT_TIME = "10:00"
NEXT_ACTION_TRIGGER = "next_action"
CADENCE_TRIGGER = "cadence_touch"
# "Call me Friday" is a dated next step (Omnichannel PDF §2: "'call me Friday/next month/in a year' creates a dated
# future action"), not a request for a person right now: it doesn't hand off.
_CALL_ME = re.compile(r"\b(call|phone|ring)\s+me\b", re.IGNORECASE)
# A plain-language cancel or reschedule of an EXISTING booking (B5 item 5). Deliberately
# code, not an Extract field: these are rare, high-stakes actions best kept literal.
_CANCEL_BOOKING = re.compile(
    r"\b(can'?t make it|need to cancel|won'?t be able to (?:come|make it)|"
    r"cancel (?:my|the|this) (?:appointment|visit|booking)|have to cancel)\b", re.IGNORECASE)
# Client, 12 Oct 2026: a booking is made only from the customer's own reply picking or agreeing to a time - never
# from the lead email's text (a portal's "Scheduled appointment" note) and never when they say they aren't ready.
UNSOLD_THEME = "unsold_followup"
UNSOLD_INSTRUCTION = ("They visited the dealership and didn't buy. Thank them for coming in, ask one gentle question "
                      "about what held them back (the vehicle, the price or payment, their trade, timing) so you can "
                      "help, and offer a time to come back in.")


def _visit_is_over(booking: dict[str, Any], dealer: DealerProfile, now: datetime) -> bool:
    """The booking is in the past (beyond the no-show window) or already resolved."""
    from upsell_agent.agent import appointment as _appointment
    if str(booking.get("booking_status") or "").lower() in ("completed", "no_show", "noshow", "showed"):
        return True
    at = _appointment.appointment_at(tz=dealer.tz, booking=booking)
    return at is not None and at < now - _appointment.NO_SHOW_AFTER - timedelta(hours=1)


def _new_or_used_from_stock(profile: Profile, state: AgentState) -> None:
    """Betsy, 12-16 Oct 2026 ("can the ai see the vehicle that's in the lead"): when this turn's stock search found
    exactly the vehicle they want, its listing says new or used - never asked (held for this turn only)."""
    from upsell_agent.slots.profile import SlotValue
    if profile.is_current("interest.new_or_used"):
        return
    pack = state.context_pack or {}
    wanted = str((profile.slots.get("interest.model") or SimpleNamespace(value="")).value or "").lower()
    records = [r for r in pack.get("inventory") or []
               if (pack.get("stock_search") or {}).get("exact") or (r.get("model") and str(r["model"]).lower() in wanted)]
    conditions = {str(r.get("condition") or "").lower() for r in records} - {""}
    if len(conditions) == 1 and (cond := conditions.pop()) in ("new", "used"):
        profile.slots["interest.new_or_used"] = SlotValue(path="interest.new_or_used", value=cond, state="filled",
                                                          source="stock", fact_id="stock")


def _times_on_the_table(plan: VisitOfferPlan, conversation: ConversationState) -> VisitOfferPlan | None:
    """The times we just offered, shown again: the customer answered something else ("thanks") and the offer stays
    open for this reply - the reply asks which one works instead of ending with nothing."""
    record = {**((conversation.visit.model_dump() if conversation.visit else {}) or {}), **(plan.record or {})}
    times = record.get("offered_times") or []
    if not times or record.get("declined") or record.get("stopped"):
        return None
    angles = record.get("angles_used") or []
    return VisitOfferPlan(fire=True, attempt=int(record.get("attempts") or 1), angle=angles[-1] if angles else None,
                          value_proposition=None, times=times, record=plan.record,
                          why="The times we offered are still open: asking which one works.")


def _touch_takes_an_offer(ctx: TurnContext, state: AgentState) -> bool:
    """A scheduled follow-up the AI writes (not a fixed text such as the "{FirstName}?" nudge) ends with the visit and
    two real times (live, 21 Oct 2026: touches said "a quick visit lets you see it" with no time and no question)."""
    if state.trigger != CADENCE_TRIGGER:
        return False
    touch = plan_cadence_touch_context(ctx.lead_state, state.customer_name) or {}
    return touch.get("theme") != cadence.NAME_NUDGE.id and not touch.get("fixed_text")


# The actions that end a reply without a next step: when one fires, the visit is offered instead (Betsy, 20 Oct 2026).
_DEAD_ENDS = frozenset({"acknowledge", "qualified", "partly_qualified"})
_NOT_READY = re.compile(
    r"\b(numbers? first|price first|need (the |some )?(numbers|pricing|price|info|information|details)|"
    r"not (ready|yet|sure)|think about it|let me (think|check|see)|get back to you|(will|i'?ll) let you know|"
    r"before (i|we) (come|book|schedule|commit)|no rush|maybe later)\b", re.IGNORECASE)
_BOOKS_FROM_OWN_REPLY = ("inbound_message", "resume_at_opening")

_RESCHEDULE_HINT = re.compile(
    r"\b(instead|reschedule|move (?:it|my appointment)|change (?:it|the time)|"
    r"can we make it|different time|push it)\b", re.IGNORECASE)
# The email or phone the customer gives when we ask for it to book a picked time (B5 item 3). Used for
# that booking only - never saved as marketing consent (B0.4).
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}")


def _found(pattern: re.Pattern, text: str) -> str | None:
    match = pattern.search(text or "")
    return match.group(0) if match else None


def possible_opt_out(extraction: dict[str, Any]) -> bool:
    """Extract thinks the message may be an opt-out, sure enough for REVIEW (C1 item 3)."""
    return bool(extraction.get("possible_opt_out")) and float(
        extraction.get("opt_out_confidence") or 0.0) >= POSSIBLE_OPT_OUT_REVIEW_CONFIDENCE


def hold_questions_reason(extraction: dict[str, Any], compliance: dict[str, Any] | None) -> str | None:
    if possible_opt_out(extraction):
        return (f"the message may be an opt-out (confidence {float(extraction.get('opt_out_confidence') or 0):.2f}); "
                "a plain reply while staff review it, no asks and no offers")
    if (compliance or {}).get("quiet_hours"):
        return "an outbound conversation outside 8:00-21:00 customer time: the team picks up at 8:00"
    return None


def urgency(extraction: dict[str, Any], *, backstop: bool) -> tuple[str | None, str]:
    """("escalate" | "buying" | None, reason) for this message (PLAN_4 stream Q). Extract's urgent signal at the
    handoff bar escalates only for a genuine problem (ESCALATING_URGENT_REASONS); any other urgency, and the
    pure-code 48h needed-by backstop, is buying urgency: the visit is offered now instead of a handoff."""
    reason = str(extraction.get("urgent_reason") or "none")
    clear = bool(extraction.get("urgent")) and float(
        extraction.get("urgent_confidence") or 0.0) >= URGENT_HANDOFF_CONFIDENCE
    if clear and reason in ESCALATING_URGENT_REASONS:
        return "escalate", reason
    if clear:
        return "buying", reason if reason != "none" else "needed_soon"
    if backstop:
        return "buying", "needed_within_48h"
    return None, "none"


def _within_48h(needed_by: str, now: datetime, dealer_tz) -> bool:
    """The pure-code urgency backstop (MASTER_PLAN_3 B0.13 decision 26,
    B4 item 8): `interest.needed_by` (already resolved to a real date by
    Validate, slots/dates.py) falls within 48 hours. `needed_by` carries no
    time of day, so "today" or "tomorrow" is treated as within 48h from any
    time of day (the worst case, "tomorrow" said just after midnight, is
    still under 48h); the day after that is never treated as within 48h,
    since by the same worst case it could be over."""
    try:
        day = date.fromisoformat(str(needed_by)[:10])
    except ValueError:
        return False
    local_now = now.astimezone(dealer_tz)
    return 0 <= (day - local_now.date()).days <= 1


async def _dealer_local_display(when: datetime, dealer: DealerProfile) -> dict[str, str]:
    local = when.astimezone(dealer.tz)
    return {"iso": local.isoformat(), "date": local.strftime("%Y-%m-%d"), "time": local.strftime("%H:%M"),
           "display": f"{local.strftime('%A')} at {local.strftime('%I:%M %p').lstrip('0')}"}


# The furthest ahead a day the customer names is looked up for open times.
DAY_REQUEST_MAX_DAYS = 30


_SAME_TIME = re.compile(r"\b(?:same time|same hour|that time works)\b", re.IGNORECASE)


def _same_time_as(text: str, booking: dict[str, Any] | None) -> str:
    """Stream Q: "Same time works" answering the new day's times, while moving a booking, means the booking's
    own time on that day (seen: "Friday instead?" ... "Same time works" was answered with another time)."""
    at = str((booking or {}).get("bookingTime") or "")
    if not _SAME_TIME.search(text or "") or not re.fullmatch(r"\d{1,2}:\d{2}", at):
        return text
    hour, minute = (int(x) for x in at.split(":"))
    return f"{(hour - 1) % 12 + 1}:{minute:02d} {'pm' if hour >= 12 else 'am'}"


def _day_words(day: date) -> str:
    return f"{day.strftime('%A')}, {day.strftime('%B')} {day.day}"


async def _times_for_day(ctx: TurnContext, state: AgentState, dealer: DealerProfile, now: datetime,
                         request: booking_tool.DayRequest) -> tuple[list[dict[str, str]], dict[str, Any]]:
    """Open times on the day the customer asked for (or the next day that has any), formatted for the
    offer, and what Compose needs to say about it."""
    today = now.astimezone(dealer.tz).date()
    span = min(max(booking_tool.DAYS_AHEAD, (request.day - today).days + booking_tool.DAYS_AHEAD),
               DAY_REQUEST_MAX_DAYS)
    existing = await booking_tool.existing_bookings(state.dealer_id, dealer, now, days_ahead=span)
    available = booking_tool.available_times(dealer, existing, now, exclude_lead_id=state.lead_id or "",
                                             days_ahead=span)
    times, day, on_day = booking_tool.times_on_day(available, request, dealer)
    zones = tuple(((ctx.compliance or {}).get("zone") or {}).get("zones") or ())
    built = booking_tool.format_offer(times, dealer, customer_zones=zones)
    info = {"asked": _day_words(request.day), "part": request.part_words, "on_that_day": on_day,
            "offered_day": _day_words(day) if day else None}
    return built, info


# How many replies after the customer asked for a day their bare times still mean that day.
ASKED_DAY_REPLIES = 2


def _live_asked_day(conversation: ConversationState, dealer: DealerProfile, now: datetime) -> str | None:
    """The day the customer asked for (PLAN_4 stream X3 item 3), while it is still today or later and was asked
    within the last couple of replies (an old request doesn't turn a later "3pm" into a booking)."""
    visit = conversation.visit
    asked = visit.asked_day if visit else None
    if not asked or conversation.turn - visit.asked_turn > ASKED_DAY_REPLIES:
        return None
    try:
        day = date.fromisoformat(asked)
    except ValueError:
        return None
    return asked if day >= now.astimezone(dealer.tz).date() else None


_COMING_TODAY = re.compile(
    r"\bon (?:my|our) way\b|\bheading (?:over|in|there|your way)\b|\b(?:coming|come|stopping|stop|swing|swinging|"
    r"heading|headed|be there|be over|going)\b[^.?!]{0,40}\b(?:now|today|tonight|this (?:afternoon|evening)|soon|"
    r"shortly|in a (?:bit|few))\b", re.IGNORECASE)
_ASKED_ARRIVAL = re.compile(r"\bwhat time (?:will|would|do|can|are) you\b[^?]{0,30}\b(?:arrive|be here|get here|come|"
                            r"stop by|be in)\b|\bwhen (?:will|would) you (?:arrive|be here|get here)\b", re.IGNORECASE)


def arrival_today(text: str, state: AgentState, dealer: DealerProfile, now: datetime) -> dict[str, str] | None:
    """Client, 13 Oct 2026 (Artem Petrov: "We coming to look at it now" ... "520" - the AI "didn't acknowledge the time
    and didn't confirm an appt nor book it"): a customer on their way today who gives the time they'll arrive has that
    time booked, as a pick - when it is today, still ahead and inside opening hours. A visit, not a slot on the grid."""
    at = booking_tool.bare_time(text)
    if at is None:
        return None
    memory = (state.context_pack or {}).get("working_memory") or []
    said = [m.get("text") or "" for m in memory[-6:] if m.get("direction") == "inbound"] + [text]
    asked = [m.get("text") or "" for m in memory[-3:] if m.get("direction") == "outbound"]
    if not (any(_COMING_TODAY.search(t) for t in said) or any(_ASKED_ARRIVAL.search(t) for t in asked)):
        return None
    local = now.astimezone(dealer.tz)
    when = datetime.combine(local.date(), at, tzinfo=dealer.tz)
    hours = dealer.hours.get(local.weekday())
    if when <= local or not hours or not (hours[0] <= at <= hours[1]):
        return None
    return {"iso": when.isoformat(), "date": when.strftime("%Y-%m-%d"), "time": when.strftime("%H:%M"),
            "display": f"today at {when.strftime('%I:%M %p').lstrip('0')}", "arrival": True}


def _part_on_known_day(text: str, asked_day: str | None, offered: list[dict[str, str]], dealer: DealerProfile,
                       now: datetime) -> booking_tool.DayRequest | None:
    """"Morning is better" with no day named: that part of the day they asked for, else of the day we offered."""
    part, words = booking_tool.part_of_day(text)
    day = asked_day or (offered[0]["date"] if offered else None)
    if part is None or not day or booking_tool.bare_time(text):
        return None
    return booking_tool.DayRequest(day=date.fromisoformat(day), part=part, part_words=words)


def _day_offer_why(info: dict[str, Any]) -> str:
    asked = info["asked"] + (f" ({info['part']})" if info.get("part") else "")
    if info["on_that_day"]:
        return f"The customer asked for {asked}: offering open times that day."
    return f"The customer asked for {asked}, which has no open time: offering {info['offered_day']} instead."


async def _visit_and_booking(
    ctx: TurnContext, state: AgentState, profile: Profile, conversation: ConversationState,
    extraction: dict[str, Any], *, dealer: DealerProfile, now: datetime, text: str, hold: str | None,
    after_hours_blocking: bool, buying_urgency: bool = False, force_offer: bool = False,
) -> tuple[dict[str, Any], Any]:
    """Everything B4/B5 needs the database for, done once: reads the active
    booking fresh (decision 60), matches a pick or a cancel/reschedule
    against an existing booking, creates the booking before Compose runs
    when a pick matches, and (only then) builds the next offer's times.
    Returns (visit context for Compose/Guard, the VisitOfferPlan)."""
    lead_id = state.lead_id or ""
    active_booking = await booking_tool.find_active_booking(state.dealer_id, ctx.lead)
    if active_booking is not None and _visit_is_over(active_booking, dealer, now):
        # Live, 20 Oct 2026 (Sadhana: a follow-up on Oct 20 said "You're all set for Thursday, October 15"): a visit whose
        # time has passed isn't one to confirm - the conversation goes on toward a new one.
        active_booking = None
    booked_this_turn = False
    visit_ctx: dict[str, Any] = {"status": None, "display": None, "just_booked": False, "stopped": False,
                                 "ask_contact": None}

    if active_booking:
        booking_id = str(active_booking["_id"])
        status = active_booking.get("booking_status", "pending")
        visit_ctx.update(status=status, display=None)
        if _CANCEL_BOOKING.search(text):
            result = await booking_tool.cancel_booking(platform=ctx.platform, dealer_id=state.dealer_id,
                                                        dealer=dealer, booking_id=booking_id)
            visit_ctx = {"status": "cancelled", "display": None, "just_booked": False, "stopped": False,
                        "ask_contact": None, "cancelled_this_turn": True, "booking_id": result["booking_id"]}
        elif conversation.awaiting_visit_pick and conversation.visit and booking_tool.match_pick(
                (pick_text := _same_time_as(text, active_booking)), conversation.visit.offered_times, dealer, now,
                available=booking_tool.available_times(
                    dealer, await booking_tool.existing_bookings(state.dealer_id, dealer, now), now,
                    exclude_lead_id=lead_id)).matched:
            # MASTER_PLAN_3 C5 (Omnichannel PDF §8): the customer answered N to the day-before confirmation,
            # we offered new times, and this is their pick: the booking moves to it (the old confirmation and
            # no-show timers are replaced when the appointment is set again).
            existing = await booking_tool.existing_bookings(state.dealer_id, dealer, now)
            available = booking_tool.available_times(dealer, existing, now, exclude_lead_id=lead_id)
            picked = booking_tool.match_pick(pick_text, conversation.visit.offered_times, dealer, now,
                                             available=available).matched
            if picked and datetime.fromisoformat(picked["iso"]) in available:
                when = datetime.fromisoformat(picked["iso"])
                result = await booking_tool.move_booking(platform=ctx.platform, dealer_id=state.dealer_id,
                                                          dealer=dealer, booking_id=booking_id,
                                                          current_status=status, when=when)
                visit_ctx = {"status": result["booking_status"], "display": picked["display"], "just_booked": True,
                             "stopped": False, "ask_contact": None, "moved_this_turn": True,
                             "booking_id": result["booking_id"]}
        elif ((conversation.awaiting_visit_pick and conversation.visit) or _RESCHEDULE_HINT.search(text)) and (
                not visit_declines(extraction)) and (request := booking_tool.preferred_day(text, dealer, now)):
            # A day but no time ("what about Monday?", "can we move it to Monday?"): that day's open times.
            built, info = await _times_for_day(ctx, state, dealer, now, request)
            if built:
                visit_ctx["day_request"] = info
                return visit_ctx, plan_day_offer(profile=profile, conversation=conversation, built_times=built,
                                                 why=_day_offer_why(info), asked_day=request.day.isoformat())
        elif _RESCHEDULE_HINT.search(text):
            from upsell_agent.slots.dates import resolve as resolve_date
            resolved = resolve_date(text, now.astimezone(dealer.tz))
            if resolved and isinstance(resolved.value, datetime):
                existing = await booking_tool.existing_bookings(state.dealer_id, dealer, now)
                available = booking_tool.available_times(dealer, existing, now, exclude_lead_id=lead_id)
                candidate = datetime.combine(resolved.day, resolved.value.time(), tzinfo=dealer.tz)
                if candidate in available:
                    result = await booking_tool.move_booking(platform=ctx.platform, dealer_id=state.dealer_id,
                                                              dealer=dealer, booking_id=booking_id,
                                                              current_status=status, when=candidate)
                    shown = await _dealer_local_display(candidate, dealer)
                    visit_ctx = {"status": result["booking_status"], "display": shown["display"], "just_booked": True,
                                "stopped": False, "ask_contact": None, "moved_this_turn": True,
                                "booking_id": result["booking_id"]}
        plan = plan_visit(profile=profile, extraction=extraction, conversation=conversation,
                          active_booking=active_booking, built_times=[], booked_this_turn=False, now=now)
        return visit_ctx, plan

    # MASTER_PLAN_4 F2 (client, scope Q16): a service visit is requested with notes, never booked here.
    if service_request.is_service_visit(profile):
        said = [text] + [m.get("text") or "" for m in (state.context_pack or {}).get("working_memory", [])
                         if m.get("direction") == "inbound"]
        return service_request.plan(profile=profile, extraction=extraction, conversation=conversation, text=text,
                                    customer_texts=said, dealer=dealer, now=now, hold=hold,
                                    after_hours_blocking=after_hours_blocking)

    # No active booking: is the customer's message a pick against what we just offered, or the
    # email/phone we asked for to book a time they already picked?
    pending = conversation.visit.pending_pick if conversation.visit else None
    if not pending and not active_booking and (arrival := arrival_today(text, state, dealer, now)):
        pending = arrival  # "we're coming now" ... "520": that time today, booked like a time they picked
    asked_day = _live_asked_day(conversation, dealer, now)
    slot_taken = False
    # B5 item 8: a visit request that names its own time ("can I come see it tomorrow at 10?"),
    # at any hour, has that time checked and booked straight away.
    asks_for_a_time = visit_wants_visit(extraction)
    # PLAN_4 stream X3 item 3: a bare time or a part of the day after they asked for a day is about that day.
    about_asked_day = bool(asked_day and (booking_tool.bare_time(text) or booking_tool.part_of_day(text)[0]))
    customer_picks = state.trigger in _BOOKS_FROM_OWN_REPLY and not _NOT_READY.search(text)
    if (pending or asks_for_a_time or about_asked_day or (conversation.awaiting_visit_pick and conversation.visit)) \
            and customer_picks and not hold and not after_hours_blocking:
        existing = await booking_tool.existing_bookings(state.dealer_id, dealer, now)
        available = booking_tool.available_times(dealer, existing, now, exclude_lead_id=lead_id)
        picked = pending
        offered = conversation.visit.offered_times if conversation.awaiting_visit_pick and conversation.visit else []
        wanted = None
        if offered or asks_for_a_time or asked_day:
            pick = booking_tool.match_pick(text, offered, dealer, now, available=available, prefer_day=asked_day)
            picked, wanted = pick.matched or pending, pick.wanted
        if not picked and wanted and not visit_declines(extraction):
            # Stream Q: they named a time that isn't open ("Wednesday after work, like 6pm?", "3pm"): the open
            # times nearest to it - never a dropped booking or a handoff.
            built = booking_tool.format_offer(
                booking_tool.nearest_times(available, wanted, dealer), dealer,
                customer_zones=tuple(((ctx.compliance or {}).get("zone") or {}).get("zones") or ()))
            if built:
                shown = await _dealer_local_display(wanted, dealer)
                visit_ctx["time_not_open"] = shown["display"]
                wanted_day = wanted.astimezone(dealer.tz).date()
                if built[0]["date"] != wanted_day.isoformat():
                    # PLAN_4 stream X3 item 3: never move to another day without saying why.
                    visit_ctx["day_request"] = {"asked": _day_words(wanted_day), "part": None, "on_that_day": False,
                                                "offered_day": _day_words(date.fromisoformat(built[0]["date"]))}
                return visit_ctx, plan_day_offer(
                    profile=profile, conversation=conversation, built_times=built, asked_day=wanted_day.isoformat(),
                    why=f"The customer asked for {shown['display']}, which isn't open: offering the nearest open times.")
        if not picked and not pending and not visit_declines(extraction) and (
                request := booking_tool.preferred_day(text, dealer, now) or _part_on_known_day(
                    text, asked_day, offered, dealer, now)):
            # A day but no time, answering our times or asking to come in ("not Wednesday, what about
            # Monday?", "can I come Monday afternoon?"): offer that day's open times, not the earliest ones.
            # PLAN_4 stream X3 item 3: "morning is better" after asking for Saturday is Saturday morning.
            built, info = await _times_for_day(ctx, state, dealer, now, request)
            if built:
                visit_ctx["day_request"] = info
                return visit_ctx, plan_day_offer(profile=profile, conversation=conversation, built_times=built,
                                                 why=_day_offer_why(info), asked_day=request.day.isoformat())
        if picked and not picked.get("arrival") and datetime.fromisoformat(picked["iso"]) not in available:
            # B5 item 3: taken since we offered it - fresh times instead, not a booking.
            slot_taken = True
            visit_ctx["slot_taken"] = picked["display"]
        elif picked:
            email = resolve_recipient(ctx.lead, ctx.customer, "email") or _found(_EMAIL, text)
            phone = resolve_recipient(ctx.lead, ctx.customer, "sms") or _found(_PHONE, text)
            if not email or not phone:
                visit_ctx.update(display=picked["display"], ask_contact="email" if not email else "phone")
                record = (conversation.visit or VisitState()).model_copy(update={
                    "pending_pick": picked, "why": f"Picked {picked['display']}; waiting for their "
                                                  f"{visit_ctx['ask_contact']} to book it."})
                plan = VisitOfferPlan(record=record.model_dump(), why=record.why or "")
                return visit_ctx, plan
            try:
                result = await booking_tool.ensure_booking(
                    ctx.platform, dealer_id=state.dealer_id, dealer=dealer, lead=ctx.lead, lead_id=lead_id,
                    customer_name=state.customer_name or "there", email=email, phone=phone,
                    when=datetime.fromisoformat(picked["iso"]), notes=_customer_summary(profile))
            except SlotTakenError:
                # The CRM's own capacity check (PLAN_4 C1) says the slot filled up since we read it (staff
                # booked it a moment ago): fresh times instead, exactly like B5 item 3's own check.
                result = None
                slot_taken = True
                visit_ctx["slot_taken"] = picked["display"]
            if result is not None:
                booked_this_turn = True
                visit_ctx = {"status": result["booking_status"], "display": picked["display"],
                            "just_booked": not result["already_existed"], "stopped": False, "ask_contact": None,
                            "booking_id": result["booking_id"]}

    if booked_this_turn:
        plan = plan_visit(profile=profile, extraction=extraction, conversation=conversation, active_booking=None,
                          built_times=[], booked_this_turn=True, now=now)
        if conversation.visit:
            plan.record = {**conversation.visit.model_dump(), "pending_pick": None, "offered_times": [],
                           "why": plan.why}
        return visit_ctx, plan

    built_times: list[dict[str, str]] = []
    # Stream Q: three unanswered offers are enough (seen: "attempt 4 of 3" when the customer never picked nor
    # declined); after that a visit is offered again only when they ask to come in.
    offers_left = (not conversation.visit or conversation.visit.attempts < MAX_VISIT_ATTEMPTS
                   or visit_wants_visit(extraction))
    if not hold and not after_hours_blocking and (slot_taken or (
            offers_left and (buying_urgency or force_offer or visit_eligible(profile, extraction, conversation.turn)))):
        # Client, 16 Oct 2026 (appointment first): a day they named ("Probably Saturday") gets that day's times, whatever
        # the reader made of the message - never the earliest times plus "or would you prefer Saturday?".
        request = (booking_tool.preferred_day(text, dealer, now)
                   if text and not slot_taken and state.trigger in _BOOKS_FROM_OWN_REPLY
                   and not visit_declines(extraction) and not _NOT_READY.search(text) else None)
        if request is not None:
            built, info = await _times_for_day(ctx, state, dealer, now, request)
            if built:
                visit_ctx["day_request"] = info
                return visit_ctx, plan_day_offer(profile=profile, conversation=conversation, built_times=built,
                                                 why=_day_offer_why(info), asked_day=request.day.isoformat())
        existing = await booking_tool.existing_bookings(state.dealer_id, dealer, now)
        available = booking_tool.available_times(dealer, existing, now, exclude_lead_id=lead_id)
        customer_zones = tuple(((ctx.compliance or {}).get("zone") or {}).get("zones") or ())
        built_times = booking_tool.format_offer(booking_tool.offer_times(available), dealer,
                                                customer_zones=customer_zones)
    plan = plan_visit(profile=profile, extraction=extraction, conversation=conversation, active_booking=None,
                      built_times=built_times, booked_this_turn=False, now=now, same_attempt=slot_taken,
                      force=force_offer)
    if slot_taken and plan.record:
        plan.record["pending_pick"] = None
    visit_ctx["stopped"] = bool((plan.record or {}).get("stopped")) if plan.record else bool(
        conversation.visit and conversation.visit.stopped)
    return visit_ctx, plan


# "Not interested anymore" given as its own reason (seen with gpt-5-mini, stream Q: the reason field held the
# customer's whole message, so the lead was handed off without the ask-why the client requires). Restating the
# objection is not a reason: only words that say WHY count.
_NOT_A_REASON = re.compile(
    r"^(?:(?:i'?m|i am|we'?re|we are)\s+)?(?:just\s+|really\s+|actually\s+)?(?:not|no longer|no more)\s+"
    r"(?:really\s+)?(?:interested|in the market|looking|shopping|buying)(?:\s+(?:any\s?more|now|right now|at this time|"
    r"in (?:it|this|that|the \w+)))*$"
    r"|^(?:i'?m|i am|we'?re)\s+(?:good|all good|fine|ok(?:ay)?|set)(?:\s+(?:thanks|thank you|for now))*$"
    r"|^(?:no thanks?|no thank you|nah|nope|pass|not anymore|never ?mind|changed my mind)$", re.IGNORECASE)


def real_not_interested_reason(reason: Any) -> str | None:
    """The customer's reason for not being interested, or None when the "reason" only restates the objection."""
    text = re.sub(r"[^\w\s']", " ", str(reason or "")).strip()
    text = re.sub(r"\s+", " ", text)
    if not text or _NOT_A_REASON.match(text):
        return None
    return str(reason).strip()


def not_interested_mode(extraction: dict[str, Any], conversation: ConversationState) -> tuple[str | None, str | None]:
    """(mode, reason) for "not interested / no longer in the market / I'm
    good" (MASTER_PLAN_3 C3, client scope Q10): the AI asks why, once; with a
    reason (or the same answer again after we asked), it notes it and hands
    the lead to a person, who alone may close it."""
    reason = real_not_interested_reason(extraction.get("not_interested_reason"))
    said = bool(extraction.get("not_interested")) and float(
        extraction.get("not_interested_confidence") or 0.0) >= NOT_INTERESTED_CONFIDENCE
    if conversation.awaiting_not_interested_reason and (said or reason):
        return "handoff", reason
    if not said:
        return None, None
    if reason:
        return "handoff", reason
    return ("handoff" if conversation.not_interested else "ask_why"), None


def plan_next_action(extraction: dict[str, Any], *, now: datetime, dealer: DealerProfile, channel: str,
                     text: str, awaiting_when: bool = False) -> dict[str, Any] | None:
    """A dated next step the customer asked for (Omnichannel PDF §2 "specific
    timing wins", §6): their own words (`next_contact_when`, or the time they
    gave when declining a visit), resolved in code (slots/dates.py), never by
    the model. Only a date after today counts; one we can't work out isn't a
    dated next step (the router then treats the reply as contact without one).
    The §6 fields: date, time (theirs, else the dealer default), channel,
    owner, context notes, who entered it."""
    from upsell_agent.slots.dates import resolve as resolve_date

    words = extraction.get("next_contact_when") or (
        extraction.get("visit_later_when") if extraction.get("declines_visit") else None) or (
        # Their answer to "what time works best?" is the time, whatever Extract made of it.
        text if awaiting_when else None)
    local_now = now.astimezone(dealer.tz)
    # Betsy, 21 Oct 2026 (item 9): "I'm busy, text me at 5" / "in 2 hours" - a time later today counts too, but only
    # for getting back to them: "can I come in at 4 today?" is a visit (booking), never a check-back.
    busy = awaiting_when or bool(BUSY_NOW.search(text or "") or _CHECK_BACK_ME.search(text or ""))
    later = (later_today(str(words or ""), text, local_now, busy=True)
             if busy and not _COMING_IN.search(text or "") else None)
    if later:
        return {**later, "channel": channel, "owner": "ai", "entered_by": "ai",
                "call_requested": bool(_CALL_ME.search(text or "")),
                "context_notes": f"The customer is busy and asked us to get back to them {later['words']!r}: "
                                 f"{(text or '').strip()[:300]}"}
    if not words:
        return None
    resolved = resolve_date(str(words), local_now)
    if resolved is None or resolved.day <= local_now.date():
        return None
    given = isinstance(resolved.value, datetime)
    at = resolved.value.strftime("%H:%M") if given else (dealer.followup_default_time or NEXT_ACTION_DEFAULT_TIME)
    day = resolved.day
    call = bool(_CALL_ME.search(text or ""))
    return {"date": day.isoformat(), "time": at, "time_given": given, "approximate": resolved.approximate,
            "words": str(words), "display": f"{day.strftime('%A')}, {day.strftime('%B')} {day.day}",
            "channel": channel, "owner": "ai", "entered_by": "ai", "call_requested": call,
            "context_notes": (f"The customer asked us to {'call' if call else 'get back to'} them {words!r}: "
                              f"{text.strip()[:300]}")}


# "My name is Sal" - a first name only (Betsy, 21 Oct 2026, item 10: the AI confirms the full name if needed).
_FIRST_NAME_ONLY = re.compile(r"\b(?:my\s+name\s+is|my\s+name'?s|call\s+me|i\s+go\s+by|this\s+is)\s+"
                              r"([A-Z][a-z'-]+)\b(?!\s+[A-Z])")


# Busy right now (Betsy, 21 Oct 2026, item 9): "I'm busy", "at work", "can't talk right now", "talk later",
# "I'll text you tomorrow". Without a time the AI asks when; with one, it checks back then.
BUSY_PHRASES = [
    "i'm busy", "im busy", "i am busy", "a bit busy", "at work", "i'm working", "i'm driving", "im driving",
    "in a meeting", "with a client", "with a customer", "tied up", "can't talk right now", "cant talk right now",
    "can't talk now", "can't text right now", "can't chat right now", "talk later", "talk to you later",
    "text you later", "text me later", "chat later", "i'll text you", "i will text you", "i'll message you",
    "i'll get back to you", "let me get back to you", "catch you later", "hit you up later", "not a good time",
]
# On: a busy customer is asked what time works and checked back then (AI Studio -> Conversation rules).
BUSY_RULE = True


class _Busy:
    """Matches a message in which the customer says they're busy (BUSY_PHRASES), read at call time so AI Studio's
    list applies at once."""

    def search(self, text: str | None):
        if not BUSY_RULE or not text:
            return None
        lowered = re.sub(r"\s+", " ", str(text).lower().replace("\u2019", "'"))
        return next((m for p in BUSY_PHRASES if p.strip()
                     and (m := re.search(rf"\b{re.escape(p.strip().lower())}\b", lowered))), None)


BUSY_NOW = _Busy()
# "Text me at 5", "call me back in an hour", "check back with me later".
_CHECK_BACK_ME = re.compile(r"\b(?:text|call|message|ping|msg|hit|reach|get\s+back\s+to|check\s+(?:back\s+)?(?:in\s+)?with)"
                            r"\s+(?:me|us)\b", re.IGNORECASE)
# Talking about a visit: their time is for coming in, not for us to get back to them.
_COMING_IN = re.compile(r"\b(?:come\s+(?:in|by|over|down)|stop\s+by|swing\s+by|drop\s+by|visit|appointment|appt|"
                        r"test\s+drive|see\s+(?:it|the\s+car|the\s+truck))\b", re.IGNORECASE)
_IN_RELATIVE = re.compile(r"\bin\s+(?:about\s+|like\s+|an?\s+)?(\d+|an?|one|two|three|half\s+an?)?\s*"
                          r"(minutes?|mins?|hours?|hrs?|hr)\b", re.IGNORECASE)
_WORD_NUMBER = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3}
# A check-back sooner than this isn't one: the conversation is still going.
LATER_TODAY_MIN = timedelta(minutes=10)


def later_today(words: str, text: str, local_now: datetime, *, busy: bool) -> dict[str, Any] | None:
    """A check-back later today, in the dealer's time: "in 2 hours", "in 30 min", "at 5" (with "today"/"tonight"
    or while saying they're busy). A bare time already past today means tomorrow at that time. None otherwise -
    days after today are plan_next_action's usual dated step."""
    from upsell_agent.slots.dates import _day_of, _time_of
    said = " ".join(x for x in (words, text if busy or not words else "") if x)
    # "after 5", "around 6", "by 7" name a time as surely as "at 5".
    said = re.sub(r"\b(?:after|around|about|by)\s+(?=\d{1,2}(?::\d{2})?\b(?!\s*(?:min|hour|hr|mile|k\b)))", "at ",
                  said, flags=re.IGNORECASE)
    when: datetime | None = None
    if m := _IN_RELATIVE.search(said):
        raw = (m.group(1) or "1").lower()
        amount = 0.5 if raw.startswith("half") else float(raw) if raw.isdigit() else float(_WORD_NUMBER.get(raw, 1))
        unit = m.group(2).lower()
        when = local_now + (timedelta(hours=amount) if unit.startswith("h") else timedelta(minutes=amount))
        if when - local_now < LATER_TODAY_MIN:
            return None
        if when.date() != local_now.date():
            return None
        display = when.strftime("%-I:%M %p").replace(":00 ", " ")
        return {"date": when.date().isoformat(), "time": when.strftime("%H:%M"), "time_given": True,
                "approximate": True, "words": m.group(0), "display": f"today around {display}", "same_day": True}
    at = _time_of(said)
    if at is None:
        return None
    day = _day_of(said, local_now.date(), local_now)
    if day is not None and day.day != local_now.date():
        return None  # another day: the usual dated step
    if day is None and not busy and not words:
        return None
    when = local_now.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
    tomorrow = False
    if when - local_now < LATER_TODAY_MIN:
        if day is not None:
            return None  # "today at 9" said at 10: nothing to schedule today
        when += timedelta(days=1)
        tomorrow = True
    display = when.strftime("%-I:%M %p").replace(":00 ", " ")
    return {"date": when.date().isoformat(), "time": when.strftime("%H:%M"), "time_given": True,
            "approximate": False, "words": str(words or text).strip()[:80],
            "display": (f"tomorrow, {when.strftime('%A')}, at {display}" if tomorrow else f"today at {display}"),
            "same_day": not tomorrow}


#: "What are you driving now?" asks about the car they'd trade in, so it counts as that slot's ask.
TOUCH1_ENDING_SLOT = "trade_in.has_trade"


def _trade_in_known(profile: Profile) -> bool:
    """The customer has already told us what they drive, so Touch 1's closing
    question is dropped (client, 1 Oct 2026: "EXCEPT when a trade-in is
    already indicated")."""
    values = profile.values(include_stale=True)
    if values.get("trade_in.has_trade") is False:
        return True  # they said they have nothing to trade: asking again would be re-asking
    return any(values.get(p) for p in ("trade_in.has_trade", "trade_in.model", "trade_in.make", "trade_in.year"))


def _vehicle_of_interest(profile: Profile) -> str | None:
    values = profile.values(include_stale=True)
    model = values.get("interest.model")
    if not model:
        return None
    # Stream X2: "{vehicle_year} {vehicle_model}" (Omnichannel PDF §3) when the year is known.
    year = values.get("interest.year")
    return f"{year} {model}" if year and str(year) not in str(model) else str(model)


def _service_vehicle(profile: Profile) -> str | None:
    """The car a service lead wants serviced, in the customer's own words ("2021 Camry"), if we know its model."""
    values = profile.values(include_stale=True)
    if not values.get("vehicle.model"):
        return None
    return " ".join(str(values[p]) for p in ("vehicle.year", "vehicle.make", "vehicle.model") if values.get(p))


def is_service_lead(profile: Profile) -> bool:
    return profile.lead_type == LeadType.SERVICE


def plan_touch1(profile: Profile, dealer: DealerProfile, customer_first_name: str | None,
                origin: str | None = None) -> dict[str, Any]:
    """Touch 1's required structure (Omnichannel PDF §3, MASTER_PLAN_3 C4):
    the client's opening, then the answers, then the mandatory closing
    question. Decision 34 (B1/B4 replacing the ending) is **reversed** by the
    client's own answer of 1 Oct 2026: the question is always asked, unless a
    trade-in is already indicated. It is one of the message's two questions,
    so Compose gets at most one other ask alongside it.

    `origin` (6 Oct 2026): an outbound lead gets an opening line that doesn't claim they reached out first
    (cadence.touch1_intro)."""
    service = is_service_lead(profile)
    ending = cadence.touch1_ending(_trade_in_known(profile), service=service)
    intro = cadence.touch1_intro(
        customer_first_name=first_name(customer_first_name), agent_name=dealer.agent_name,
        dealership=dealer.name, city=dealer.city, state_code=dealer.state,
        vehicle=_service_vehicle(profile) if service else _vehicle_of_interest(profile), service=service,
        origin=origin)
    edited = ai_studio.fixed_text(ai_studio.step_message("cadences", "sales_days_1_7", "touch1"))
    if edited and not service and origin != "outbound":
        # AI Studio (client, 13 Oct 2026): the first message as published there - its opening before {price_line},
        # its closing question after (still left out once a trade-in is known).
        opening, _, closing = edited.partition("{price_line}")
        values = {"first_name": first_name(customer_first_name), "agent_name": dealer.agent_name,
                  "dealership": dealer.name, "vehicle": _vehicle_of_interest(profile), "dealer_phone": dealer.phone}
        intro = ai_studio.fill(opening, values) or intro
        if ending:
            ending = ai_studio.fill(closing, values) or None
    return {
        "intro": intro,
        "ending": ending,
        "ending_slot": TOUCH1_ENDING_SLOT if ending else None,
        "why": ("The client's required Touch 1 structure: the opening, the answers, then "
                + (f"{ending!r}." if ending else "no sales closing question - a service lead." if service
                   else "no closing question - they've already told us about a trade-in.")),
    }


def _money(value: Any) -> str | None:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return None
    return f"${amount:,.0f}" if amount > 0 else None


def first_reply_extras(ctx: TurnContext, state: AgentState, dealer: DealerProfile) -> dict[str, Any]:
    """Client, 12 Oct 2026 (Betsy, Natasha's lead): the first reply about an in-stock vehicle sends "a picture of the
    vehicle and the listed price, which does not include tax, documentation or DMV" - never lead-form details read
    back. And (same day) a customer with no phone number gets her email asking for one."""
    from upsell_agent.agent.multi_vehicle import vehicle_label
    from upsell_agent.agent.vehicle_media import lead_vehicle_vin
    extras: dict[str, Any] = {}
    vin = lead_vehicle_vin(ctx.lead, ctx.lead_state)
    record = next((r for r in (state.context_pack or {}).get("inventory") or [] if vin and r.get("vin") == vin), None)
    if record and (price := _money(record.get("price"))):
        extras.update(vin=vin, price_line=f"It's listed at {price}, not including tax, documentation and DMV fees.")
    if record:
        # Client, 12 Oct 2026 (Betsy, Yvette Miller: "Please provide CarFax and mileage of car" got no answer): what the
        # lead form asks for that the vehicle's own record holds, answered in the first reply.
        asked = " ".join(str(x or "") for x in ((ctx.lead or {}).get("comments"),
                                                 ((ctx.lead or {}).get("data") or {}).get("comments"))).lower()
        answers = []
        if re.search(r"\b(mileage|miles|odometer)\b", asked) and record.get("miles"):
            answers.append(f"It has {int(record['miles']):,} miles.")
        page = str(record.get("page_url") or "").strip()
        if re.search(r"\b(carfax|car fax|autocheck|history|accident)", asked) and page:
            answers.append(f"Here's the vehicle's page with all the details, including its history report where "
                           f"available: {page}")
        if answers:
            extras.update(vin=vin, lead_answers=" ".join(answers))
    if not resolve_recipient(ctx.lead, ctx.customer, "sms"):
        vehicle = vehicle_label(ctx.lead) or "vehicle"
        model = " ".join(p for p in (str((ctx.lead or {}).get("year") or "").strip(),
                                     str((ctx.lead or {}).get("model") or "").strip()) if p) or vehicle
        name = first_name(state.customer_name) or "there"
        reach = f" We can be reached at {dealer.phone}." if dealer.phone else ""
        extras["no_phone_email"] = {
            "subject": f"{vehicle} Update" if vehicle != "vehicle" else "Your Vehicle Update",
            "body": (f"Hello {name},\n\nThank you for reaching out to {dealer.name or 'us'} regarding the {model}. "
                     "I am excited to assist you with your purchase!\n\nWe can accomplish a lot with a quick call. "
                     f"What is the best phone number to reach you?{reach}\n\nBy the way, what are you driving now?"
                     "\n\nI look forward to hearing from you."),
        }
        edited = ai_studio.message("messages", "no_phone_email")
        if text := ai_studio.fixed_text(edited):  # AI Studio: her email as published there
            values = {"first_name": name, "dealership": dealer.name or "us", "vehicle": model,
                      "dealer_phone": dealer.phone}
            extras["no_phone_email"] = {
                "subject": ai_studio.fill(edited.get("email_subject"), values) or extras["no_phone_email"]["subject"],
                "body": f"Hello {name},\n\n" + ai_studio.fill(edited.get("email_text") or text, values)}
    return extras


async def _assigned_name(ctx: TurnContext) -> str | None:
    """The first name of the salesperson the lead is assigned to (CRM `assigned_to`), or None."""
    from upsell_agent.integrations.mongodb import PLATFORM_USERS_COLLECTION, as_object_id, get_db
    who = (ctx.lead or {}).get("assigned_to")
    if not who:
        return None
    user = await get_db()[PLATFORM_USERS_COLLECTION].find_one({"_id": as_object_id(str(who))}, {"name": 1})
    name = str((user or {}).get("name") or "").strip()
    return name.split()[0] if name else None


def studio_after_hours(decision: dict[str, Any], customer_name: str | None) -> None:
    """AI Studio (client, 13 Oct 2026): an after-hours message edited there. "Customer chose business hours" and the
    morning message are sent word for word (placed by code, like her scripts); the offer's question is the one
    published; "closed but we can help now" follows the published instruction."""
    from upsell_agent.agent.templates import known_first_name
    after = decision.get("after_hours") or {}
    mode = after.get("mode")
    if not mode or decision.get("action") in ("stop", "handoff", "offer_human"):
        return
    edited = ai_studio.message("messages", f"after_hours_{mode}")
    if not edited:
        return
    values = {"first_name": first_name(customer_name) if known_first_name(customer_name) else None,
              "opens_at": after.get("opens_at")}
    text = ai_studio.fixed_text(edited)
    if mode in ("later", "resume") and text and not decision.get("cannot_supply"):
        decision["cannot_supply"] = {"topic": f"after_hours_{mode}", "text": ai_studio.fill(text, values),
                                     "offers_times": False, "escalates": False}
    elif mode == "offer" and text:
        after["wording"] = ai_studio.fill(text, values)
    elif mode == "closed" and (said := ai_studio.instruction(edited)):
        after["instruction"] = said


def plan_cadence_touch_context(lead_state: dict | None, customer_first_name: str | None) -> dict[str, Any] | None:
    """The theme this cadence touch is about (MASTER_PLAN_3 C4,
    agent/cadence.py), written onto the lead state by the scheduler just
    before the turn runs. The name nudge is a fixed text, not a written
    message: the client calls it non-negotiable (Omnichannel PDF §3)."""
    from upsell_agent.agent.templates import known_first_name
    pending = (lead_state or {}).get("pending_touch")
    if not pending:
        return None
    theme_id = pending.get("theme")
    fixed = None
    instruction = pending.get("instruction")
    if theme_id == cadence.NAME_NUDGE.id:
        # The client's exact nudge: the customer's first name and a question mark (Omnichannel PDF §3).
        given = first_name(customer_first_name) if customer_first_name else None
        fixed = f"{given}?" if given else "Are you still there?"
        edited = ai_studio.fixed_text(ai_studio.step_message("cadences", "sales_days_1_7", theme_id))
        if edited and given:  # AI Studio: the nudge as published there
            fixed = ai_studio.fill(edited, {"first_name": given}) or fixed
    elif theme_id in cadence.BY_ID:
        # The touch's angle as it is now (AI Studio edits apply to touches already scheduled).
        instruction = cadence.BY_ID[theme_id].instruction or instruction
    elif theme_id == UNSOLD_THEME:
        # Client, 21 Oct 2026: the first message after an Unsold visit, as set in AI Studio -> Cadences -> "Unsold".
        step = ai_studio.step_message("cadences", "unsold", "first_touch")
        if (text := ai_studio.fixed_text(step)) and (step or {}).get("mode") == "fixed":
            from upsell_agent.agent.templates import known_first_name
            fixed = ai_studio.fill(text, {"first_name": first_name(customer_first_name)
                                          if known_first_name(customer_first_name) else None})
        elif step and (said := ai_studio.instruction(step)):
            instruction = said
    # AI Studio (client, 13 Oct 2026): a touch written as fixed text goes out word for word - a touch of an added
    # cadence (its message rides on the touch), or an edited sales touch.
    message = pending.get("message") if pending.get("studio_cadence") else next(
        (m for key in ("sales_days_1_7", "sales_days_8_30", "sales_days_31_90")
         if (m := ai_studio.step_message("cadences", key, str(theme_id)))), None)
    if theme_id != cadence.NAME_NUDGE.id and (text := ai_studio.fixed_text(message)) and (
            not message or message.get("mode") == "fixed"):
        given = first_name(customer_first_name) if known_first_name(customer_first_name) else None
        fixed = ai_studio.fill(text, {"first_name": given})
    elif message and (said := ai_studio.instruction(message)):
        instruction = said
    return {"touch_number": pending.get("touch_number"), "day": pending.get("day"), "theme": theme_id,
            "label": pending.get("theme_label"), "instruction": instruction, "fixed_text": fixed,
            "channels": pending.get("channels"),
            "email_subject": str((message or {}).get("email_subject") or "").strip() or None}


def _customer_summary(profile: Profile) -> str:
    """What the customer wants, for the booking's `notes` (B5 item 6: the
    team is told what they want, budget, trade-in when they arrive)."""
    values = profile.values(include_stale=True)
    parts = []
    if model := (values.get("interest.model") or values.get("trade_in.model") or values.get("vehicle.model")):
        parts.append(str(model))
    if budget := values.get("interest.budget"):
        parts.append(f"budget ${budget:,.0f}" if isinstance(budget, (int, float)) else f"budget {budget}")
    if values.get("trade_in.has_trade"):
        parts.append("has a trade-in")
    return "; ".join(parts) or "See conversation for details."


async def _call_check(ctx: TurnContext, state: AgentState, dealer: DealerProfile, now: datetime,
                      text: str) -> human_contact.CallCheck:
    """PLAN_4 stream H: could a person call this customer, and when (compliance/call_check.py: a usable phone,
    no voice opt-out, not DND, calling hours and the dealer's hours)? Not logged here: the call task's own
    check logs it when it opens."""
    from upsell_agent.compliance.call_check import can_call

    decision = await can_call(dealer_id=state.dealer_id, customer_id=state.customer_id, lead_id=state.lead_id or "",
                              at=now, record=False)
    phone = next((c["detail"].removeprefix("call ") for c in decision.checks if c["rule"] == "phone" and c["passed"]),
                 None)
    if decision.outcome != "BLOCK" and (own := human_contact.given_phone(text)):
        phone = own  # "call me at 555-123-4567": the number they just gave
    when = dealer.opening_text(decision.until, now) if decision.outcome == "HOLD" and decision.until else None
    return human_contact.CallCheck(outcome=decision.outcome, reason=decision.reason, code=decision.rule,
                                   phone=phone, until=decision.until.isoformat() if decision.until else None,
                                   when=when)


async def plan_human_contact(ctx: TurnContext, state: AgentState, conversation: ConversationState,
                             extraction: dict[str, Any], *, dealer: DealerProfile, now: datetime, text: str,
                             wants_human: bool, escalate: bool, hold: str | None) -> human_contact.HumanContactPlan:
    """PLAN_4 stream H: "speak to a human" -> a call or a text (agent/human_contact.py)."""
    awaiting = conversation.awaiting_human_choice
    if not (wants_human or awaiting):
        return human_contact.HumanContactPlan()
    method = human_contact.said_method(text, answering=awaiting)
    # The call check only matters when a call is on the table.
    call = await _call_check(ctx, state, dealer, now, text) if method != human_contact.TEXT else None
    text_when = None if dealer.is_open(now) else (
        dealer.opening_text(opens, now) if (opens := dealer.next_opening(now)) else None)
    return human_contact.plan(text=text, wants_human=wants_human, awaiting=awaiting, escalate=escalate, hold=hold,
                              channel=state.channel, call=call, text_when=text_when, turn=conversation.turn)


async def plan_cannot_supply(ctx: TurnContext, state: AgentState, profile: Profile, conversation: ConversationState,
                             *, dealer: DealerProfile, now: datetime, text: str, hold: str | None,
                             visit_ctx: dict[str, Any]) -> tuple[cannot_supply.CannotSupply | None,
                                                                 VisitOfferPlan | None]:
    """Client, 12 Oct 2026 (Betsy): a credit score, APR, payment, custom photos/video, out-the-door price or an
    out-of-state question is answered in her words, with two open times when she asked for them (agent/
    cannot_supply.py). Only on the customer's own message, never under a hold."""
    if state.trigger not in ("inbound_message", "resume_at_opening") or hold:
        return None, None
    topic = cannot_supply.detect(text)
    if topic is None:
        return None, None
    from upsell_agent.agent.vehicle_media import vehicle_page_url, vehicle_record
    inventory = (state.context_pack or {}).get("inventory")
    url = vehicle_page_url(ctx.lead, ctx.lead_state, inventory, text)
    car = vehicle_record(ctx.lead, ctx.lead_state, inventory, text)
    if visit_ctx.get("status") in ("pending", "confirmed"):
        return cannot_supply.reply(topic, booked=visit_ctx.get("display") or "your visit", vehicle_url=url,
                                   vehicle=car), None
    if not cannot_supply.needs_times(topic):
        return cannot_supply.reply(topic, vehicle_url=url, vehicle=car), None
    existing = await booking_tool.existing_bookings(state.dealer_id, dealer, now)
    available = booking_tool.available_times(dealer, existing, now, exclude_lead_id=state.lead_id or "")
    zones = tuple(((ctx.compliance or {}).get("zone") or {}).get("zones") or ())
    built = booking_tool.format_offer(booking_tool.offer_times(available, count=2), dealer, customer_zones=zones)
    answer = cannot_supply.reply(topic, times=[t["display"] for t in built], vehicle_url=url, vehicle=car)
    if not answer.offers_times:
        return answer, None
    plan = plan_day_offer(profile=profile, conversation=conversation, built_times=built,
                          why=f"Can't supply ({topic}): the client's answer with two open times.")
    return answer, plan


def customer_texting_hours(zone: dict | None, now: datetime, dealer_tz: Any) -> bool:
    """Is it the customer's legal texting time (TCPA state table, client 1 Oct 2026)? Unknown location: the
    federal 8 AM - 9 PM in the dealer's time zone."""
    from upsell_agent.compliance.state_hours import allowed, rules_for, zone_states
    states = zone_states(zone or {})
    zones = tuple((zone or {}).get("zones") or ())
    if states and zones:
        return allowed(now, zones, rules_for(states))
    local = now.astimezone(dealer_tz)
    return 8 <= local.hour < 21


async def decide(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    extraction = state.extraction or {}
    profile = await load_profile(ctx, state)
    conversation = ConversationState.model_validate((state.context_pack or {}).get("conversation") or {})
    # Questions an earlier reply left unanswered (a template went out) come first.
    questions = questions_for_turn(conversation, list(extraction.get("questions") or []))
    status = (ctx.lead_state or {}).get("status")
    hold = hold_questions_reason(extraction, ctx.compliance)
    # MASTER_PLAN_4 D2/D4 (stream A3): a Sold Pending / Sold - Delivered customer gets answers only - no asks, no
    # visit offer, no pitch - under that workflow's guardrails (agent/sold_pending.reply_hold).
    sold_hold = reply_hold((ctx.lead_state or {}).get("stage"))
    # Stream X2: both apply when both are there (a possible opt-out on a Sold Pending lead keeps its guardrails).
    hold = f"{hold}; and {sold_hold}" if hold and sold_hold else (hold or sold_hold)
    pack = state.context_pack or {}
    now = clock.now()
    text = state.customer_text or state.inbound_text
    dealer = await dealer_profile(state.dealer_id)
    after_hours = plan_after_hours(
        trigger=state.trigger, origin=((ctx.compliance or {}).get("origin") or {}).get("origin"),
        now=pack.get("now") or {}, conversation=conversation, extraction=extraction, at=now, text=text,
        texting_hours=customer_texting_hours((ctx.compliance or {}).get("zone"), now, dealer.tz))
    if hold and after_hours.mode == "offer":
        # A possible opt-out or quiet hours: nothing is asked, not even the choice.
        after_hours.mode, after_hours.record = None, None
        after_hours.why = f"No after-hours choice: {hold}."

    # MASTER_PLAN_3 C3: a dated next step the customer asked for. The reply confirms it and asks or
    # offers nothing else (they asked us to come back later, not to keep going now).
    dated = None if hold else plan_next_action(extraction, now=now, dealer=dealer, channel=state.channel, text=text,
                                               awaiting_when=conversation.awaiting_when_free)
    # Betsy, 21 Oct 2026 (item 9): busy right now and no time given ("I'm busy, talk later") - the reply asks what
    # time works best and nothing else; their answer becomes the check-back (plan_next_action, awaiting_when).
    # A visit in the same message wins ("I'm at work till 5, can I come in at 6?" books 6 PM - review 23 Oct 2026).
    ask_when_free = bool(not dated and not hold and state.trigger == "inbound_message"
                         and BUSY_NOW.search(text or "") and not conversation.awaiting_when_free
                         and not _COMING_IN.search(text or "") and not visit_wants_visit(extraction))
    if ask_when_free:
        hold = "the customer is busy right now: the reply only asks what time works to get back to them"
    if dated:
        hold = f"the customer asked us to get back to them {dated['display']}: nothing more is asked now"
        if after_hours.mode == "offer":
            after_hours.mode, after_hours.record = None, None
            after_hours.why = "No after-hours choice: the customer asked us to get back to them on a date."
    not_interested, not_interested_reason = (None, None) if sold_hold else not_interested_mode(extraction, conversation)
    after_hours_blocking = after_hours.mode in ("offer", "later") or state.trigger == "resume_at_opening"
    # Only a needed_by Validate accepted THIS turn (never an older stored value, architecture
    # decision 26's wording is about "an urgent message"): a stale needed_by left over from an
    # unrelated earlier message (seen in testing: "tomorrow" answering the after-hours choice)
    # must not keep tripping this on every later turn until it goes stale.
    needed_by = next((v["value"] for v in (state.validation or {}).get("accepted", [])
                      if v.get("path") == "interest.needed_by"), None)
    # Not while our last message asked "now, or when we open?" (MASTER_PLAN_3 B1): a bare
    # "tomorrow" answering that choice is about contact timing, not a purchase deadline (seen in
    # testing: the offline model reads it as a needed_by date too).
    # Nor when the date is a visit day the customer asked about ("not Tuesday, what about Thursday?"): that's
    # when they'd come in, not when they need the car.
    # Nor when they're asking to come in or picking a time ("Wednesday after work, like 6pm?"): that's the visit
    # day, not a deadline (PLAN_4 stream Q, seen with gpt-5-mini).
    backstop = (bool(needed_by) and not conversation.awaiting_contact_choice and not visit_wants_visit(extraction)
                and not conversation.awaiting_visit_pick and _within_48h(str(needed_by), now, dealer.tz))
    urgency_mode, urgency_reason = urgency(extraction, backstop=backstop)
    # Stream Q: a customer writing in Spanish (agent/language.py) is answered in Spanish, and their day and time
    # words are read by the same booking code as anyone's ("el sábado en la mañana" -> "Saturday morning").
    reply_language = customer_language(
        text, [m.get("text") or "" for m in pack.get("working_memory", []) if m.get("direction") == "inbound"])
    # Client, 10 Oct 2026: any language the customer writes in, not only Spanish - the model names it; a message too
    # short to tell keeps the language they used before, then the language chosen on the lead in the CRM.
    said = str((extraction or {}).get("message_language") or "").strip().title()
    lead_language = str(((ctx.lead or {}).get("user_language")) or "").strip().title()
    if said and said != "English":
        reply_language = said
    elif said == "English":
        reply_language = None
    elif not reply_language:
        # Client, 20 Oct 2026 (Bibi): also the language recorded from a message the AI held while paused.
        previous = str((ctx.lead_state or {}).get("reply_language") or "").strip() or str(
            (ctx.lead_state or {}).get("customer_language") or "").strip().replace("English", "")
        reply_language = previous or (lead_language if lead_language not in ("", "English") else None)
    booking_text = dates_to_english(text) if reply_language == SPANISH else text
    visit_ctx, visit_plan = await _visit_and_booking(
        ctx, state, profile, conversation, extraction, dealer=dealer, now=now, text=booking_text, hold=hold,
        after_hours_blocking=after_hours_blocking, buying_urgency=urgency_mode == "buying")
    cannot, cannot_plan = await plan_cannot_supply(ctx, state, profile, conversation, dealer=dealer, now=now,
                                                   text=text, hold=hold, visit_ctx=visit_ctx)
    # Client, 12 Oct 2026 (Betsy): the buyer's order sequence, in her words (agent/buyers_order.py).
    order = (buyers_order.plan(ctx.lead_state, text, now, credit_link=dealer.credit_application_url)
             if state.trigger in ("inbound_message", "resume_at_opening") and not hold else None)
    if order is not None:
        cannot, cannot_plan = None, None
        # Client, 20 Oct 2026 (Joel Clymer): her yes / no workflows' {vehicle_link} and car data are filled too, or the
        # sentence promising them goes.
        from upsell_agent.agent.vehicle_media import vehicle_page_url, vehicle_record
        inventory = (state.context_pack or {}).get("inventory")
        filled = cannot_supply.with_vehicle_link(order.text, vehicle_page_url(ctx.lead, ctx.lead_state, inventory, text))
        order = dataclasses.replace(order, text=cannot_supply.with_vehicle_values(
            filled, vehicle_record(ctx.lead, ctx.lead_state, inventory, text)))
    if cannot_plan is not None:
        visit_plan = cannot_plan
    if visit_ctx.get("day_request"):
        # "What about Monday?" is answered by Monday's times, not passed to the team as an open question.
        questions = [q for q in questions if not booking_tool.preferred_day(q["text"], dealer, now)]
    # Only an urgent problem reaches the handoff rule (stream Q); buying urgency offers the visit instead.
    urgent = urgency_mode == "escalate"
    urgent_confidence = float(extraction.get("urgent_confidence") or 0.0) if urgent else 0.0

    # Live, 23 Oct 2026 (Steve's "Manual or Auto" - about the gearbox - got "a call or a text from our sales manager?"):
    # a request for a person names one ("a person", "someone", "a manager", "call me"...) - the model's flag alone
    # isn't enough.
    wants_human = (bool(extraction.get("wants_human")) and not (dated and dated["call_requested"])
                   and (human_contact.asks_for_person(text) or human_contact.said_method(text, answering=False)
                        is not None))
    said_upset = upset_words(text)
    upset_confidence = float(extraction.get("upset_confidence") or 0.0)
    escalate = ((bool(extraction.get("upset")) and (upset_confidence >= UPSET_ALONE_CONFIDENCE or (
        upset_confidence >= UPSET_HANDOFF_CONFIDENCE and said_upset)))
        or (urgent and urgent_confidence >= URGENT_HANDOFF_CONFIDENCE))
    person = await plan_human_contact(
        ctx, state, conversation, extraction, dealer=dealer, now=now, text=text, wants_human=wants_human,
        escalate=escalate, hold=hold_questions_reason(extraction, ctx.compliance))
    if person.mode in (human_contact.CALL, human_contact.TEXT):
        wants_human = True  # their answer to "call or text?" is the request for a person
    elif person.record and person.record.get("choice") == "withdrawn":
        wants_human = False
    def decide_with(plan: Any) -> dict[str, Any]:
        return next_action(profile, Flags(
            hold_questions=hold,
            contact_choice=after_hours.mode if after_hours.mode in ("offer", "later") else None,
            opted_out=status == "opted_out",
            already_qualified=status == "qualified",
            stop_asking=status == "partly_qualified",
            asks={path: (a.count, a.last_turn) for path, a in conversation.asks.items()},
            confirms=dict(conversation.confirms),
            last_asked=list(conversation.last_asked),
            replies=conversation.turn,
            wants_human=wants_human,
            human_contact=person.mode,
            upset=bool(extraction.get("upset")),
            upset_confidence=float(extraction.get("upset_confidence") or 0.0),
            upset_words=said_upset,
            annoyed_at_bot=bool(extraction.get("annoyed_at_bot")),
            questions=questions,
            urgent=urgent,
            urgent_confidence=urgent_confidence,
            visit_offer=plan.as_dict() if plan.fire else None,
            visit_handoff=plan.handoff,
            visit_pending=plan.fire or conversation.awaiting_visit_pick,
            not_interested=not_interested,
            not_interested_reason=not_interested_reason,
        ))

    _new_or_used_from_stock(profile, state)
    decision = decide_with(visit_plan)
    offered_before = bool(conversation.visit and conversation.visit.attempts and not conversation.visit.declined
                          and not conversation.visit.stopped)
    after_an_offer = offered_before and (decision["action"] == "ask" or (
        decision["action"] == "answer" and not decision.get("asks")))
    if ((decision["action"] in _DEAD_ENDS or after_an_offer) and not hold and not after_hours_blocking and not not_interested
            and (state.trigger in ("inbound_message", "resume_at_opening") or _touch_takes_an_offer(ctx, state))
            and not extraction.get("annoyed_at_bot")
            and visit_ctx.get("status") not in ("pending", "confirmed", "cancelled") and not visit_ctx.get("just_booked")
            and not visit_ctx.get("cancelled_this_turn") and not visit_ctx.get("moved_this_turn")
            and not visit_declines(extraction) and not _NOT_READY.search(text or "")):
        # Client, 20-21 Oct 2026 (Betsy: "it's supposed to QUALIFY for DATA and LEVERAGE DATA to get APPOINTMENTS";
        # live, 68 of ~145 replies ended in "acknowledge" with no next step): a reply never ends with nothing - when
        # there is nothing left to ask, it offers the visit with two real times.
        forced_ctx, forced = await _visit_and_booking(
            ctx, state, profile, conversation, extraction, dealer=dealer, now=now, text=booking_text, hold=hold,
            after_hours_blocking=after_hours_blocking, buying_urgency=urgency_mode == "buying", force_offer=True)
        if forced.fire:
            visit_ctx, visit_plan = forced_ctx, forced
            decision = decide_with(visit_plan)
        elif on_table := _times_on_the_table(visit_plan, conversation):
            visit_plan = on_table
            decision = decide_with(visit_plan)
    decision["dealer_address"] = dealer.address  # the fallback answers "where are you?" with it
    # MASTER_PLAN_3 C4: Touch 1's required structure, and the theme when this turn is a cadence touch.
    touch1 = (plan_touch1(profile, dealer, state.customer_name,
                         origin=((ctx.compliance or {}).get("origin") or {}).get("origin"))
              if state.trigger == "lead_created" and decision["action"] not in ("stop", "handoff", "offer_human")
              else None)
    if touch1:
        touch1.update(first_reply_extras(ctx, state, dealer))
        decision["touch1"] = touch1
        if touch1["ending"]:
            # The closing question is one of the two, so at most one other ask fits (decision 35). A
            # confirmation or a visit offer is already that other question, so no slot ask is added.
            # Client, 18 Oct 2026 (Betsy: "one question at a time"): the closing question is the first text's only one.
            room = 0
            decision["asks"] = [a for a in decision["asks"]
                                if TOUCH1_ENDING_SLOT not in a.get("slots", [])][:room]
            decision["slots"] = [p for item in decision["asks"] for p in item["slots"]]
            if TOUCH1_ENDING_SLOT not in decision["slots"]:
                decision["slots"].append(TOUCH1_ENDING_SLOT)
    touch = plan_cadence_touch_context(ctx.lead_state, state.customer_name)
    if touch and state.trigger == CADENCE_TRIGGER:
        decision["touch"] = touch
    service_offer = (ctx.lead_state or {}).get("service_offer") or {}
    if sold_hold and service_offer.get("facts"):
        # MASTER_PLAN_4 D4 + stream A4: the recall / maintenance facts our outreach was built from. Stream A4's
        # guard allows exactly these service claims in the reply and rejects any others.
        decision["service_facts"] = service_offer["facts"]
    decision["next_action"] = dated if decision["action"] not in ("stop", "handoff", "offer_human") else None
    decision["ask_when_free"] = ask_when_free and decision["action"] not in ("stop", "handoff", "offer_human")
    # A first name only, and nothing else is being asked or offered this reply: ask their last name, in a few words.
    first_only = _FIRST_NAME_ONLY.search(text or "") if state.trigger == "inbound_message" else None
    if first_only:
        from upsell_agent.agent.turn import _name_word_ok  # "Call me Monday" is no name
        if not _name_word_ok(first_only.group(1)):
            first_only = None
    decision["ask_last_name"] = (first_only.group(1) if first_only and not hold and not decision.get("asks")
                                 and decision["action"] not in ("stop", "handoff", "offer_human", "offer_visit")
                                 and not (visit_plan and visit_plan.fire) else None)
    decision["not_interested"] = ({"mode": not_interested, "reason": not_interested_reason}
                                  if not_interested else None)
    if state.trigger == NEXT_ACTION_TRIGGER:
        # A scheduled next step firing (scheduler/followups.py): not a reply, we're checking back as asked.
        planned = (ctx.lead_state or {}).get("next_action") or {}
        decision["reach_out"] = {"words": planned.get("words"), "notes": planned.get("context_notes")}
        # Client, 21 Oct 2026: the message as set in AI Studio -> Cadences -> "Contact Made - Specific Follow-Up".
        step = ai_studio.step_message("cadences", "specific_followup", "check_back")
        if (fixed := ai_studio.fixed_text(step)) and (step or {}).get("mode") == "fixed":
            from upsell_agent.agent.multi_vehicle import vehicle_label
            from upsell_agent.agent.templates import known_first_name
            decision["touch"] = {"theme": "specific_followup", "fixed_text": ai_studio.fill(fixed, {
                "first_name": known_first_name(state.customer_name), "dealership": dealer.name,
                "vehicle": vehicle_label(ctx.lead), "agent_name": dealer.agent_name})}
        elif step and (said := ai_studio.instruction(step)):
            decision["reach_out"]["instruction"] = said
    if (ctx.compliance or {}).get("quiet_hours"):
        decision["quiet_hours"] = {"resume_at": ctx.compliance.get("resume_at")}
    decision["human_contact"] = person.as_dict() if (person.mode or person.record) and decision["action"] in (
        "handoff", "offer_human") or (person.record or {}).get("choice") == "withdrawn" else None
    if decision["action"] in ("stop", "handoff", "offer_human") and after_hours.mode in ("offer", "later"):
        # Staff (or nobody) take it from here: no choice to offer, no morning message.
        after_hours.mode, after_hours.record, after_hours.schedule_resume = None, None, False
        after_hours.cancel_resume = True
        after_hours.why = f"No after-hours choice: the reply is a {decision['action']}."
    decision["after_hours"] = after_hours.as_dict()
    # Stream Q: buying urgency, for Compose to lean into getting them in soon (never a handoff by itself).
    decision["urgency"] = ({"reason": urgency_reason} if urgency_mode == "buying"
                           and decision["action"] not in ("stop", "handoff", "offer_human") else None)
    if visit_ctx.get("just_booked") or visit_ctx.get("status") in ("pending", "confirmed"):
        # Client, 12 Oct 2026: the confirmation says who to ask for - the salesperson the lead is assigned to.
        visit_ctx = {**visit_ctx, "address": dealer.address, "ask_for": await _assigned_name(ctx)}
    stock = (state.context_pack or {}).get("stock_search") or {}
    # Client, 12 Oct 2026 (Betsy): a vehicle the customer asks about that isn't in the feed - "check with a manager
    # before scheduling the appointment and move to Manager Review status".
    decision["vehicle_check"] = ({"vehicle": stock.get("searched_for")} if stock.get("asked") and not stock.get("exact")
                                 and stock.get("searched_for") not in (None, "", "any vehicle")
                                 and state.trigger in ("inbound_message", "resume_at_opening")
                                 and decision["action"] not in ("stop", "handoff", "offer_human") else None)
    decision["cannot_supply"] = (cannot.as_dict() if cannot and decision["action"] not in
                                 ("stop", "handoff", "offer_human") else None)
    if order is not None and decision["action"] not in ("stop", "handoff", "offer_human"):
        # Placed like the can't-supply answers: her text, word for word.
        decision["cannot_supply"] = {"topic": f"workflow:{order.flow}" if order.flow else "buyers_order",
                                     "text": order.text, "offers_times": False, "actions": order.actions,
                                     "escalates": order.escalates}
        decision["buyers_order"] = buyers_order.record(order, now) or {"step": None}
    elif (decision.get("cannot_supply") or {}).get("topic") == cannot_supply.BUYERS_ORDER:
        # The invitation went out: the next "send it anyway" starts her question sequence (agent/buyers_order.py).
        decision["buyers_order"] = {"step": buyers_order.INVITE_STEP, "at": now}
    studio_after_hours(decision, state.customer_name)
    # Client, 12 Oct 2026 (Betsy): "If the name is null please ask for the customer's name. We need to obtain data to
    # make an appointment." Once per conversation, never over a script, a handoff or a stop.
    from upsell_agent.agent.templates import known_first_name
    decision["ask_name"] = bool(
        not known_first_name(state.customer_name) and not (ctx.lead_state or {}).get("name_asked")
        and state.trigger in ("lead_created", "inbound_message") and not decision.get("cannot_supply")
        and decision["action"] not in ("stop", "handoff", "offer_human")
        # Live, 21 Oct 2026: the first text's one question is "Tell me, what are you driving now?" (one question per
        # message), so the name is asked in the next reply - it was marked asked here and then never asked.
        and not ((decision.get("touch1") or {}).get("ending")))
    if decision["ask_name"] and decision["action"] in ("ask", "acknowledge", "qualified", "partly_qualified", "confirm"):
        # Betsy, 16 Oct 2026: "for n/a or null it needs to ask for the first and last name" - with one question per
        # message, the name is this message's question (the other detail waits for the next reply).
        decision["asks"] = [{"requirement": "customer_name", "label": "Name", "slots": [],
                             "question": "May I have your first and last name?",
                             "explanation": "so we know who to ask for and can get everything ready for you"}]
        decision["slots"] = []
        decision["action"] = "ask"
    decision["visit"] = visit_ctx
    decision["visit_plan"] = visit_plan.as_dict()
    # MASTER_PLAN_4 A1: the lead bucket's word-track emphasis for Compose (blueprint §2: language only).
    decision["bucket"] = lead_bucket.for_compose(ctx.lead_state, profile.values(include_stale=True))
    # Client, 8 Oct 2026: the specialist for what the customer is talking about this turn (agent/specialists.py) -
    # the reply's expertise and limits, never the action.
    expert, expert_why = specialists.route(text, lead_type=getattr(profile.effective_lead_type, "value", None),
                                           bucket=(ctx.lead_state or {}).get("bucket"))
    decision["specialist"] = specialists.for_compose(expert, expert_why)
    # Client, 12 Oct 2026: what this dealership doesn't offer is off limits (Dealer Setup switches).
    offered = tuple(getattr(dealer, "departments", None) or ())
    missing = [d for d in ("new", "used", "service", "parts") if offered and d not in offered]
    decision["departments"] = {"offered": list(offered), "not_offered": missing} if missing else None
    # Stream Q: a customer writing in Spanish is answered in Spanish (agent/language.py).
    # Live, 23 Oct 2026: "the SMS isn't written in Unknown" - a language that couldn't be told is no language to write in.
    decision["reply_language"] = None if str(reply_language or "").strip().lower() in (
        "", "unknown", "english", "none", "n/a", "undetermined") else reply_language
    span.output = decision
    span.reasoning = [f"Rule {i + 1} ({r['id']}): {r['result']}{' - ' + r['why'] if r['why'] else ''}"
                      for i, r in enumerate(decision["rules"])]
    span.reasoning.append(f"{decision['required_filled']} of {decision['required_total']} required details collected "
                          f"for a {decision['effective_lead_type']} lead.")
    if questions:
        carried = len(questions_for_turn(conversation, []))
        span.reasoning.append(f"{len(questions)} customer question(s) to answer"
                              + (f", {carried} still open from earlier." if carried > 0 else "."))
    for skipped in decision["not_asked"]:
        span.reasoning.append(f"Not asking {skipped['label']}: {skipped['why']}.")
    if hold:
        span.reasoning.append(f"No questions this time: {hold}.")
    if after_hours.why:
        span.reasoning.append(f"After hours: {after_hours.why}")
    if visit_plan.why:
        span.reasoning.append(f"Visit: {visit_plan.why}")
    if visit_ctx.get("just_booked"):
        span.reasoning.append(f"Booking created/moved this turn: {visit_ctx.get('display')} ({visit_ctx.get('status')}).")
    if visit_ctx.get("ask_contact"):
        span.reasoning.append(f"The customer picked a time, but we're missing their {visit_ctx['ask_contact']} "
                              "before we can book it.")
    if extraction.get("annoyed_at_bot"):
        span.reasoning.append("The customer is frustrated with the conversation: no questions this time.")
    if extraction.get("upset") and decision["action"] != "handoff":
        span.reasoning.append(f"Upset, but not clearly enough to hand off (confidence "
                              f"{float(extraction.get('upset_confidence') or 0):.2f}, needs "
                              f"{UPSET_HANDOFF_CONFIDENCE:.2f} with clear words of upset, or "
                              f"{UPSET_ALONE_CONFIDENCE:.2f}).")
    if backstop:
        span.reasoning.append(f"Needed soon (pure-code backstop): interest.needed_by ({needed_by}) is within "
                              f"{URGENT_BACKSTOP_HOURS}h.")
    if urgency_mode == "buying":
        span.reasoning.append(f"Buying urgency ({urgency_reason}): offering the visit now, not handing off.")
    if decision["next_action"]:
        span.reasoning.append(f"Dated next step: the customer said {dated['words']!r}, worked out as "
                              f"{dated['display']} at {dated['time']}"
                              + ("" if dated["time_given"] else " (no time given: the dealer default)") + ".")
    if decision["human_contact"]:
        span.reasoning.append(f"Speak to a person: {person.why}")
    if touch1:
        span.reasoning.append(f"Touch 1: {touch1['why']}")
    if decision["reply_language"]:
        span.reasoning.append(f"The customer writes in {decision['reply_language']}: the reply is in "
                              f"{decision['reply_language']}.")
    if decision.get("touch"):
        span.reasoning.append(f"Cadence touch {decision['touch']['touch_number']} (day "
                              f"{decision['touch']['day']}): {decision['touch']['label']}.")
    if not_interested:
        span.reasoning.append("Not interested: " + ("asking why, once." if not_interested == "ask_why" else
                              f"reason {not_interested_reason!r}; a person decides whether to close the lead."
                              if not_interested_reason else "said again after we asked why; handed to a person."))
    span.edge_label = decision["action"] + (f": {', '.join(a['label'] for a in decision['asks'])}"
                                            if decision["asks"] else "")
    if after_hours.mode:
        span.edge_label += f" · after hours: {after_hours.mode}"
    if visit_plan.fire:
        span.edge_label += f" · visit offer #{visit_plan.attempt}"
    return {"decision": decision}
