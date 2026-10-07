"""PLAN_4 stream X1 item 7: transactional texts follow the state rows (see test_state_hours.py KY test); staff call
tasks carry "do not call before / after" from the state's live-call window, re-checked when staff look; staff
calls count toward the FL / OK / MD "3 per 24 hours" cap."""

from datetime import UTC, timedelta

import pytest

from tests.unit.conftest import set_clock
from tests.unit.test_state_hours import CHI, DEALER, NY, _lead, _marketing, _pin_zone, local
from upsell_agent import clock
from upsell_agent.agent import call_tasks
from upsell_agent.compliance.call_check import call_window, can_call
from upsell_agent.compliance.customer_zone import CustomerZone
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import AI_CALL_TASKS_COLLECTION, dealer_scoped_db

FL = CustomerZone(("America/New_York",), "zip", "ZIP 33101 (test)", "FL")
KY = CustomerZone(("America/New_York",), "zip", "ZIP 40202 (test)", "KY")


@pytest.fixture
async def dealers(mongo):
    await simulate.ensure_platform_dealers()


async def _completed_calls(created, n, *, minutes_ago=60):
    db = dealer_scoped_db(DEALER)
    for i in range(n):
        await db.collection(AI_CALL_TASKS_COLLECTION).insert_one({
            "lead_id": created["lead_id"], "customer_id": created["customer_id"], "status": "completed",
            "outcome": "no_answer", "closed_at": clock.now() - timedelta(minutes=minutes_ago + i)})


async def test_three_staff_calls_hold_a_fourth_call_in_florida(mongo, dealers, monkeypatch):
    _pin_zone(monkeypatch, FL)
    set_clock(local(NY, 9, 22, 12).astimezone(UTC))
    created = await _lead()
    await _completed_calls(created, 3)
    decision = await can_call(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"])
    assert decision.outcome == "HOLD" and "cap" in decision.reason


async def test_staff_calls_and_marketing_texts_share_the_florida_cap(mongo, dealers, monkeypatch):
    _pin_zone(monkeypatch, FL)
    set_clock(local(NY, 9, 22, 12).astimezone(UTC))
    created = await _lead()
    await _completed_calls(created, 2)
    assert (await _marketing(created)).outcome == "ALLOW"   # the 3rd contact in 24 hours
    held = await _marketing(created)                        # a 4th would break "3 per 24 hours"
    assert held.outcome == "HOLD" and held.frequency.get("calls_last_24h") == 2


async def test_a_new_york_customer_has_no_state_call_cap(mongo, dealers, monkeypatch):
    _pin_zone(monkeypatch, CustomerZone(("America/New_York",), "zip", "ZIP 10001 (test)", "NY"))
    set_clock(local(NY, 9, 22, 12).astimezone(UTC))
    created = await _lead()
    await _completed_calls(created, 3)
    assert (await can_call(dealer_id=DEALER, customer_id=created["customer_id"],
                           lead_id=created["lead_id"])).outcome == "ALLOW"


async def test_call_window_says_do_not_call_before_and_after(mongo, dealers, monkeypatch):
    _pin_zone(monkeypatch, KY)
    set_clock(local(NY, 9, 22, 9, 30).astimezone(UTC))
    created = await _lead()
    window = await call_window(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"])
    assert window["can_call_now"] is False
    assert window["do_not_call_before"] == local(NY, 9, 22, 10)        # Kentucky's 10:00
    assert window["do_not_call_after"] == local(NY, 9, 22, 19)         # the dealer closes at 19:00
    assert window["states"] == ["KY"]


async def test_an_opened_task_carries_its_calling_window(mongo, dealers, monkeypatch):
    _pin_zone(monkeypatch, CustomerZone(("America/Chicago",), "zip", "ZIP 78701 (test)", "TX"))
    set_clock(local(CHI, 9, 22, 12).astimezone(UTC))
    created = await _lead()
    task = await call_tasks.open_task(dealer_scoped_db(DEALER), lead_id=created["lead_id"],
                                      customer_id=created["customer_id"], phone="+15125550100", customer_name="T",
                                      reason="test", source_turn_id=None, followup_id=None, created_at=clock.now())
    assert task["call_window"]["can_call_now"] is True
    # TX allows calls until 21:00 Chicago; the New York dealer closes at 19:00 New York = 18:00 Chicago.
    assert task["call_window"]["do_not_call_after"] == local(CHI, 9, 22, 18)


async def test_the_task_list_and_the_dial_check_re_check_now(mongo, dealers, monkeypatch):
    from upsell_agent.api import call_tasks as api

    _pin_zone(monkeypatch, KY)
    set_clock(local(NY, 9, 22, 11).astimezone(UTC))
    created = await _lead()
    task = await call_tasks.open_task(dealer_scoped_db(DEALER), lead_id=created["lead_id"],
                                      customer_id=created["customer_id"], phone="+15025550100", customer_name="K",
                                      reason="test", source_turn_id=None, followup_id=None, created_at=clock.now())
    set_clock(local(NY, 9, 22, 19, 30).astimezone(UTC))   # still open; the dealer closed at 19:00
    [listed] = await api.list_tasks(dealer_id=DEALER, status="open", lead_id=None)
    assert listed["call_window"]["can_call_now"] is False
    checked = await api.check_before_dialling(str(task["_id"]), dealer_id=DEALER)
    assert checked["can_call_now"] is False and checked["log_id"]
    assert checked["do_not_call_before"].startswith("2026-09-23")
