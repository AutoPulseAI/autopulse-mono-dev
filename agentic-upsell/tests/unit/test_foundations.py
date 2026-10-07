"""Stage 1 foundations: the DEV switch, the shared clock, the fake channel
driver and the stub platform client."""

from datetime import timedelta

import fakeredis.aioredis
import pytest

from tests.unit.conftest import make_settings
from upsell_agent import clock
from upsell_agent.channels import get_channel_driver
from upsell_agent.channels.base import OutboundMessage
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import DEV_OUTBOX_COLLECTION
from upsell_agent.integrations.platform_client import StubPlatformClient, get_platform_client


@pytest.mark.parametrize(("environment", "is_dev"), [("DEV", True), ("dev", True), ("PROD", False),
                                                     ("development", False), ("", False)])
def test_only_dev_turns_on_debug_behaviour(environment, is_dev):
    assert make_settings(environment).is_dev is is_dev


async def test_clock_moves_forward_and_is_shared_through_redis():
    client = fakeredis.aioredis.FakeRedis()
    before = clock.now()
    await clock.advance(client, 24 * 3600)
    assert clock.now() - before >= timedelta(hours=24)

    clock.set_offset(0)  # another process that hasn't synced yet
    await clock.sync(client)
    assert clock.offset_s() == 24 * 3600

    await clock.reset(client)
    assert clock.offset_s() == 0


async def test_fake_driver_writes_to_the_dev_outbox(mongo):
    driver = get_channel_driver(make_settings("DEV"))
    result = await driver.send(OutboundMessage(dealer_id="d1", lead_id="l1", customer_id="c1", channel="sms",
                                               to="+15550000000", text="hi", idempotency_key="t1:sms"))
    doc = await mongo[DEV_OUTBOX_COLLECTION].find_one({"provider_id": result.provider_id})
    assert doc["dealer_id"] == "d1" and doc["text"] == "hi"


def test_live_channel_driver_needs_provider_credentials():
    # Built in Stage 12 (tests/unit/test_live_drivers.py); without credentials
    # the worker must refuse to start rather than fail on the first send.
    settings = make_settings("PROD").model_copy(update={"channel_driver": "live"})
    with pytest.raises(ValueError, match="TWILIO_ACCOUNT_SID"):
        get_channel_driver(settings)


async def test_stub_platform_client_returns_that_dealers_360_only(mongo):
    """Same contract as the live client: the route's `data` object, or None
    when the customer doesn't exist for that dealer."""
    dealer_a, dealer_b = simulate.DEV_DEALERS[0]["_id"], simulate.DEV_DEALERS[1]["_id"]
    history = {"vehicles": [{"vin": "DEVFOUNDATION0001", "year": 2020, "make": "Honda", "model": "Fit"}],
               "deals": [{"vin": "DEVFOUNDATION0001", "years_ago": 2, "price": 15000, "salesperson": "Pat"}]}
    customer_id = await simulate.create_customer(dealer_a, "Pat", history)
    client = get_platform_client(make_settings("DEV"))
    assert isinstance(client, StubPlatformClient)
    assert (await client.get_customer_360(dealer_a, customer_id))["vehicles"][0]["make"] == "Honda"
    assert await client.get_customer_360(dealer_b, customer_id) is None
