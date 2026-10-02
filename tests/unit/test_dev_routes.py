"""The Debug UI's /dev API end to end, in process: the simulator creates a lead,
the job runs straight away (no queue), and the conversation, slots, turn list
and replay data come back the way the UI expects."""

import pytest
from fastapi.testclient import TestClient

from tests.unit.conftest import make_settings
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import EVENT_TYPES
from upsell_agent.main import create_app

# MASTER_PLAN_3 B1: these first replies are the in-hours kind.
pytestmark = pytest.mark.usefixtures("during_opening_hours")

DEALER = simulate.DEV_DEALERS[0]["_id"]
OTHER = simulate.DEV_DEALERS[1]["_id"]


class InlineQueue:
    """Runs each job immediately, the way a worker would, instead of queueing it."""

    def __init__(self):
        self.jobs: list[str] = []

    async def __call__(self, function, *, key, event, **kwargs):
        self.jobs.append(function)
        model = next(m for f, m in EVENT_TYPES.values() if f == function)
        handler = getattr(handlers, function)
        parsed = model.model_validate(event)
        if function in ("handle_lead_created", "handle_inbound_message"):
            await handler(parsed, TurnDeps())
        else:
            await handler(parsed)
        return key


@pytest.fixture
def client(mongo):
    app = create_app(make_settings("DEV"), connect=False)
    app.state.enqueue = InlineQueue()
    app.state.queue = None
    with TestClient(app) as c:
        yield c


