"""The last look before any message leaves (Betsy / the user, 25 Oct 2026: "when we are sending anything to the
customer, why are we not checking what the lead might have got during that time ... the ideal case is to check at
every message").

A message is written at one moment and sent at another - a reply a minute later, a follow-up days later. The send
check (compliance/engine.py) only asks whether the law allows it. This asks whether it is still RIGHT for this
customer now, reading the customer's state fresh from the database:

  superseded  a reply, while the customer has written again since: the newer message's turn answers them both
              (seen: five replies in two minutes to five quick texts)
  appointment a sales message while the customer has an upcoming appointment on any of their leads (seen: sales
              touches after staff booked the visit on the customer's other lead)
  calendar    a message confirming a visit on a day the booking isn't on (seen: "You're all set for Sunday" while
              the calendar said Saturday)
  burst       a scheduled follow-up when the customer already got 3 messages in the last 10 minutes: it waits
              (checked where follow-ups fire, so it's postponed, never cancelled)

Nothing is dropped silently. A superseded reply is replaced by the newer turn's; a sales message stops because the
appointment's own messages run; a calendar mismatch is held back and staff are told; a burst is held and goes
later. Every decision is written on the message row and in the trace. Each check can be switched off in AI Studio
(compliance -> "Last check before sending").
"""

import re
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    PLATFORM_BOOKINGS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    as_object_id,
)

# The AI's scheduled sales messages, by the turn that wrote them (scheduler/followups.py, studio_cadences.py).
SALES_PREFIXES = ("cadence-", "studio-", "next-action-", "visit-followup-", "reengaged-", "staff-quiet-")
BURST_COUNT = 3
BURST_WINDOW = timedelta(minutes=10)
BURST_WAIT = timedelta(minutes=15)
# An appointment that ended more than this long ago no longer stops sales messages (the no-show flow takes over).
APPOINTMENT_GRACE = timedelta(hours=2)

_WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_CONFIRMS = re.compile(r"\b(?:all set|you'?re set|confirmed|booked|see you (?:on|at|then)|moved your)\b", re.IGNORECASE)


@dataclass
class Verdict:
    ok: bool
    check: str = "all_passed"
    reason: str = "still right for this customer"
    hold_until: Any = None
    staff_notice: str | None = None


# Which checks run (AI Studio -> Compliance -> "Last check before sending", ai_studio.py applies it).
CHECKS = {"superseded": True, "appointment": True, "calendar": True, "burst": True, "crm_status": True}
# The user, 28 Oct 2026: "Still with me?" and follow-ups went out after staff had set the lead to Appointment Booked -
# the AI read only its own record. Every message the AI starts on its own reads the CRM lead fresh: one of these
# statuses on any of the customer's leads stops it (staff own it now, or there is nothing left to sell).
CRM_STOP_STATUSES = frozenset({"appointment booked", "appointment set", "visited", "sold", "sold pending",
                               "sold delivered", "closed - lost", "dnd"})
# Not Managerial Review: the AI sets it itself (a vehicle check, a manager's answer) and keeps the lead.

# What each check does, in plain words (shown in AI Studio).
EXPLAINED = {
    "superseded": "A reply isn't sent when the customer has written again since it was written - the reply to "
                  "their newest message answers everything at once.",
    "appointment": "No sales follow-up goes to a customer who has an upcoming appointment on any of their leads - "
                   "the appointment's own messages run instead.",
    "crm_status": "No follow-up the AI starts on its own (\"Still with me?\", a cadence touch, a check-back) goes "
                  "to a customer whose lead staff have set to Appointment Booked, Visited, Sold, Closed - Lost or DND - "
                  "read fresh from the CRM at the moment it would be sent.",
    "calendar": "A message that confirms a visit on a day that isn't the booked day is stopped, and staff are told "
                "to check the appointment with the customer.",
    "burst": "A scheduled message waits 15 minutes when the customer already got 3 messages in the last 10 minutes.",
}


def _settings() -> dict[str, bool]:
    return {k: bool(CHECKS.get(k, True)) for k in ("superseded", "appointment", "calendar", "burst", "crm_status")}


def is_sales(turn_id: str, is_reply: bool) -> bool:
    return not is_reply and str(turn_id or "").startswith(SALES_PREFIXES)


async def _customer_lead_ids(db: Any, lead: dict | None, lead_id: str, customer_id: str) -> list[str]:
    ids = {str(lead_id)}
    for value in {customer_id, str((lead or {}).get("customer_id") or "")} - {"", "None"}:
        rows = await db.collection(PLATFORM_LEADS_COLLECTION).find(
            {"customer_id": {"$in": [value, as_object_id(value)]}}).to_list(200)
        ids.update(str(r["_id"]) for r in rows)
    return sorted(ids)


def _aware(value: Any) -> Any:
    from datetime import UTC
    return value.replace(tzinfo=UTC) if value is not None and getattr(value, "tzinfo", 1) is None else value


async def _upcoming_booking(db: Any, lead_ids: list[str], now: Any) -> dict | None:
    rows = await db.collection(PLATFORM_BOOKINGS_COLLECTION).find(
        {"lead_id": {"$in": lead_ids}, "booking_status": {"$ne": "cancelled"}}).to_list(50)
    from upsell_agent.agent import appointment
    from upsell_agent.integrations.dealer_profile import dealer_profile
    tz = (await dealer_profile(db.dealer_id)).tz
    best = None
    for row in rows:
        at = appointment.appointment_at(tz=tz, booking=row)
        if at is not None and at + APPOINTMENT_GRACE >= now and (best is None or at < best[0]):
            best = (at, row)
    return {**best[1], "_at": best[0]} if best else None


