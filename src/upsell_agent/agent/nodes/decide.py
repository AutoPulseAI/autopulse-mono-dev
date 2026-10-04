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

import re
from datetime import date, datetime
from typing import Any

from upsell_agent import clock
from upsell_agent.agent import cadence, human_contact, lead_bucket, service_request
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
    after_hours_blocking: bool, buying_urgency: bool = False,
) -> tuple[dict[str, Any], Any]:
    """Everything B4/B5 needs the database for, done once: reads the active
    booking fresh (decision 60), matches a pick or a cancel/reschedule
    against an existing booking, creates the booking before Compose runs
    when a pick matches, and (only then) builds the next offer's times.
    Returns (visit context for Compose/Guard, the VisitOfferPlan)."""
    lead_id = state.lead_id or ""
    active_booking = await booking_tool.find_active_booking(state.dealer_id, ctx.lead)
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
    asked_day = _live_asked_day(conversation, dealer, now)
    slot_taken = False
    # B5 item 8: a visit request that names its own time ("can I come see it tomorrow at 10?"),
    # at any hour, has that time checked and booked straight away.
    asks_for_a_time = visit_wants_visit(extraction)
    # PLAN_4 stream X3 item 3: a bare time or a part of the day after they asked for a day is about that day.
    about_asked_day = bool(asked_day and (booking_tool.bare_time(text) or booking_tool.part_of_day(text)[0]))
    if (pending or asks_for_a_time or about_asked_day or (conversation.awaiting_visit_pick and conversation.visit)) \
            and not hold and not after_hours_blocking:
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
        if picked and datetime.fromisoformat(picked["iso"]) not in available:
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
            offers_left and (buying_urgency or visit_eligible(profile, extraction)))):
        existing = await booking_tool.existing_bookings(state.dealer_id, dealer, now)
        available = booking_tool.available_times(dealer, existing, now, exclude_lead_id=lead_id)
        customer_zones = tuple(((ctx.compliance or {}).get("zone") or {}).get("zones") or ())
        built_times = booking_tool.format_offer(booking_tool.offer_times(available), dealer,
                                                customer_zones=customer_zones)
    plan = plan_visit(profile=profile, extraction=extraction, conversation=conversation, active_booking=None,
                      built_times=built_times, booked_this_turn=False, now=now, same_attempt=slot_taken)
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
                     text: str) -> dict[str, Any] | None:
    """A dated next step the customer asked for (Omnichannel PDF §2 "specific
    timing wins", §6): their own words (`next_contact_when`, or the time they
    gave when declining a visit), resolved in code (slots/dates.py), never by
    the model. Only a date after today counts; one we can't work out isn't a
    dated next step (the router then treats the reply as contact without one).
    The §6 fields: date, time (theirs, else the dealer default), channel,
    owner, context notes, who entered it."""
    from upsell_agent.slots.dates import resolve as resolve_date

    words = extraction.get("next_contact_when") or (
        extraction.get("visit_later_when") if extraction.get("declines_visit") else None)
    if not words:
        return None
    local_now = now.astimezone(dealer.tz)
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


def plan_touch1(profile: Profile, dealer: DealerProfile, customer_first_name: str | None) -> dict[str, Any]:
    """Touch 1's required structure (Omnichannel PDF §3, MASTER_PLAN_3 C4):
    the client's opening, then the answers, then the mandatory closing
    question. Decision 34 (B1/B4 replacing the ending) is **reversed** by the
    client's own answer of 1 Oct 2026: the question is always asked, unless a
    trade-in is already indicated. It is one of the message's two questions,
    so Compose gets at most one other ask alongside it."""
    service = is_service_lead(profile)
    ending = cadence.touch1_ending(_trade_in_known(profile), service=service)
    return {
        "intro": cadence.touch1_intro(
            customer_first_name=first_name(customer_first_name), agent_name=dealer.agent_name,
            dealership=dealer.name, city=dealer.city, state_code=dealer.state,
            vehicle=_service_vehicle(profile) if service else _vehicle_of_interest(profile), service=service),
        "ending": ending,
        "ending_slot": TOUCH1_ENDING_SLOT if ending else None,
        "why": ("The client's required Touch 1 structure: the opening, the answers, then "
                + (f"{ending!r}." if ending else "no sales closing question - a service lead." if service
                   else "no closing question - they've already told us about a trade-in.")),
    }