def _new_lead(client, **overrides):
    body = {"dealer_id": DEALER, "lead_type": "trade_in", "channel": "sms", "name": "Sim Customer",
            "comments": "Trading my 2018 Honda"} | overrides
    res = client.post("/dev/simulate/lead", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_simulated_lead_runs_a_turn_and_shows_up_everywhere(client):
    created = _new_lead(client)
    assert created["event"] == "queued"

    leads = client.get("/dev/leads", params={"dealer_id": DEALER}).json()
    assert leads[0]["id"] == created["lead_id"] and leads[0]["status"] == "active"

    # The first reply is really sent (Stage 4), written by the pipeline (Stage 8).
    conversation = client.get(f"/dev/leads/{created['lead_id']}/conversation", params={"dealer_id": DEALER}).json()
    assert [c["kind"] for c in conversation] == ["lead", "message"]
    reply = conversation[1]
    assert reply["direction"] == "outbound" and reply["status"] == "sent" and reply["sent"] is True

    turns = client.get("/dev/turns", params={"dealer_id": DEALER, "lead_id": created["lead_id"]}).json()
    assert len(turns) == 1 and turns[0]["trigger"] == "lead_created"

    turn = client.get(f"/dev/turns/{turns[0]['turn_id']}", params={"dealer_id": DEALER}).json()
    assert turn["events"][0]["type"] == "turn_started" and turn["events"][-1]["type"] == "turn_finished"
    assert [n["node"] for n in turn["nodes"] if n["status"] == "done"] == [
        "load_context", "extract", "validate", "search_stock", "decide", "compose", "guard", "send", "schedule"]

    # The lead comments "Trading my 2018 Honda" filled trade-in slots (Stage 7).
    slots = client.get(f"/dev/leads/{created['lead_id']}/slots", params={"dealer_id": DEALER}).json()
    assert slots["implemented"] is True
    assert {s["path"] for s in slots["slots"] if s["state"] == "filled"} >= {"trade_in.year", "trade_in.make"}
    assert slots["required"]["total"] == 4
    assert {s["path"] for s in slots["slots"] if s["state"] == "missing"} >= {"trade_in.mileage", "trade_in.payoff"}


def test_reply_adds_a_second_turn(client):
    created = _new_lead(client)
    res = client.post("/dev/simulate/reply", json={"dealer_id": DEALER, "lead_id": created["lead_id"],
                                                   "channel": "sms", "text": "It has 80k miles"})
    assert res.status_code == 200
    turns = client.get("/dev/turns", params={"dealer_id": DEALER, "lead_id": created["lead_id"]}).json()
    assert [t["trigger"] for t in turns] == ["lead_created", "inbound_message"]


def test_pause_and_resume_from_the_ui(client):
    created = _new_lead(client)
    client.post(f"/dev/leads/{created['lead_id']}/pause", json={"dealer_id": DEALER})
    assert client.get("/dev/leads", params={"dealer_id": DEALER}).json()[0]["status"] == "paused"
    client.post(f"/dev/leads/{created['lead_id']}/resume", json={"dealer_id": DEALER})
    assert client.get("/dev/leads", params={"dealer_id": DEALER}).json()[0]["status"] == "active"


def test_another_dealer_cannot_see_the_lead(client):
    created = _new_lead(client)
    assert client.get("/dev/leads", params={"dealer_id": OTHER}).json() == []
    assert client.get(f"/dev/leads/{created['lead_id']}/conversation", params={"dealer_id": OTHER}).status_code == 404
    assert client.get("/dev/turns", params={"dealer_id": OTHER, "lead_id": created["lead_id"]}).json() == []


def test_reply_to_unknown_lead_is_404(client):
    res = client.post("/dev/simulate/reply", json={"dealer_id": DEALER, "lead_id": "66f0000000000000000000ff",
                                                   "channel": "sms", "text": "hi"})
    assert res.status_code == 404


def test_scenario_files_load_and_are_grouped_by_stage():
    from upsell_agent.devtools.scenarios import load_scenarios, scenarios_dir

    assert scenarios_dir().exists(), "run pytest from the agentic-upsell directory"
    scenarios = load_scenarios()
    assert {s["stage"] for s in scenarios} >= {1, 2, 3, 4, 6}
    for s in scenarios:
        assert s["steps"], s["id"]


def test_profile_endpoint_needs_the_shared_secret_and_returns_the_profile(client):
    created = _new_lead(client)
    url = f"/v1/leads/{created['lead_id']}/profile"
    assert client.get(url, params={"dealer_id": DEALER}).status_code == 401
    headers = {"Authorization": "Bearer test-secret"}
    body = client.get(url, params={"dealer_id": DEALER}, headers=headers).json()
    assert body["lead"]["status"] == "active" and body["lead"]["lead_type"] == "trade_in"
    assert body["required"]["total"] == 4
    # MASTER_PLAN_3 C4: the cadence replaces Plan 1's 24h switch - the next touch is the 3-hour name nudge.
    assert body["pending_followup"] is None
    assert body["cadence"]["next_touch"]["theme"] == "name_nudge" and body["cadence"]["touch_number"] == 2
    assert body["cadence"]["next_touch"]["due_at"].endswith("+00:00") and body["cadence"]["day"] == 1
    assert client.get(url, params={"dealer_id": OTHER}, headers=headers).status_code == 404


# --- MASTER_PLAN_2 Phase 9: what the Debug UI needs to explain a reply ------------------------

def test_ping_says_which_models_are_running(client):
    body = client.get("/dev/ping").json()
    assert body["models"] == {"extract": "offline", "compose": "offline"} and body["offline"] is True


def test_slots_come_with_the_conversation_state(client):
    lead_id = _new_lead(client, lead_type="sales", comments="Hi, I saw your ad")["lead_id"]
    res = client.post("/dev/simulate/reply", json={"dealer_id": DEALER, "lead_id": lead_id, "text": "hmm, is it AWD?"})
    assert res.status_code == 200, res.text
    body = client.get(f"/dev/leads/{lead_id}/slots", params={"dealer_id": DEALER}).json()
    conversation = body["conversation"]
    assert conversation["turn"] == 2 and conversation["max_asks"] == 2
    statuses = {a["path"]: a["status"] for a in conversation["asks"]}
    assert statuses["interest.new_or_used"] == ""               # asked in the first reply only
    assert "just asked" in statuses.values()                     # the second reply's ask
    assert all(a["label"] and a["count"] == 1 for a in conversation["asks"])
    assert body["summary"]["text"] == ""                         # nothing to summarize yet


# --- MASTER_PLAN_3 Phase 6 item 3: mark a vehicle sold, for testing freshness by hand ------------

async def test_mark_sold_removes_the_vehicle_so_it_reads_as_gone(client, mongo):
    from upsell_agent import clock
    from upsell_agent.integrations.mongodb import PLATFORM_VEHICLES_COLLECTION
    from upsell_agent.tools.inventory_tool import StubInventorySource, get_vehicle

    vin = "VIN00000000000901"
    await mongo[PLATFORM_VEHICLES_COLLECTION].insert_one({
        "dealerId": DEALER, "vin": vin, "year": 2022, "make": "Toyota", "model": "RAV4", "condition": "used",
        "createdAt": clock.now()})
    source = StubInventorySource()
    assert await get_vehicle(DEALER, vin, source) is not None

    res = client.post(f"/dev/stock/{vin}/mark-sold", params={"dealer_id": DEALER})
    assert res.status_code == 200 and res.json() == {"status": "sold", "vin": vin}
    assert await get_vehicle(DEALER, vin, source) is None


def test_mark_sold_404s_for_an_unknown_vin(client):
    res = client.post("/dev/stock/NOSUCHVIN/mark-sold", params={"dealer_id": DEALER})
    assert res.status_code == 404


# --- Scenarios never call a real AI model ---------------------------------------------------------

async def test_scenarios_refuse_to_run_with_real_models(monkeypatch):
    from upsell_agent.devtools import scenarios

    monkeypatch.setattr(scenarios, "get_settings", lambda: make_settings("DEV").model_copy(
        update={"model_extract": "openai:gpt-4o-mini", "model_compose": "openai:gpt-4o"}))
    with pytest.raises(scenarios.RealModelsRefused, match="MODEL_EXTRACT"):
        await scenarios.run_all(enqueue=None, queue=None)


def test_scenario_run_endpoint_refuses_real_models(client, monkeypatch):
    from upsell_agent.devtools import scenarios

    monkeypatch.setattr(scenarios, "get_settings", lambda: make_settings("DEV").model_copy(
        update={"model_extract": "openai:gpt-4o-mini", "model_compose": "openai:gpt-4o"}))
    res = client.post("/dev/scenarios/run", json={})
    assert res.status_code == 400 and "MODEL_EXTRACT" in res.json()["detail"]
