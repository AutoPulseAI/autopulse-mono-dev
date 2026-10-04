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
from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION, SCHEDULED_FOLLOWUPS_COLLECTION
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
