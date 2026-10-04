"""PLAN_4 stream X2: workflow and after-sale defects found by the independent audits (audit 1 - New Lead
Omnichannel PDF; audit 3 - SOLD PENDING / SOLD DELIVERED PDFs). Each test here failed before its fix; the
auditor's five probes (P1-P5) are among them, turned round to assert the correct behaviour."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from tests.unit.conftest import set_clock
from tests.unit.test_appointment import (  # noqa: F401  (live_dealer is a fixture)
    DEALER,
    _booked_friday,
    _deps,
    _fire,
    _new_lead,
    _outbox,
    _say,
    _state,
    _steps,
    live_dealer,
)
from upsell_agent import clock
from upsell_agent.agent import lifecycle
from upsell_agent.events import handlers
from upsell_agent.events.models import LeadPausedEvent, LeadResumedEvent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
)
from upsell_agent.scheduler import followups

NY = ZoneInfo("America/New_York")
flow = pytest.mark.usefixtures("during_opening_hours", "ny_customer", "live_dealer")


async def _pause_and_resume(created, reason="Staff replied"):
    await handlers.handle_lead_paused(LeadPausedEvent(event_id="p", dealer_id=DEALER, lead_id=created["lead_id"],
                                                      reason=reason), _deps())
    return await handlers.handle_lead_resumed(LeadResumedEvent(event_id="r", dealer_id=DEALER,
                                                               lead_id=created["lead_id"]))


async def _pending(mongo, created, kind) -> list[dict]:
    return await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "kind": kind, "status": "pending"}).to_list(None)


# --- Item 1: staff pause -> resume re-plans the workflow (probe P5) ----------------------------------------------

@flow
async def test_resume_after_a_staff_pause_restarts_the_cadence_where_it_was(mongo):
    created = await _new_lead()
    before = await _state(mongo, created)
    assert len(await _pending(mongo, created, "cadence_touch")) == 1
    await _pause_and_resume(created)
    state = await _state(mongo, created)
    touches = await _pending(mongo, created, "cadence_touch")
    assert state["status"] == "active" and len(touches) == 1
    # A person has spoken to the customer: no "Maria?" nudge; the cadence goes on with Touch 3.
    assert touches[0]["touch"]["touch_number"] == 3
    # The Day 91 clock and the cadence's own start are untouched.
    assert state["opportunity_created_at"] == before["opportunity_created_at"]
    assert state["cadence"]["started_at"] == before["cadence"]["started_at"]
    set_clock(clock.now() + timedelta(days=10))
    for _ in range(12):
        await followups.fire_due(_deps())
    assert len(await _outbox(mongo, created)) > 1


@flow
async def test_resume_re_plans_the_appointment_steps(mongo):
    created, _ = await _booked_friday(mongo)
    before = [s["step"] for s in await _steps(mongo, created)]
    await _pause_and_resume(created)
    assert [s["step"] for s in await _steps(mongo, created)] == before
    assert (await _state(mongo, created))["stage"] == "appointment_set"


# --- Item 2: No Show doesn't depend on the message being sendable (probes P2, P4) ------------------------------

async def _move_booking(mongo, created, day: datetime, hhmm: str):
    from tests.unit.test_appointment import _booking, _scoped
    from upsell_agent.integrations.mongodb import PLATFORM_BOOKINGS_COLLECTION
    booking = await _booking(mongo, created)
    await mongo[PLATFORM_BOOKINGS_COLLECTION].update_one({"_id": booking["_id"]}, {"$set": {
        "bookingDate": datetime(day.year, day.month, day.day, tzinfo=NY).astimezone(UTC), "bookingTime": hhmm}})
    return await followups.plan_appointment_timers(await _scoped(), lead_id=created["lead_id"],
                                                   customer_id=created["customer_id"], turn_id="moved")


@flow
async def test_a_lead_with_staff_still_becomes_a_no_show_and_never_strands(mongo):
    created, _ = await _booked_friday(mongo)
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]}, {"$set": {"status": "handoff"}})
    await _fire(mongo, created, "no_show_check")
    assert (await _state(mongo, created))["stage"] == "appointment_no_show"
    before = len(await _outbox(mongo, created))
    # The no-show flow goes on (no messages while staff hold it) and the lead goes back into follow-up.
    for _ in range(3):
        set_clock(clock.now() + timedelta(hours=25))
        await followups.fire_due(_deps())
    state = await _state(mongo, created)
    assert state["stage"] == "contact_made_no_next_action"
    assert len(await _outbox(mongo, created)) == before  # nothing sent to a lead staff hold
    set_clock(clock.now() + timedelta(days=120))
    await lifecycle.close_expired()
    assert (await _state(mongo, created))["stage"] == "closed_lost"


@flow
async def test_an_after_closing_no_show_moves_the_stage_at_once_and_never_sends_the_showroom_text_late(mongo):
    created, _ = await _booked_friday(mongo)
    await _move_booking(mongo, created, datetime(2026, 10, 10, tzinfo=NY), "16:30")  # Saturday; the dealer shuts at 17:00
    check = next(s for s in await _steps(mongo, created) if s["step"] == "no_show_check")
    assert check["due_at"].replace(tzinfo=UTC) == datetime(2026, 10, 10, 17, 30, tzinfo=NY)  # not held to Monday
    before = len(await _outbox(mongo, created))
    await _fire(mongo, created, "no_show_check")
    assert (await _state(mongo, created))["stage"] == "appointment_no_show"  # Sat 17:31, not Mon 09:00
    after_check = await _outbox(mongo, created)
    assert not any("looking for you in the showroom" in m["text"] for m in after_check[before:])
    [followup] = [s for s in await _steps(mongo, created) if s["step"] == "no_show_followup"]
    set_clock(followup["due_at"].replace(tzinfo=UTC) + timedelta(minutes=1))
    await followups.fire_due(_deps())
    texts = [m["text"] for m in (await _outbox(mongo, created))[before:]]
    assert texts and not any("looking for you in the showroom" in t for t in texts)
    assert any("How did everything go" in t for t in texts)


@flow
async def test_day_91_closes_an_appointment_long_past_that_nothing_resolved(mongo):
    created, _ = await _booked_friday(mongo)
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].update_many({"lead_id": created["lead_id"]},
                                                           {"$set": {"status": "cancelled"}})
    set_clock(clock.now() + timedelta(days=95))
    await lifecycle.close_expired()
    assert (await _state(mongo, created))["stage"] == "closed_lost"



# --- Item 3: the call checkpoint behind appointment / no-show / visit follow-up touches (probe P3) ----------------

@flow
async def test_the_confirmation_and_no_show_touches_start_the_call_checkpoint(mongo):
    created, _ = await _booked_friday(mongo)
    await _fire(mongo, created, "confirm")
    [timer] = await _pending(mongo, created, "call_task")
    assert timer["planned_stage"] == "appointment_set"
    await _fire(mongo, created, "no_show_check")
    [timer] = await _pending(mongo, created, "call_task")
    assert timer["source_turn_id"].startswith("appointment-no_show_check")


@flow
async def test_the_visit_follow_up_goes_on_text_and_email_and_starts_the_call_checkpoint(mongo):
    from upsell_agent.integrations.mongodb import dealer_scoped_db
    created = await _new_lead()
    db = dealer_scoped_db(DEALER)
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].update_many({"lead_id": created["lead_id"]},
                                                           {"$set": {"status": "cancelled"}})
    tomorrow = (clock.now() + timedelta(days=1)).astimezone(NY).date().isoformat()
    await followups.plan_visit_followup(db, lead_id=created["lead_id"], customer_id=created["customer_id"],
                                        channel="sms", turn_id="t", due_date=tomorrow)
    before = len(await _outbox(mongo, created))
    set_clock(datetime.fromisoformat(tomorrow + "T10:05").replace(tzinfo=NY))
    await followups.fire_due(_deps())
    assert {m["channel"] for m in (await _outbox(mongo, created))[before:]} == {"sms", "email"}
    assert len(await _pending(mongo, created, "call_task")) == 1
