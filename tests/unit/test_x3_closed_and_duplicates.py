"""PLAN_4 stream X3 item 8 (audit 4 C3-C5): a linked duplicate is released when its primary finishes; a customer
with only closed leads and no owned vehicle becomes INACTIVE; a new lead after a close is worked like any lead
(and an appointment there gets its timers)."""

import pytest

from upsell_agent.agent import lifecycle, ownership
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import LeadCreatedEvent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
)

pytestmark = pytest.mark.usefixtures("during_opening_hours")

DEALER = simulate.DEV_DEALERS[0]["_id"]


async def _created(customer_id=None):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Eve", comments="RAV4",
                                         customer_id=customer_id)
    result = await handlers.handle_lead_created(
        LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
                         customer_id=created["customer_id"], channel="sms"), TurnDeps())
    return created, result


async def _close(lead_id, customer_id):
    db = dealer_scoped_db(DEALER)
    return await lifecycle.apply(db, lead_id, [lifecycle.Event("day_91", source="test")], customer_id=customer_id)


async def test_a_linked_duplicate_is_released_when_the_primary_closes(mongo):
    first, _ = await _created()
    second, linked = await _created(first["customer_id"])
    assert linked["status"] == "duplicate"
    out = await _close(first["lead_id"], first["customer_id"])
    assert out["released_duplicates"] == [second["lead_id"]]
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": second["lead_id"]})
    assert state["status"] == "active" and not state.get("duplicate_of") and state["stage"]
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": second["lead_id"], "status": "pending"}) >= 1  # its own cadence, not "paused" for ever


async def test_only_closed_leads_and_nothing_owned_is_inactive(mongo):
    first, _ = await _created()
    await _close(first["lead_id"], first["customer_id"])
    status = await ownership.recalculate_customer_status(dealer_scoped_db(DEALER), first["customer_id"], reason="t")
    assert status["customer_status"] == "INACTIVE"  # before: ACTIVE for ever ("no ownership record" = unknown)


async def test_a_new_lead_after_the_close_runs_its_own_workflow(mongo):
    first, _ = await _created()
    await _close(first["lead_id"], first["customer_id"])
    second, result = await _created(first["customer_id"])
    assert result["status"] == "done"
    db = dealer_scoped_db(DEALER)
    moved = await lifecycle.apply(db, second["lead_id"], [lifecycle.Event(
        "appointment_set", source="test", detail={"appointment": {"at": "2026-10-10", "time": "10:00"}})],
        customer_id=first["customer_id"])
    assert moved["stage"] == lifecycle.Stage.APPOINTMENT_SET.value
    assert lifecycle.kind_allowed("appointment_confirm", lifecycle.Stage.APPOINTMENT_SET)
    status = await ownership.recalculate_customer_status(db, first["customer_id"], reason="t")
    assert status["customer_status"] == "ACTIVE"
