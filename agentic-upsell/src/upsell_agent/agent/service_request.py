"""Service visits are requested, not booked (MASTER_PLAN_4 F2; fixes
MASTER_PLAN_3 B0.9, B4, B5).

Client, scope Q16 (1 Oct 2026): "service appointments are offered in this
SOW and notes taken in, but in the next SOW availability will be able to be
read, they will be able to be written in the scheduler."

So for a service visit (a service lead today; later the SOLD - DELIVERED
Day 3 first-service offer, maintenance and recall outreach):

1. The AI offers a visit and asks which day and time suit them
   (agent/visit_offer.py with `service=True`): no times, no availability read.
2. Their answer ("Thursday morning") is worked out in code (slots/dates.py)
   and passed to the team as a SERVICE REQUEST with notes: the requested
   day/time, the vehicle, its mileage, what it needs, and anything that
   matters to them ("wants to wait for it", "needs a loaner"). It goes on the
   AI's lead state as the team notice (`staff_notice`, kind
   `service_request`) and, where the platform client can, as a note on the
   lead's conversation.
3. Nothing is booked: tools/booking_tool.py's `ensure_booking` is never
   called (agent/nodes/decide.py routes service visits here first), and the
   guard rejects "booked" / "confirmed" wording on a service request:
   "I've passed Thursday morning to our service team with your notes;
   they'll confirm the exact time with you."

Sales visits and test drives are unchanged (booked as B5 built them).
Next SOW: read service availability, offer real times, write the booking.
"""

import re
from datetime import datetime
from typing import Any

from upsell_agent import clock
from upsell_agent.agent.conversation import ConversationState, VisitState
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.visit_offer import VisitOfferPlan, plan_visit
from upsell_agent.agent.visit_offer import declines_visit as visit_declines
from upsell_agent.agent.visit_offer import eligible as visit_eligible
from upsell_agent.agent.visit_offer import wants_visit as visit_wants
from upsell_agent.integrations.dealer_profile import DealerProfile
from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION, DealerScopedDatabase
from upsell_agent.slots.profile import Profile

NOTICE_KIND = "service_request"

# Things that matter to a service customer, noted for the advisor (scope Workflow 4, "Service: ... note
# their concern for the advisor"; MASTER_PLAN_4 F2's examples).
_CONCERNS: list[tuple[str, str]] = [
    (r"\b(?:wait(?:ing)? (?:for|on|while) (?:it|the car|them)|wait there|i'?ll wait|waiter)\b", "wants to wait for it"),
    (r"\b(?:loaner|rental|courtesy car|need a car while)\b", "needs a loaner"),
    (r"\b(?:shuttle|a ride (?:home|back)|need a ride|drop me off)\b", "needs a ride / shuttle"),
    (r"\b(?:drop (?:it|the car) off|drop-?off)\b", "wants to drop it off"),
    (r"\b(?:after work|before work|on my lunch|lunch break)\b", "around their work hours"),
    (r"\b(?:warranty|recall)\b", "mentions warranty / recall"),
    (r"\b(?:noise|leak|warning light|check engine|grind|squeal|vibrat\w*|won'?t start)\b", "describes a problem"),
]
_CHANGE = re.compile(r"\b(instead|change|move|switch|actually|rather|different (?:day|time))\b", re.IGNORECASE)
_CONFIRMED_WORDING = re.compile(
    r"\b(booked|confirmed|see you (?:on|at|then)|(?:is|are|you'?re) (?:all )?set for|scheduled (?:you|it|for)|"
    r"locked (?:it |you )?in|reserved)\b", re.IGNORECASE)
_REQUESTED_WORDING = re.compile(r"\brequested\b", re.IGNORECASE)


def is_service_visit(profile: Profile) -> bool:
    """The visit being offered is a service visit (a service lead)."""
    return profile.effective_lead_type == LeadType.SERVICE


def preferred_time(text: str, dealer: DealerProfile, now: datetime) -> dict[str, Any] | None:
    """The day and/or time the customer asks for, in their words worked out in
    code: {"display", "date", "time", "part"}. None when the message names
    neither a day nor a part of the day, or names a day already past."""
    from upsell_agent.slots.dates import resolve as resolve_date
    from upsell_agent.tools.booking_tool import part_of_day

    local_now = now.astimezone(dealer.tz)
    resolved = resolve_date(text or "", local_now)
    if resolved is not None and resolved.day < local_now.date():
        resolved = None
    _, part = part_of_day(text or "")
    if resolved is None and not part:
        return None
    pieces: list[str] = []
    day = time_text = None
    if resolved is not None:
        day = resolved.day
        pieces.append(f"{day.strftime('%A')}, {day.strftime('%B')} {day.day}")
        if isinstance(resolved.value, datetime):
            time_text = resolved.value.strftime("%H:%M")
            pieces.append("at " + resolved.value.strftime("%I:%M %p").lstrip("0"))
    if part and not time_text:
        pieces.append(f"in the {part}" if part in ("morning", "afternoon", "evening") else part)
    if part and resolved is None:
        pieces = [f"any {part}" if part in ("morning", "afternoon", "evening") else part]
    return {"display": " ".join(pieces), "date": day.isoformat() if day else None, "time": time_text,
            "part": part, "approximate": bool(resolved and (resolved.ambiguous or resolved.approximate))}


def take_notes(profile: Profile, texts: list[str]) -> dict[str, Any]:
    """What the service team needs (MASTER_PLAN_4 F2): the vehicle, its
    mileage, what it needs, and anything that matters to the customer."""
    values = profile.values(include_stale=True)
    vehicle = " ".join(str(values[p]) for p in ("vehicle.year", "vehicle.make", "vehicle.model") if values.get(p))
    said = " ".join(t for t in texts if t)
    concerns = list(dict.fromkeys(label for pattern, label in _CONCERNS if re.search(pattern, said, re.IGNORECASE)))
    return {"vehicle": vehicle or None, "mileage": values.get("vehicle.mileage"),
            "needs": values.get("interest.service_needed"), "concerns": concerns}


