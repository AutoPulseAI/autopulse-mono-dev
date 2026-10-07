"""Live Twilio and SendGrid drivers (MASTER_PLAN_1 Stage 12) against mocked
provider APIs: the exact request each one sends, how every kind of failure is
classified, and the non-production allowlist. Goes through the real sender,
so retries, suppression and consent are exercised too."""

import base64
import json
from urllib.parse import parse_qs

import httpx
import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings
from upsell_agent.channels import consent, dealer_identity, get_channel_driver
from upsell_agent.channels.base import OutboundMessage
from upsell_agent.channels.live import LiveChannelDriver
from upsell_agent.channels.sender import Sender, SendRequest
from upsell_agent.channels.sendgrid import SendGridEmailDriver
from upsell_agent.channels.twilio import TwilioSmsDriver
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import (
    AI_MESSAGES_COLLECTION,
    PLATFORM_EMAIL_ACCOUNTS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import StubPlatformClient

DEALER = simulate.DEV_DEALERS[0]["_id"]
DEALER_SMS = "+15550000001"
MAILBOX = "sales@sunrise.test"


@pytest.fixture
async def dealer(mongo):
    dealer_identity.clear_cache()
    await mongo[PLATFORM_USERS_COLLECTION].insert_one({
        "_id": ObjectId(DEALER), "name": "Sunrise Motors", "type": "dealer", "ai_mode": "live",
        "dealer_account_information": {"sms_conversion_phone": DEALER_SMS}})
    await mongo[PLATFORM_EMAIL_ACCOUNTS_COLLECTION].insert_one(
        {"dealer_id": ObjectId(DEALER), "email_address": MAILBOX, "active": True})
    yield
    dealer_identity.clear_cache()


class Provider:
    """A scripted provider: answers each request with the next response."""

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


def _twilio(provider: Provider, **kw) -> TwilioSmsDriver:
    return TwilioSmsDriver(account_sid="AC123", auth_token="tok", transport=provider.transport(), **kw)


def _sendgrid(provider: Provider, **kw) -> SendGridEmailDriver:
    return SendGridEmailDriver(api_key="SG.key", transport=provider.transport(), **kw)


def _twilio_ok(sid="SM0001"):
    return httpx.Response(201, json={"sid": sid, "status": "queued"})


def _twilio_error(status, code, message="error"):
    return httpx.Response(status, json={"code": code, "message": message, "status": status})


async def _send(driver, channel="sms", turn_id="t1"):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel=channel, name="Maria Test", comments="hi")
    sender = Sender(driver, StubPlatformClient(), retry_base_s=0)
    outcome = await sender.send(SendRequest(
        dealer_id=DEALER, lead_id=created["lead_id"], customer_id=created["customer_id"], turn_id=turn_id,
        channel=channel, text="Hi Maria,\n\nWhat budget do you have in mind?", subject="Your RAV4 inquiry"))
    return outcome, created


# --- Twilio -----------------------------------------------------------------------

async def test_twilio_sends_from_the_dealer_number_with_a_status_callback(dealer):
    provider = Provider(_twilio_ok("SM42"))
    driver = _twilio(provider, status_callback="https://ai.example/v1/webhooks/twilio/status")
    outcome, _ = await _send(driver)

    assert outcome.status == "sent" and outcome.provider_id == "SM42"
    [request] = provider.requests
    assert str(request.url) == "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json"
    assert request.headers["Authorization"] == "Basic " + base64.b64encode(b"AC123:tok").decode()
    form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
    assert form["From"] == DEALER_SMS and form["To"].startswith("+1") and "budget" in form["Body"]
    assert form["StatusCallback"] == "https://ai.example/v1/webhooks/twilio/status"


async def test_twilio_unsubscribed_recipient_is_suppressed_and_consent_turned_off(dealer):
    provider = Provider(_twilio_error(400, 21610, "Attempt to send to unsubscribed recipient"))
    outcome, created = await _send(_twilio(provider))
    assert outcome.status == "suppressed" and "21610" in outcome.reason
    assert len(provider.requests) == 1
    assert await consent.is_opted_out(dealer_scoped_db(DEALER), created["customer_id"], "sms")


async def test_twilio_invalid_number_is_permanent(dealer):
    provider = Provider(_twilio_error(400, 21211, "Invalid 'To' Phone Number"))
    outcome, _ = await _send(_twilio(provider))
    assert outcome.status == "failed" and outcome.attempts == 1 and "21211" in outcome.reason


@pytest.mark.parametrize("first", [httpx.Response(503, json={}), httpx.Response(429, json={"code": 20429}),
                                   httpx.ConnectTimeout("timed out")])
async def test_twilio_outage_and_rate_limits_are_retried(dealer, first):
    provider = Provider(first, _twilio_ok("SM7"))
    outcome, _ = await _send(_twilio(provider))
    assert outcome.status == "sent" and outcome.attempts == 2 and outcome.provider_id == "SM7"


async def test_twilio_gives_up_after_three_attempts(dealer):
    provider = Provider(httpx.Response(500, json={}))
    outcome, _ = await _send(_twilio(provider))
    assert outcome.status == "failed" and outcome.attempts == 3 and len(provider.requests) == 3


