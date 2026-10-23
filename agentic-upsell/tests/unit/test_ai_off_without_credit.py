"""Betsy, 23 Oct 2026: "We need AI off if no credits", "No message is better than a garbage message", "we need to be
notified immediately by email - me and Bibi only, NOT the dealer".

When the model provider refuses for an account reason (no credit, a bad key), nothing is sent - not even the safe
template - the AI switches off and AutoPulse is emailed once; while off, every event is held; when the provider
answers again the AI is back on, AutoPulse is emailed, and the held events are replayed in order.
"""

import pytest

from tests.unit.test_human_contact import TUESDAY_NOON, _deps, _lead, live_dealer  # noqa: F401
from tests.unit.conftest import set_clock
from upsell_agent.agent import provider_health, turn
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent
from upsell_agent.integrations.mongodb import DEV_OUTBOX_COLLECTION

pytestmark = pytest.mark.usefixtures("ny_customer")
NO_CREDIT = ("compose failed: ModelHTTPError: status_code: 429, model_name: gpt-5, body: {'message': 'You have no "
             "credits remaining.', 'type': 'insufficient_quota', 'code': 'credit_balance_exhausted'}")


def _event(created, text, n):
    from bson import ObjectId
    from upsell_agent import clock
    return InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=created["dealer_id"] if "dealer_id" in created
                               else _dealer(), customer_id=created["customer_id"], lead_id=created["lead_id"],
                               message_id=f"m-{n}-{ObjectId()}", channel="sms", text=text, received_at=clock.now())


def _dealer():
    from tests.unit.test_human_contact import DEALER
    return DEALER


@pytest.fixture
def no_credit(monkeypatch):
    """Call it to make the credit run out from that moment."""
    from upsell_agent.agent import graph

    async def broken(state, span, ctx):
        return {"draft": None, "fallback_reason": NO_CREDIT}

    def run_out():
        monkeypatch.setattr(graph, "compose", broken)
        turn._graph.cache_clear()
        provider_health._forget()

    yield run_out
    turn._graph.cache_clear()
    provider_health._forget()


async def _outbox(mongo, created):
    return await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)


async def test_no_credit_sends_nothing_switches_off_and_emails_autopulse_once(mongo, live_dealer, no_credit):
    set_clock(TUESDAY_NOON)
    created = await _lead("Olga Outage")
    no_credit()
    before = len(await _outbox(mongo, created))
    with pytest.raises(provider_health.ProviderDown):
        await handlers.handle_inbound_message(_event(created, "Is the RAV4 still there?", 1), _deps())
    assert len(await _outbox(mongo, created)) == before  # no template, nothing at all
    assert await provider_health.is_down()
    alerts = await mongo["dev_ops_alerts"].find({}).to_list(None)
    assert len(alerts) == 1 and "AI is OFF" in alerts[0]["subject"]
    # While off: the next message is held before anything runs, and no second email.
    with pytest.raises(provider_health.ProviderDown):
        await handlers.handle_inbound_message(_event(created, "hello?", 2), _deps())
    assert len(await _outbox(mongo, created)) == before
    assert len(await mongo["dev_ops_alerts"].find({}).to_list(None)) == 1


async def test_back_on_replays_the_held_events_and_emails(mongo, monkeypatch):
    from upsell_agent.worker import jobs
    await provider_health.mark_down("insufficient_quota")
    await provider_health.hold_event("handle_inbound_message", {"dealer_id": "d1", "lead_id": "L1", "text": "hi"}, None)
    await provider_health.hold_event("handle_lead_created", {"dealer_id": "d1", "lead_id": "L2"}, None)

    async def answers(settings):
        return True, "ok"

    monkeypatch.setattr(provider_health, "probe", answers)
    enqueued = []

    class Q:
        async def enqueue(self, function, **kwargs):
            enqueued.append((function, kwargs["event"]["lead_id"]))

    class W:
        queue = Q()

    class D:
        from upsell_agent.integrations.platform_client import StubPlatformClient
        platform = StubPlatformClient()

    provider_health._forget()
    result = await jobs.check_ai_provider({"worker": W(), "deps": D()})
    assert result == {"status": "back_on", "replayed": 2}
    assert enqueued == [("handle_inbound_message", "L1"), ("handle_lead_created", "L2")]  # in order
    assert not await provider_health.is_down()
    assert await provider_health.held_events() == []
    subjects = [a["subject"] for a in await mongo["dev_ops_alerts"].find({}).to_list(None)]
    assert any("back ON" in s for s in subjects)


async def test_a_slow_or_one_off_failure_is_not_an_outage():
    assert not provider_health.is_provider_failure("compose failed: ReadTimeout('')")
    assert not provider_health.is_provider_failure("guard rejected the draft twice")
    assert provider_health.is_provider_failure(NO_CREDIT)
    assert provider_health.is_provider_failure("extract failed: AuthenticationError: Incorrect API key provided")