def notes_text(request: dict[str, Any]) -> str:
    parts = [f"Requested: {request.get('display')}"]
    if request.get("vehicle"):
        parts.append(f"vehicle: {request['vehicle']}")
    if request.get("mileage") is not None:
        miles = request["mileage"]
        parts.append(f"mileage: {miles:,}" if isinstance(miles, int) else f"mileage: {miles}")
    if request.get("needs"):
        parts.append(f"needs: {request['needs']}")
    if request.get("concerns"):
        parts.append("customer: " + "; ".join(request["concerns"]))
    if request.get("customer_words"):
        parts.append(f"their words: {request['customer_words']!r}")
    return ". ".join(parts) + "."


def plan(*, profile: Profile, extraction: dict[str, Any], conversation: ConversationState, text: str,
         customer_texts: list[str], dealer: DealerProfile, now: datetime, hold: str | None,
         after_hours_blocking: bool) -> tuple[dict[str, Any], VisitOfferPlan]:
    """Decide's visit step for a service visit (instead of booking_tool):
    (visit context for Compose/Guard, the VisitOfferPlan)."""
    record = conversation.visit or VisitState()
    visit_ctx: dict[str, Any] = {"kind": "service", "status": None, "display": None, "just_booked": False,
                                 "stopped": record.stopped, "ask_contact": None}
    declined = visit_declines(extraction)
    wanted = visit_wants(extraction)
    asked = conversation.awaiting_visit_pick
    preference = None if (declined or hold) else preferred_time(text, dealer, now)
    changing = bool(record.service_request) and bool(_CHANGE.search(text or ""))

    if preference and (asked or wanted or changing):
        request = {**preference, **take_notes(profile, customer_texts), "customer_words": (text or "").strip()[:200],
                   "at": now.isoformat()}
        verb = "moved" if record.service_request else "passed"
        why = (f"Service visit {verb}: the customer asked for {preference['display']}. Passed to the service team "
               "with notes; no booking (MASTER_PLAN_4 F2, next SOW books it).")
        new_record = record.model_copy(update={"service_ask": False, "service_request": request, "offered_times": [],
                                               "held_over": 0, "why": why})
        visit_ctx.update(display=preference["display"],
                         service_request={**request, "passed_this_turn": True, "changed": bool(record.service_request)})
        return visit_ctx, VisitOfferPlan(record=new_record.model_dump(), why=why)

    if record.service_request:
        visit_ctx["service_request"] = {**record.service_request, "passed_this_turn": False}
        return visit_ctx, VisitOfferPlan(why=f"The service request ({record.service_request.get('display')}) was "
                                             "already passed to the team: no more offers.")

    offer = not hold and not after_hours_blocking and visit_eligible(profile, extraction)
    visit_plan = plan_visit(profile=profile, extraction=extraction, conversation=conversation, active_booking=None,
                            built_times=[], booked_this_turn=False, now=now, service=offer)
    visit_ctx["stopped"] = bool((visit_plan.record or {}).get("stopped")) if visit_plan.record else record.stopped
    return visit_ctx, visit_plan


def invalid_wording(visit: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    """The guard's booking-wording rule for a service visit (MASTER_PLAN_4
    F2): "passed to the service team" is fine, but never "booked",
    "confirmed", "scheduled" or "see you then" - nothing was booked. And
    "requested" only once a request was actually passed."""
    has_request = bool(visit.get("service_request"))
    violations = []
    for name, key in (("SMS", "sms_text"), ("email", "email_body")):
        text = str(draft.get(key) or "")
        if _CONFIRMED_WORDING.search(text):
            violations.append(f"the {name} says the service visit is booked/confirmed, but service visits are only "
                              "requested - the team confirms the time")
        elif _REQUESTED_WORDING.search(text) and not has_request:
            violations.append(f"the {name} claims a service request, but none was passed to the team")
    return violations


async def notify_team(db: DealerScopedDatabase, platform: Any, *, dealer_id: str, lead_id: str | None,
                      customer_id: str | None, decision: dict[str, Any], turn_id: str) -> dict[str, Any] | None:
    """After the reply went out: the team notice (kind `service_request`)
    with the requested time and notes, kept in the lead's list of service
    requests, and a note on the platform lead's conversation where the
    platform client supports one."""
    request = (decision.get("visit") or {}).get("service_request") or {}
    if not lead_id or not request.get("passed_this_turn"):
        return None
    text = ("Service visit request" + (" (changed)" if request.get("changed") else "") + ": "
            + notes_text(request) + " Not booked - please confirm the exact time with the customer.")
    now = clock.now()
    entry = {k: v for k, v in request.items() if k not in ("passed_this_turn",)}
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id},
        {"$set": {"staff_notice": {"at": now, "kind": NOTICE_KIND, "text": text, "request": entry}},
         "$push": {"service_requests": {**entry, "turn_id": turn_id, "noticed_at": now}}})
    # MASTER_PLAN_4 (stream R): the note in the CRM conversation, through the platform client (stub or live).
    from upsell_agent.agent import crm_notes
    note = await crm_notes.write(db, lead_id=lead_id, kind=NOTICE_KIND, text=text, key=f"{turn_id}:{NOTICE_KIND}",
                                 platform=platform, customer_id=customer_id)
    return {"text": text, "platform_note": note["status"] in ("written", "duplicate"), "crm_note": note}