async def test_a_dealer_without_a_twilio_number_cannot_send_sms(mongo):
    dealer_identity.clear_cache()
    provider = Provider(_twilio_ok())
    outcome, _ = await _send(_twilio(provider))
    assert outcome.status == "failed" and "no Twilio number" in outcome.reason
    assert provider.requests == []


# --- SendGrid ------------------------------------------------------------------------

async def test_sendgrid_sends_from_the_dealer_mailbox_with_reply_to_and_the_idempotency_key(dealer):
    provider = Provider(httpx.Response(202, headers={"X-Message-Id": "sg-abc"}))
    outcome, _ = await _send(_sendgrid(provider), channel="email")

    assert outcome.status == "sent" and outcome.provider_id == "sg-abc"
    [request] = provider.requests
    assert str(request.url) == "https://api.sendgrid.com/v3/mail/send"
    assert request.headers["Authorization"] == "Bearer SG.key"
    body = json.loads(request.content)
    assert body["from"] == {"email": MAILBOX, "name": "Sunrise Motors"}
    assert body["reply_to"] == {"email": MAILBOX}
    assert body["subject"] == "Your RAV4 inquiry"
    assert body["personalizations"][0]["to"][0]["email"].endswith("@example.test")
    assert body["personalizations"][0]["custom_args"] == {"ai_idempotency_key": "t1:email", "dealer_id": DEALER}
    assert body["content"][0] == {"type": "text/plain", "value": "Hi Maria,\n\nWhat budget do you have in mind?"}
    assert body["content"][1]["value"] == "<p>Hi Maria,</p><p>What budget do you have in mind?</p>"


async def test_sendgrid_from_override_keeps_reply_to_on_the_dealer_mailbox(dealer):
    provider = Provider(httpx.Response(202, headers={"X-Message-Id": "sg-1"}))
    await _send(_sendgrid(provider, from_email="ai@autopulse.example"), channel="email")
    body = json.loads(provider.requests[0].content)
    assert body["from"]["email"] == "ai@autopulse.example" and body["reply_to"] == {"email": MAILBOX}


async def test_sendgrid_bad_request_is_permanent_and_outage_retried(dealer):
    bad = Provider(httpx.Response(400, json={"errors": [{"message": "Invalid to email"}]}))
    outcome, _ = await _send(_sendgrid(bad), channel="email")
    assert outcome.status == "failed" and outcome.attempts == 1 and "Invalid to email" in outcome.reason

    flaky = Provider(httpx.Response(502, json={}), httpx.Response(202, headers={"X-Message-Id": "sg-2"}))
    outcome, _ = await _send(_sendgrid(flaky), channel="email", turn_id="t2")
    assert outcome.status == "sent" and outcome.attempts == 2


# --- Live driver: routing and the allowlist ---------------------------------------------

async def test_outside_production_only_allowlisted_recipients_are_messaged(dealer, mongo):
    provider = Provider(_twilio_ok())
    driver = LiveChannelDriver(sms=_twilio(provider), email=_sendgrid(Provider(_twilio_ok())),
                               allowlist={"+15559990000"})
    outcome, _ = await _send(driver)
    assert outcome.status == "suppressed" and "SEND_ALLOWLIST" in outcome.reason
    assert provider.requests == []  # the provider was never called
    row = await mongo[AI_MESSAGES_COLLECTION].find_one({"idempotency_key": "t1:sms"})
    assert row["status"] == "suppressed"


async def test_an_allowlisted_recipient_goes_through_whatever_the_spacing_or_case(dealer):
    sms, email = Provider(_twilio_ok("SM9")), Provider(httpx.Response(202, headers={"X-Message-Id": "sg-9"}))
    live = LiveChannelDriver(sms=_twilio(sms), email=_sendgrid(email), allowlist={" +15551112222 ", "Tess@Example.test"})
    to_phone = OutboundMessage(dealer_id=DEALER, lead_id="l1", customer_id="c1", channel="sms", to="+15551112222",
                               text="hi")
    to_email = OutboundMessage(dealer_id=DEALER, lead_id="l1", customer_id="c1", channel="email",
                               to="tess@example.TEST", text="hi", subject="s")
    assert (await live.send(to_phone)).provider_id == "SM9"
    assert (await live.send(to_email)).provider_id == "sg-9"


def test_factory_builds_live_drivers_and_fails_fast_without_credentials():
    live = make_settings("STAGING").model_copy(update={
        "channel_driver": "live", "twilio_account_sid": "AC1", "twilio_auth_token": "t", "sendgrid_api_key": "SG.k",
        "send_allowlist": "+15550001111, Tester@Example.test", "public_base_url": "https://ai.example"})
    driver = get_channel_driver(live)
    assert isinstance(driver, LiveChannelDriver)
    assert driver._allowlist == {"+15550001111", "tester@example.test"}
    assert driver._drivers["sms"]._status_callback == "https://ai.example/v1/webhooks/twilio/status"

    production = live.model_copy(update={"environment": "PROD"})
    assert get_channel_driver(production)._allowlist is None

    with pytest.raises(ValueError, match="TWILIO"):
        get_channel_driver(live.model_copy(update={"twilio_auth_token": ""}))
    with pytest.raises(ValueError, match="SENDGRID"):
        get_channel_driver(live.model_copy(update={"sendgrid_api_key": ""}))
