"""CHANNEL_DRIVER=platform (MASTER_PLAN_4 stream C1): the CRM sends for us.

Against a mocked CRM: the exact request, how each answer is classified, the
media, the non-production allowlist, and the rest of the CRM contract added
with it (DND on a full opt-out, `showed` on a booking, the 409 for a taken
slot). Goes through the real sender, so retries, suppression and consent are
exercised too."""

import json

import httpx
import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings
from upsell_agent.channels import consent, get_channel_driver
from upsell_agent.channels.platform import PlatformChannelDriver
from upsell_agent.channels.sender import Sender, SendRequest
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import (
    PLATFORM_BOOKINGS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import (
    LivePlatformClient,
    PlatformError,
    SlotTakenError,
    StubPlatformClient,
)

DEALER = simulate.DEV_DEALERS[0]["_id"]


class Crm:
    """A scripted CRM: answers each request with the next response."""

    def __init__(self, *responses: httpx.Response | Exception):
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    def transport(self) -> httpx.MockTransport:
        def handle(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            answer = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
            if isinstance(answer, Exception):
                raise answer
            return answer
        return httpx.MockTransport(handle)


def _driver(crm: Crm, **kw) -> PlatformChannelDriver:
    return PlatformChannelDriver(base_url="http://crm.test/", shared_secret="s3cret", transport=crm.transport(), **kw)


def _ok(provider_id="SM42"):
    return httpx.Response(200, json={"id": "e1", "provider_id": provider_id, "status": "sent", "created": True})


async def _send(driver, channel="sms", media=()):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel=channel, name="Maria Test", comments="hi")
    sender = Sender(driver, StubPlatformClient(), retry_base_s=0)
    outcome = await sender.send(SendRequest(
        dealer_id=DEALER, lead_id=created["lead_id"], customer_id=created["customer_id"], turn_id="t1",
        channel=channel, text="Here is the RAV4", subject="Your RAV4", media_urls=tuple(media)))
    return outcome, created


async def test_the_crm_is_asked_to_send_with_the_secret_and_the_photos(mongo):
    crm = Crm(_ok("SM42"))
    outcome, created = await _send(_driver(crm), media=["https://cdn.test/rav4.jpg"])

    assert outcome.status == "sent" and outcome.provider_id == "SM42"
    [request] = crm.requests
    assert str(request.url) == "http://crm.test/api/internal/ai/messages/send"
    assert request.headers["Authorization"] == "Bearer s3cret"
    body = json.loads(request.content)
    assert body["lead_id"] == created["lead_id"] and body["channel"] == "sms" and body["to"].startswith("+1")
    assert body["media_urls"] == ["https://cdn.test/rav4.jpg"]
    assert body["idempotency_key"] == "t1:sms"


async def test_the_platform_record_carries_the_media(mongo):
    recorded = []

    class Recording(StubPlatformClient):
        async def record_message(self, dealer_id, message):
            recorded.append(message)
            return "rec1"

    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Ann Test", comments="hi")
    sender = Sender(_driver(Crm(_ok())), Recording(), retry_base_s=0)
    await sender.send(SendRequest(dealer_id=DEALER, lead_id=created["lead_id"], customer_id=created["customer_id"],
                                  turn_id="t9", channel="sms", text="x", media_urls=("https://cdn.test/a.jpg",)))
    assert recorded[0]["media_urls"] == ["https://cdn.test/a.jpg"]


async def test_a_stop_reported_by_the_crm_is_suppressed_and_consent_turned_off(mongo):
    crm = Crm(httpx.Response(422, json={"error": "opted out", "retryable": False, "opted_out": True}))
    outcome, created = await _send(_driver(crm))
    assert outcome.status == "suppressed" and len(crm.requests) == 1
    assert await consent.is_opted_out(dealer_scoped_db(DEALER), created["customer_id"], "sms")


async def test_a_permanent_crm_refusal_is_not_retried(mongo):
    crm = Crm(httpx.Response(422, json={"error": "Dealer has no Twilio number", "retryable": False}))
    outcome, _ = await _send(_driver(crm))
    assert outcome.status == "failed" and outcome.attempts == 1 and "no Twilio number" in outcome.reason


@pytest.mark.parametrize("first", [httpx.Response(502, json={"error": "provider down", "retryable": True}),
                                   httpx.Response(500, text="boom"), httpx.ConnectError("refused")])
async def test_crm_outages_are_retried(mongo, first):
    crm = Crm(first, _ok("SM7"))
    outcome, _ = await _send(_driver(crm))
    assert outcome.status == "sent" and outcome.attempts == 2 and outcome.provider_id == "SM7"


async def test_a_wrong_secret_is_permanent(mongo):
    crm = Crm(httpx.Response(401, json={"error": "Unauthorized", "retryable": False}))
    outcome, _ = await _send(_driver(crm))
    assert outcome.status == "failed" and outcome.attempts == 1


async def test_outside_production_a_set_allowlist_is_enforced_before_the_crm(mongo):
    crm = Crm(_ok())
    outcome, _ = await _send(_driver(crm, allowlist={"+15550009999"}))
    assert outcome.status == "suppressed" and crm.requests == []


def test_channel_driver_platform_is_built_from_settings():
    settings = make_settings("DEV").model_copy(update={"channel_driver": "platform",
                                                       "autopulse_api_base_url": "http://localhost:3100"})
    driver = get_channel_driver(settings)
    assert isinstance(driver, PlatformChannelDriver) and driver.name == "platform"


def test_the_platform_driver_needs_the_crm_address_and_secret():
    with pytest.raises(ValueError):
        PlatformChannelDriver(base_url="", shared_secret="x")


# --- The rest of the CRM contract ------------------------------------------------------

async def test_live_client_raises_slot_taken_with_the_crms_free_times(monkeypatch):
    def handler(request):
        return httpx.Response(409, json={"error": "slot_taken", "message": "The 10:00 slot is taken",
                                         "alternatives": ["10:30", "11:00"]})
    monkeypatch.setattr(httpx, "AsyncClient", _patched_client(handler))
    client = LivePlatformClient(make_settings("DEV"))
    with pytest.raises(SlotTakenError) as caught:
        await client.create_booking(DEALER, {"lead_id": "l1", "customerName": "A", "email": None, "phone": "+1",
                                             "bookingDate": "2031-03-03", "bookingTime": "10:00"})
    assert caught.value.alternatives == ["10:30", "11:00"]
    assert isinstance(caught.value, PlatformError)


async def test_live_client_sends_showed_and_dnd(monkeypatch):
    seen = []

    def handler(request):
        seen.append((request.method, request.url.path, json.loads(request.content)))
        return httpx.Response(200, json={"success": True, "updated": True, "booking": {"booking_status": "completed"}})
    monkeypatch.setattr(httpx, "AsyncClient", _patched_client(handler))
    client = LivePlatformClient(make_settings("DEV"))
    await client.update_booking(DEALER, {"booking_id": "b1", "booking_status": "completed", "showed": True})
    assert await client.mark_lead_dnd(DEALER, "l1", "STOP") is True
    assert seen[0][0] == "PUT" and seen[0][2]["showed"] is True
    assert seen[1][1] == "/api/internal/ai/leads/dnd" and seen[1][2] == {"dealer_id": DEALER, "lead_id": "l1",
                                                                         "reason": "STOP"}


async def test_stub_client_marks_dnd_and_showed(mongo):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Dee Test", comments="hi")
    stub = StubPlatformClient()
    assert await stub.mark_lead_dnd(DEALER, created["lead_id"], "STOP") is True
    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": ObjectId(created["lead_id"])})
    assert lead["fe_lead_status"] == "DND" and lead["dnd_source"] == "ai_opt_out"
    booking = await stub.create_booking(DEALER, {"lead_id": created["lead_id"], "customerName": "Dee", "email": None,
                                                 "phone": "+1555", "bookingDate": "2031-03-03", "bookingTime": "10:00",
                                                 "dealer_timezone": "America/New_York"})
    await stub.update_booking(DEALER, {"booking_id": booking["booking_id"], "booking_status": "completed",
                                       "showed": True})
    row = await mongo[PLATFORM_BOOKINGS_COLLECTION].find_one({"_id": ObjectId(booking["booking_id"])})
    assert row["showed"] is True and row["showed_at"] is not None


def _patched_client(handler):
    original = httpx.AsyncClient

    class Patched(original):
        def __init__(self, *a, **kw):
            kw.pop("transport", None)
            super().__init__(*a, transport=httpx.MockTransport(handler), **kw)

    return Patched
