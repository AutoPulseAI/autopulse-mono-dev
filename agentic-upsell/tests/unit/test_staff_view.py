"""The CRM staff screens' reads (api/staff_view.py, MASTER_PLAN_4 stream C2)."""

from datetime import UTC, datetime, timedelta

from bson import ObjectId

from upsell_agent.api.staff_view import (
    Handled,
    lead_consent,
    list_call_tasks,
    list_notices,
    mark_handled,
)

DEALER, OTHER = "d1", "d2"
T0 = datetime(2026, 10, 1, 15, 0, tzinfo=UTC)


async def _state(mongo, lead_id, **fields):
    await mongo["ai_lead_state"].insert_one({"lead_id": lead_id, "dealer_id": DEALER, "customer_id": "c1", **fields})


async def test_notices_alerts_and_handoffs_are_listed_newest_first(mongo):
    await _state(mongo, "L1", staff_notice={"at": T0, "kind": "bad_contact", "text": "Bad number"})
    await _state(mongo, "L2", status="handoff", status_at=T0 + timedelta(hours=1), status_reason="Asked for a person",
                 staff_alert={"at": T0 + timedelta(hours=2), "reason": "No staff response"})
    await _state(mongo, "L3", stage="no_contact_made")  # nothing to show
    out = await list_notices(DEALER)
    assert [(n["lead_id"], n["source"]) for n in out["notices"]] == [("L2", "alert"), ("L2", "handoff"),
                                                                     ("L1", "notice")]
    assert out["unhandled_count"] == 3
    assert (await list_notices(OTHER))["notices"] == []


async def test_marking_handled_hides_it_until_a_newer_notice_arrives(mongo):
    await _state(mongo, "L1", staff_notice={"at": T0, "kind": "call_requested", "text": "Call them",
                                            "preferred_time": "after 5pm"})
    [notice] = (await list_notices(DEALER))["notices"]
    assert notice["preferred_time"] == "after 5pm"
    done = await mark_handled("L1", Handled(dealer_id=DEALER, source="notice", by="Sam"))
    assert done["handled"] is True
    assert (await list_notices(DEALER))["notices"] == []
    [kept] = (await list_notices(DEALER, include_handled=True))["notices"]
    assert kept["handled"] and kept["handled_by"] == "Sam"
    # The AI writes a newer notice: unhandled again; the AI's own field was never touched.
    await mongo["ai_lead_state"].update_one({"lead_id": "L1"}, {"$set": {"staff_notice": {
        "at": T0 + timedelta(hours=1), "kind": "bad_contact", "text": "Bounced"}}})
    assert (await list_notices(DEALER))["unhandled_count"] == 1
    assert await mark_handled("nope", Handled(dealer_id=DEALER, source="notice")) is None
    # Another dealer can't mark this one's lead.
    assert await mark_handled("L1", Handled(dealer_id=OTHER, source="notice")) is None


async def test_not_interested_stays_handled_while_the_reason_is_unchanged(mongo):
    await _state(mongo, "L1", last_turn_at=T0, conversation={"not_interested": {"reason": "bought elsewhere"}})
    await mark_handled("L1", Handled(dealer_id=DEALER, source="not_interested"))
    await mongo["ai_lead_state"].update_one({"lead_id": "L1"}, {"$set": {"last_turn_at": T0 + timedelta(days=1)}})
    assert (await list_notices(DEALER))["notices"] == []


async def test_call_task_views_carry_the_stage_and_last_touch(mongo):
    await _state(mongo, "L1", stage="no_contact_made", last_outbound_at=T0)
    await mongo["ai_call_tasks"].insert_many([
        {"dealer_id": DEALER, "lead_id": "L1", "status": "open", "phone": "+15550000001", "opened_at": T0},
        {"dealer_id": DEALER, "lead_id": "L1", "status": "completed", "outcome": "connected", "closed_at": T0},
    ])
    await mongo["scheduled_followups"].insert_one(
        {"dealer_id": DEALER, "lead_id": "L1", "kind": "call_task", "status": "pending", "due_at": T0, "to": "+1555"})
    [task] = await list_call_tasks(DEALER, "open")
    assert task["stage_label"] == "No Contact Made" and task["last_ai_touch_at"].startswith("2026-10-01T15:00")
    assert [t["outcome"] for t in await list_call_tasks(DEALER, "done")] == ["connected"]
    [waiting] = await list_call_tasks(DEALER, "upcoming")
    assert waiting["status"] == "waiting" and waiting["phone"] == "+1555"
    assert await list_call_tasks(OTHER, "open") == []


async def test_consent_per_channel(mongo):
    lead_id = ObjectId()
    await mongo["leads"].insert_one({"_id": lead_id, "dealer_id": DEALER, "phone": "5550000001",
                                     "email": "a@example.com"})
    await mongo["ai_consent"].insert_one({"dealer_id": DEALER, "address": "+15550000001", "channel": "sms",
                                          "consent_type": "opt_out", "consent_status": "opted_out",
                                          "source": "stop_keyword", "recorded_at": T0})
    out = await lead_consent(DEALER, str(lead_id))
    assert out["channels"]["sms"]["opted_out"] is True
    assert out["channels"]["email"]["opted_out"] is False and out["channels"]["email"]["address"] == "a@example.com"
    assert await lead_consent(OTHER, str(lead_id)) is None


def test_routes_need_the_shared_secret(mongo):
    from fastapi.testclient import TestClient

    from tests.unit.conftest import make_settings
    from upsell_agent.main import create_app

    client = TestClient(create_app(make_settings("PROD"), connect=False))
    assert client.get("/v1/staff/notices", params={"dealer_id": DEALER}).status_code == 401
    ok = client.get("/v1/staff/notices", params={"dealer_id": DEALER},
                    headers={"Authorization": "Bearer test-secret"})
    assert ok.status_code == 200 and ok.json() == {"notices": [], "unhandled_count": 0}
    assert client.get("/v1/staff/call-tasks", params={"dealer_id": DEALER, "view": "done"},
                      headers={"Authorization": "Bearer test-secret"}).json() == []