async def check(db: Any, *, lead_id: str, customer_id: str, turn_id: str, text: str, is_reply: bool,
                answers: list[str] | None, lead: dict | None) -> Verdict:
    """The verdict for one message about to be sent. Never raises: a failure here lets the message go (the send
    check still applies), so this can't silence a customer."""
    try:
        return await _check(db, lead_id=lead_id, customer_id=customer_id, turn_id=turn_id, text=text,
                            is_reply=is_reply, answers=answers or [], lead=lead)
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).exception("the last check before sending failed for lead %s", lead_id)
        return Verdict(True, "error", "the last check could not run; sent as checked by the send check")


async def _check(db: Any, *, lead_id: str, customer_id: str, turn_id: str, text: str, is_reply: bool,
                 answers: list[str], lead: dict | None) -> Verdict:
    on = _settings()
    now = clock.now()
    leads = await _customer_lead_ids(db, lead, lead_id, customer_id)
    messages = db.collection(AI_MESSAGES_COLLECTION)

    if on["superseded"] and is_reply and answers:
        # Newer than every message this reply answers, and not one of them (a reply answering three quick texts
        # isn't stale because of the third).
        from bson import ObjectId
        ids = [as_object_id(a) if ObjectId.is_valid(str(a)) else a for a in answers]
        covered = await messages.find({"_id": {"$in": ids}}).to_list(50)
        latest = max((_aware(m["created_at"]) for m in covered if m.get("created_at")), default=None)
        # Joyce Capuano, 26 Oct 2026: her newer message was already claimed by its own turn (answered_turn_id set),
        # so this reply went too and she got two answers 25 s apart. Any newer message another turn answers counts.
        newer = await messages.find_one({"lead_id": {"$in": leads}, "direction": "inbound", "_id": {"$nin": ids},
                                         "answered_turn_id": {"$nin": [turn_id]},
                                         "created_at": {"$gt": latest}}) if latest else None
        if newer:
            state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": str(newer["lead_id"])}) or {}
            # Denise Little, 27 Oct 2026: "G'morning" and "What state are you in?" 9 s apart got two replies, the first
            # ignoring her question - her lead was "partly_qualified", and only "active" counted. The newer message is
            # answered in every status but these (events/handlers.py _hold_decision).
            if state.get("status", "active") not in ("handoff", "paused", "opted_out"):
                return Verdict(False, "superseded", "the customer wrote again since; the reply to that message "
                                                    "answers both")

    booking = await _upcoming_booking(db, leads, now) if (on["appointment"] or on["calendar"]) else None
    if on["appointment"] and booking and is_sales(turn_id, is_reply):
        return Verdict(False, "appointment", f"the customer has an appointment on {booking['_at']:%A %B %-d at %-I:%M %p}"
                                             "; its own messages run instead of sales follow-ups")

    if on["crm_status"] and is_sales(turn_id, is_reply):
        rows = await db.collection(PLATFORM_LEADS_COLLECTION).find(
            {"_id": {"$in": [as_object_id(i) for i in leads]}},
            projection={"fe_lead_status": 1, "status": 1}).to_list(200)
        for row in rows:
            status = str(row.get("fe_lead_status") or row.get("status") or "").strip()
            if status.lower() in CRM_STOP_STATUSES:
                return Verdict(False, "crm_status", f"the CRM shows {status} on this customer's lead: no follow-up from "
                                                    "the AI")

    if on["calendar"] and booking and _CONFIRMS.search(text or ""):
        named = {d for d in _WEEKDAYS if re.search(rf"\b{d}\b", text, re.IGNORECASE)}
        booked = f"{booking['_at']:%A}".lower()
        if named and booked not in named:
            return Verdict(False, "calendar", f"the message confirms {', '.join(sorted(named))} but the booking is "
                                              f"{booking['_at']:%A %B %-d at %-I:%M %p}",
                           staff_notice=f"A message confirming {', '.join(sorted(named))} was stopped: the calendar "
                                        f"has {booking['_at']:%A %B %-d at %-I:%M %p}. Please check the appointment "
                                        "with the customer.")

    return Verdict(True)


async def burst_wait(db: Any, *, lead_id: str, customer_id: str, lead: dict | None = None) -> Verdict:
    """For a scheduled follow-up about to fire (scheduler/followups.py): wait when the customer just got several
    messages. A wait, never a cancel - the follow-up still goes, BURST_WAIT later."""
    if not _settings()["burst"]:
        return Verdict(True)
    try:
        now = clock.now()
        leads = await _customer_lead_ids(db, lead, lead_id, customer_id)
        recent = await db.collection(AI_MESSAGES_COLLECTION).count_documents(
            {"lead_id": {"$in": leads}, "direction": "outbound", "status": "sent",
             "sent_at": {"$gte": now - BURST_WINDOW}})
    except Exception:  # noqa: BLE001 - the follow-up goes as before
        return Verdict(True)
    if recent >= BURST_COUNT:
        return Verdict(False, "burst", f"{recent} messages in the last {int(BURST_WINDOW.total_seconds() // 60)} "
                                       "minutes; this one waits", hold_until=now + BURST_WAIT)
    return Verdict(True)