def plan_cadence_touch_context(lead_state: dict | None, customer_first_name: str | None) -> dict[str, Any] | None:
    """The theme this cadence touch is about (MASTER_PLAN_3 C4,
    agent/cadence.py), written onto the lead state by the scheduler just
    before the turn runs. The name nudge is a fixed text, not a written
    message: the client calls it non-negotiable (Omnichannel PDF §3)."""
    pending = (lead_state or {}).get("pending_touch")
    if not pending:
        return None
    theme_id = pending.get("theme")
    fixed = None
    if theme_id == cadence.NAME_NUDGE.id:
        # The client's exact nudge: the customer's first name and a question mark (Omnichannel PDF §3).
        given = first_name(customer_first_name) if customer_first_name else None
        fixed = f"{given}?" if given else "Are you still there?"
    return {"touch_number": pending.get("touch_number"), "day": pending.get("day"), "theme": theme_id,
            "label": pending.get("theme_label"), "instruction": pending.get("instruction"), "fixed_text": fixed}


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
    after_hours = plan_after_hours(
        trigger=state.trigger, origin=((ctx.compliance or {}).get("origin") or {}).get("origin"),
        now=pack.get("now") or {}, conversation=conversation, extraction=extraction, at=now, text=text)
    if hold and after_hours.mode == "offer":
        # A possible opt-out or quiet hours: nothing is asked, not even the choice.
        after_hours.mode, after_hours.record = None, None
        after_hours.why = f"No after-hours choice: {hold}."

    dealer = await dealer_profile(state.dealer_id)
    # MASTER_PLAN_3 C3: a dated next step the customer asked for. The reply confirms it and asks or
    # offers nothing else (they asked us to come back later, not to keep going now).
    dated = None if hold else plan_next_action(extraction, now=now, dealer=dealer, channel=state.channel, text=text)
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
    booking_text = dates_to_english(text) if reply_language == SPANISH else text
    visit_ctx, visit_plan = await _visit_and_booking(
        ctx, state, profile, conversation, extraction, dealer=dealer, now=now, text=booking_text, hold=hold,
        after_hours_blocking=after_hours_blocking, buying_urgency=urgency_mode == "buying")
    if visit_ctx.get("day_request"):
        # "What about Monday?" is answered by Monday's times, not passed to the team as an open question.
        questions = [q for q in questions if not booking_tool.preferred_day(q["text"], dealer, now)]
    # Only an urgent problem reaches the handoff rule (stream Q); buying urgency offers the visit instead.
    urgent = urgency_mode == "escalate"
    urgent_confidence = float(extraction.get("urgent_confidence") or 0.0) if urgent else 0.0

    wants_human = bool(extraction.get("wants_human")) and not (dated and dated["call_requested"])
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
    decision = next_action(profile, Flags(
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
        visit_offer=visit_plan.as_dict() if visit_plan.fire else None,
        visit_handoff=visit_plan.handoff,
        visit_pending=visit_plan.fire or conversation.awaiting_visit_pick,
        not_interested=not_interested,
        not_interested_reason=not_interested_reason,
    ))
    # MASTER_PLAN_3 C4: Touch 1's required structure, and the theme when this turn is a cadence touch.
    touch1 = (plan_touch1(profile, dealer, state.customer_name)
              if state.trigger == "lead_created" and decision["action"] not in ("stop", "handoff", "offer_human")
              else None)
    if touch1:
        decision["touch1"] = touch1
        if touch1["ending"]:
            # The closing question is one of the two, so at most one other ask fits (decision 35). A
            # confirmation or a visit offer is already that other question, so no slot ask is added.
            room = 0 if decision.get("confirm") or decision.get("visit_offer") else 1
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
    decision["not_interested"] = ({"mode": not_interested, "reason": not_interested_reason}
                                  if not_interested else None)
    if state.trigger == NEXT_ACTION_TRIGGER:
        # A scheduled next step firing (scheduler/followups.py): not a reply, we're checking back as asked.
        planned = (ctx.lead_state or {}).get("next_action") or {}
        decision["reach_out"] = {"words": planned.get("words"), "notes": planned.get("context_notes")}
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
    decision["visit"] = visit_ctx
    decision["visit_plan"] = visit_plan.as_dict()
    # MASTER_PLAN_4 A1: the lead bucket's word-track emphasis for Compose (blueprint §2: language only).
    decision["bucket"] = lead_bucket.for_compose(ctx.lead_state, profile.values(include_stale=True))
    # Stream Q: a customer writing in Spanish is answered in Spanish (agent/language.py).
    decision["reply_language"] = reply_language
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
