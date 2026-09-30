"""The numbers to watch (MASTER_PLAN_1 Stage 12): computed from real turns
driven with the offline model's dev hints (#retry = the guard rejects the
first draft, #fallback = it rejects both, #reject = an extracted value is
thrown away), and served on GET /v1/metrics behind the shared secret."""

from datetime import timedelta

from fastapi.testclient import TestClient

from tests.unit.conftest import make_settings
from tests.unit.test_inventory_tool import _stock, _vehicle
from upsell_agent import clock
from upsell_agent.agent.turn import TurnDeps, run_turn
from upsell_agent.devtools import simulate
from upsell_agent.main import create_app
from upsell_agent.observability.metrics import dealer_metrics, format_report
from upsell_agent.observability.trace import MemoryTraceSink

DEALER = simulate.DEV_DEALERS[0]["_id"]
OTHER = simulate.DEV_DEALERS[1]["_id"]


async def _turn(created, text, trigger="inbound_message", dealer=DEALER):
    return await run_turn(dealer_id=dealer, customer_id=created["customer_id"], lead_id=created["lead_id"],
                          trigger=trigger, channel="sms", inbound_text=text, shadow=False,
                          deps=TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink()),
                          event_received_at=clock.now() - timedelta(milliseconds=1500))


async def _lead(name, dealer=DEALER):
    return await simulate.create_lead(dealer, lead_type="sales", channel="sms", name=name, comments="hi")


async def test_metrics_count_what_happened(mongo):
    a = await _lead("Ann")
    await _turn(a, "I want a new Toyota RAV4", trigger="lead_created")     # clean first reply
    await _turn(a, "budget $30k #retry")                                   # guard fails once, rewrite passes
    b = await _lead("Bob")
    await _turn(b, "hello #fallback", trigger="lead_created")              # guard fails twice -> template
    c = await _lead("Cat")
    await _turn(c, "Can a manager call me?", trigger="lead_created")       # hand-off
    await _turn(c, "It's a 2019 Civic #reject")                            # a value is rejected
    other = await _lead("Olga", dealer=OTHER)
    await _turn(other, "hi", trigger="lead_created", dealer=OTHER)          # another dealer: not counted

    m = await dealer_metrics(DEALER, days=1)
    assert m["turns"] == 5 and m["leads"]["total"] == 3
    assert m["first_reply_ms"]["n"] == 3 and m["first_reply_ms"]["p50"] >= 1500
    assert m["first_reply_ms"]["under_8s"] == 1.0
    assert m["template_fallback"]["turns"] == 1 and m["template_fallback"]["rate"] == 0.2
    assert m["guard_failures"] == {"drafts": 3, "turns": 2, "rate": 0.4}
    assert m["rejected_extractions"]["values"] >= 1
    assert m["leads"]["by_status"].get("handoff") == 2   # asked for a person + the double guard failure
    assert m["sends"] == {"sent": 5}
    assert m["followups"].get("pending", 0) >= 1
    assert set(m["cost_usd"]["by_day"]) == {clock.now().strftime("%Y-%m-%d")}

    text = format_report(m)
    assert "First reply" in text and "Template fallback:  1 turn(s), 20.0%" in text


async def test_grounding_rejections_and_inventory_timing_are_counted(mongo):
    """MASTER_PLAN_3 Phase 7 item 5: a grounding-specific rejection (#badtrim)
    is counted separately from an ordinary guard failure, and a search_stock
    run's own time is tracked."""
    await _stock(mongo, _vehicle("VIN00000000000901", make="Toyota", model="RAV4", trim="LE"))
    a = await _lead("Gwen")
    await _turn(a, "Hi, I saw your ad", trigger="lead_created")
    await _turn(a, "#badtrim Do you have a Toyota RAV4?")  # grounding rejects attempt 1, rewrite passes

    m = await dealer_metrics(DEALER, days=1)
    assert m["grounding_rejections"] == {"drafts": 1, "turns": 1, "rate": 0.5}
    assert m["inventory_query_ms"]["n"] >= 1 and m["inventory_query_ms"]["p50"] is not None

    text = format_report(m)
    assert "Grounding rejected" in text and "Inventory query" in text


async def test_old_turns_fall_outside_the_window(mongo):
    a = await _lead("Ann")
    await _turn(a, "hi", trigger="lead_created")
    clock.set_offset(timedelta(days=3).total_seconds())
    m = await dealer_metrics(DEALER, days=1)
    assert m["turns"] == 0 and m["leads"]["total"] == 0 and m["first_reply_ms"]["p50"] is None
    assert m["template_fallback"]["rate"] is None


def test_metrics_api_needs_the_shared_secret(mongo):
    app = create_app(make_settings("PROD"), connect=False)
    with TestClient(app) as client:
        assert client.get("/v1/metrics", params={"dealer_id": DEALER}).status_code == 401
        auth = {"Authorization": "Bearer test-secret"}
        assert client.get("/v1/metrics", headers=auth).status_code == 422
        response = client.get("/v1/metrics", params={"dealer_id": DEALER, "days": 7}, headers=auth)
        assert response.status_code == 200 and response.json()["dealer_id"] == DEALER
