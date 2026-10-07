"""POST /v1/events/* (MASTER_PLAN_1 Stage 2): shared-secret auth, payload
validation, one job per event ID, and no lost events when the queue is down."""

import pytest
from fastapi.testclient import TestClient

from tests.unit.conftest import make_settings
from upsell_agent.main import create_app

AUTH = {"Authorization": "Bearer test-secret"}
LEAD_CREATED = {"event_id": "lead-1", "dealer_id": "dealer-a", "lead_id": "lead-1", "customer_id": "cust-1",
                "channel": "sms"}


class FakeQueue:
    def __init__(self, fail: bool = False):
        self.calls: list[dict] = []
        self.fail = fail

    async def __call__(self, function, *, key, **kwargs):
        if self.fail:
            raise ConnectionError("redis down")
        self.calls.append({"function": function, "key": key, **kwargs})
        return key


@pytest.fixture
def client(mongo):
    app = create_app(make_settings("PROD"), connect=False)
    app.state.enqueue = FakeQueue()
    with TestClient(app) as c:
        yield c


def test_rejects_missing_and_wrong_token(client):
    assert client.post("/v1/events/lead-created", json=LEAD_CREATED).status_code == 401
    wrong = {"Authorization": "Bearer nope"}
    assert client.post("/v1/events/lead-created", json=LEAD_CREATED, headers=wrong).status_code == 401
    assert client.app.state.enqueue.calls == []


def test_unknown_event_type_is_404(client):
    assert client.post("/v1/events/lead-deleted", json=LEAD_CREATED, headers=AUTH).status_code == 404


def test_invalid_payload_is_422(client):
    bad = {**LEAD_CREATED, "channel": "fax"}
    assert client.post("/v1/events/lead-created", json=bad, headers=AUTH).status_code == 422


def test_same_event_twice_queues_one_job(client):
    first = client.post("/v1/events/lead-created", json=LEAD_CREATED, headers=AUTH)
    second = client.post("/v1/events/lead-created", json=LEAD_CREATED, headers=AUTH)

    assert first.status_code == 202
    assert first.json() == {"status": "queued", "job_key": "lead-created:lead-1"}
    assert second.status_code == 200
    assert second.json() == {"status": "duplicate"}
    calls = client.app.state.enqueue.calls
    assert len(calls) == 1
    assert calls[0]["function"] == "handle_lead_created"
    assert calls[0]["event"]["lead_id"] == "lead-1"


def test_same_event_id_for_different_event_types_is_not_a_duplicate(client):
    paused = {"event_id": "lead-1", "dealer_id": "dealer-a", "lead_id": "lead-1"}
    assert client.post("/v1/events/lead-created", json=LEAD_CREATED, headers=AUTH).status_code == 202
    assert client.post("/v1/events/lead-paused", json=paused, headers=AUTH).status_code == 202


def test_queue_down_returns_503_and_the_retry_is_accepted(client):
    client.app.state.enqueue.fail = True
    assert client.post("/v1/events/lead-created", json=LEAD_CREATED, headers=AUTH).status_code == 503

    client.app.state.enqueue.fail = False
    retry = client.post("/v1/events/lead-created", json=LEAD_CREATED, headers=AUTH)
    assert retry.status_code == 202
    assert len(client.app.state.enqueue.calls) == 1


def test_all_four_event_types_route_to_their_job(client):
    inbound = {"event_id": "msg-1", "dealer_id": "dealer-a", "customer_id": "cust-1", "channel": "email",
               "message_id": "msg-1", "text": "hi", "received_at": "2026-09-24T10:00:00Z"}
    paused = {"event_id": "p-1", "dealer_id": "dealer-a", "lead_id": "lead-1", "reason": "staff"}
    resumed = {"event_id": "r-1", "dealer_id": "dealer-a", "lead_id": "lead-1"}
    for kind, body in [("lead-created", LEAD_CREATED), ("inbound-message", inbound), ("lead-paused", paused),
                       ("lead-resumed", resumed)]:
        assert client.post(f"/v1/events/{kind}", json=body, headers=AUTH).status_code == 202
    assert [c["function"] for c in client.app.state.enqueue.calls] == [
        "handle_lead_created", "handle_inbound_message", "handle_lead_paused", "handle_lead_resumed"]
