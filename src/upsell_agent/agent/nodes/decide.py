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
from upsell_agent.agent.after_hours import plan_after_hours
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.conversation import ConversationState, VisitState, questions_for_turn
from upsell_agent.agent.nodes.load_context import load_profile
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.visit_offer import VisitOfferPlan, plan_visit
from upsell_agent.agent.visit_offer import eligible as visit_eligible
from upsell_agent.agent.visit_offer import wants_visit as visit_wants_visit
from upsell_agent.channels.consent import resolve_recipient
from upsell_agent.compliance.opt_out import POSSIBLE_OPT_OUT_REVIEW_CONFIDENCE
from upsell_agent.integrations.dealer_profile import DealerProfile, dealer_profile
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.policy import UPSET_HANDOFF_CONFIDENCE, Flags, next_action
from upsell_agent.slots.profile import Profile
from upsell_agent.tools import booking_tool

URGENT_BACKSTOP_HOURS = 48
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


async def _visit_and_booking(
    ctx: TurnContext, state: AgentState, profile: Profile, conversation: ConversationState,
    extraction: dict[str, Any], *, dealer: DealerProfile, now: datetime, text: str, hold: str | None,
    after_hours_blocking: bool,
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

    # No active booking: is the customer's message a pick against what we just offered, or the
    # email/phone we asked for to book a time they already picked?
    pending = conversation.visit.pending_pick if conversation.visit else None
    slot_taken = False
    # B5 item 8: a visit request that names its own time ("can I come see it tomorrow at 10?"),
    # at any hour, has that time checked and booked straight away.
    asks_for_a_time = visit_wants_visit(extraction)
    if (pending or asks_for_a_time or (conversation.awaiting_visit_pick and conversation.visit)) and not hold \
            and not after_hours_blocking:
        existing = await booking_tool.existing_bookings(state.dealer_id, dealer, now)
        available = booking_tool.available_times(dealer, existing, now, exclude_lead_id=lead_id)
        picked = pending
        offered = conversation.visit.offered_times if conversation.awaiting_visit_pick and conversation.visit else []
        if offered or asks_for_a_time:
            picked = booking_tool.match_pick(text, offered, dealer, now, available=available).matched or pending
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
            result = await booking_tool.ensure_booking(
                ctx.platform, dealer_id=state.dealer_id, dealer=dealer, lead=ctx.lead, lead_id=lead_id,
                customer_name=state.customer_name or "there", email=email, phone=phone,
                when=datetime.fromisoformat(picked["iso"]), notes=_customer_summary(profile))
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
    if not hold and not after_hours_blocking and (slot_taken or visit_eligible(profile, extraction)):
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


async def decide(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    extraction = state.extraction or {}
    profile = await load_profile(ctx, state)
    conversation = ConversationState.model_validate((state.context_pack or {}).get("conversation") or {})
    # Questions an earlier reply left unanswered (a template went out) come first.
    questions = questions_for_turn(conversation, list(extraction.get("questions") or []))
    status = (ctx.lead_state or {}).get("status")
    hold = hold_questions_reason(extraction, ctx.compliance)
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
    after_hours_blocking = after_hours.mode in ("offer", "later") or state.trigger == "resume_at_opening"
    visit_ctx, visit_plan = await _visit_and_booking(
        ctx, state, profile, conversation, extraction, dealer=dealer, now=now, text=text, hold=hold,
        after_hours_blocking=after_hours_blocking)

    urgent = bool(extraction.get("urgent"))
    urgent_confidence = float(extraction.get("urgent_confidence") or 0.0)
    # Only a needed_by Validate accepted THIS turn (never an older stored value, architecture
    # decision 26's wording is about "an urgent message"): a stale needed_by left over from an
    # unrelated earlier message (seen in testing: "tomorrow" answering the after-hours choice)
    # must not keep tripping this on every later turn until it goes stale.
    needed_by = next((v["value"] for v in (state.validation or {}).get("accepted", [])
                      if v.get("path") == "interest.needed_by"), None)
    # Not while our last message asked "now, or when we open?" (MASTER_PLAN_3 B1): a bare
    # "tomorrow" answering that choice is about contact timing, not a purchase deadline (seen in
    # testing: the offline model reads it as a needed_by date too).
    backstop = (bool(needed_by) and not conversation.awaiting_contact_choice
               and _within_48h(str(needed_by), now, dealer.tz))
    if backstop and not urgent:
        urgent, urgent_confidence = True, 1.0

    decision = next_action(profile, Flags(
        hold_questions=hold,
        contact_choice=after_hours.mode if after_hours.mode in ("offer", "later") else None,
        opted_out=status == "opted_out",
        already_qualified=status == "qualified",
        stop_asking=status == "partly_qualified",
        asks={path: (a.count, a.last_turn) for path, a in conversation.asks.items()},
        last_asked=list(conversation.last_asked),
        replies=conversation.turn,
        wants_human=bool(extraction.get("wants_human")),
        upset=bool(extraction.get("upset")),
        upset_confidence=float(extraction.get("upset_confidence") or 0.0),
        annoyed_at_bot=bool(extraction.get("annoyed_at_bot")),
        questions=questions,
        urgent=urgent,
        urgent_confidence=urgent_confidence,
        visit_offer=visit_plan.as_dict() if visit_plan.fire else None,
        visit_handoff=visit_plan.handoff,
        visit_pending=visit_plan.fire or conversation.awaiting_visit_pick,
    ))
    if (ctx.compliance or {}).get("quiet_hours"):
        decision["quiet_hours"] = {"resume_at": ctx.compliance.get("resume_at")}
    if decision["action"] in ("stop", "handoff") and after_hours.mode in ("offer", "later"):
        # Staff (or nobody) take it from here: no choice to offer, no morning message.
        after_hours.mode, after_hours.record, after_hours.schedule_resume = None, None, False
        after_hours.cancel_resume = True
        after_hours.why = f"No after-hours choice: the reply is a {decision['action']}."
    decision["after_hours"] = after_hours.as_dict()
    decision["visit"] = visit_ctx
    decision["visit_plan"] = visit_plan.as_dict()
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
                              f"{UPSET_HANDOFF_CONFIDENCE:.2f}).")
    if backstop:
        span.reasoning.append(f"Urgent (pure-code backstop): interest.needed_by ({needed_by}) is within "
                              f"{URGENT_BACKSTOP_HOURS}h.")
    span.edge_label = decision["action"] + (f": {', '.join(a['label'] for a in decision['asks'])}"
                                            if decision["asks"] else "")
    if after_hours.mode:
        span.edge_label += f" · after hours: {after_hours.mode}"
    if visit_plan.fire:
        span.edge_label += f" · visit offer #{visit_plan.attempt}"
    return {"decision": decision}
