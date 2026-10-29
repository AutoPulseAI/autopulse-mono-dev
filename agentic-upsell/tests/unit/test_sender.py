"""The sender (MASTER_PLAN_1 Stage 4, architecture §9): one send per
idempotency key no matter how often the job runs, consent before every send,
retries only on retryable failures, and every send recorded on the platform."""

from datetime import timedelta

import pytest

from upsell_agent import clock
from upsell_agent.channels.consent import set_channel_consent
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender, SendRequest
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import (
    AI_MESSAGES_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import (
    DEV_PLATFORM_MESSAGES_COLLECTION,
    StubPlatformClient,
)

DEALER = simulate.DEV_DEALERS[0]["_id"]
OTHER = simulate.DEV_DEALERS[1]["_id"]


class BrokenPlatform(StubPlatformClient):
    async def record_message(self, dealer_id, message):
        raise ConnectionError("platform down")


async def _no_sleep(_seconds: float) -> None:
    return None


def _sender(driver=None, platform=None, attempts=3) -> Sender:
    return Sender(driver or FakeChannelDriver(), platform or StubPlatformClient(), max_attempts=attempts,
                  retry_base_s=0.5, sleep=_no_sleep)


async def _lead(channel="sms", **kwargs):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel=channel, name="Maria Lopez",
                                         comments="hi", **kwargs)
    return created


def _request(created, channel="sms", turn="t1", **kwargs) -> SendRequest:
    return SendRequest(dealer_id=DEALER, lead_id=created["lead_id"], customer_id=created["customer_id"],
                       turn_id=turn, channel=channel, text="Hello from the dealer",
                       subject=None if channel == "sms" else "Thanks", **kwargs)


async def test_sends_once_and_records_it_on_the_platform(mongo):
    created = await _lead()
    received = clock.now() - timedelta(milliseconds=250)
    outcome = await _sender().send(_request(created, event_received_at=received))

    assert outcome.status == "sent" and outcome.attempts == 1
    assert outcome.to.startswith("+1555") and outcome.provider_id.startswith("fake-")
    assert outcome.latency_ms is not None and outcome.latency_ms >= 250
    row = await mongo[AI_MESSAGES_COLLECTION].find_one({"idempotency_key": "t1:sms"})
    assert row["status"] == "sent" and row["dealer_id"] == DEALER and row["direction"] == "outbound"
    record = await mongo[DEV_PLATFORM_MESSAGES_COLLECTION].find_one({"idempotency_key": "t1:sms"})
    assert record["status"] == "sent" and record["provider_id"] == outcome.provider_id
    assert row["platform_record_id"] == outcome.platform_record_id == str(record["_id"])


async def test_the_same_send_twice_goes_out_once(mongo):
    created = await _lead()
    driver = FakeChannelDriver()
    sender = _sender(driver)
    first = await sender.send(_request(created))
    second = await sender.send(_request(created))

    assert (first.status, second.status) == ("sent", "duplicate")
    assert driver.calls == 1
    assert await mongo[DEV_OUTBOX_COLLECTION].count_documents({}) == 1
    assert await mongo[DEV_PLATFORM_MESSAGES_COLLECTION].count_documents({}) == 1


async def test_retryable_failures_are_retried(mongo):
    created = await _lead()
    driver = FakeChannelDriver(fail_first=2)
    outcome = await _sender(driver).send(_request(created))
    assert outcome.status == "sent" and outcome.attempts == 3 and driver.calls == 3


async def test_gives_up_after_max_attempts_and_records_the_failure(mongo):
    created = await _lead()
    driver = FakeChannelDriver(fail_first=10)
    outcome = await _sender(driver).send(_request(created))
    assert outcome.status == "failed" and outcome.attempts == 3 and driver.calls == 3
    record = await mongo[DEV_PLATFORM_MESSAGES_COLLECTION].find_one({"idempotency_key": "t1:sms"})
    assert record["status"] == "failed"


async def test_permanent_failures_are_not_retried(mongo):
    created = await _lead()
    driver = FakeChannelDriver(permanent_failure=True)
    outcome = await _sender(driver).send(_request(created))
    assert outcome.status == "failed" and driver.calls == 1


async def test_a_send_that_died_mid_flight_is_never_resent(mongo):
    created = await _lead()
    await dealer_scoped_db(DEALER).collection(AI_MESSAGES_COLLECTION).insert_one(
        {"idempotency_key": "t1:sms", "status": "sending", "direction": "outbound", "lead_id": created["lead_id"]})
    driver = FakeChannelDriver()
    outcome = await _sender(driver).send(_request(created))
    assert outcome.status == "unknown" and driver.calls == 0
    row = await mongo[AI_MESSAGES_COLLECTION].find_one({"idempotency_key": "t1:sms"})
    assert row["status"] == "unknown"


async def test_a_claimed_send_that_never_reached_the_provider_is_resumed(mongo):
    created = await _lead()
    await dealer_scoped_db(DEALER).collection(AI_MESSAGES_COLLECTION).insert_one(
        {"idempotency_key": "t1:sms", "status": "queued", "direction": "outbound", "lead_id": created["lead_id"]})
    outcome = await _sender().send(_request(created))
    assert outcome.status == "sent"
    assert await mongo[AI_MESSAGES_COLLECTION].count_documents({"idempotency_key": "t1:sms"}) == 1


async def test_opted_out_channel_is_suppressed(mongo):
    created = await _lead()
    await set_channel_consent(dealer_scoped_db(DEALER), created["customer_id"], "sms", False, source="test")
    driver = FakeChannelDriver()
    outcome = await _sender(driver).send(_request(created, purpose="marketing", is_reply=False))
    assert outcome.status == "suppressed" and "opted out" in outcome.reason and driver.calls == 0
    assert await mongo[DEV_PLATFORM_MESSAGES_COLLECTION].count_documents({}) == 0


async def test_phone_marked_sms_opt_in_false_blocks_marketing_texts_not_replies(mongo):
    # An explicit no stops texts the business starts; a reply to the customer
    # still goes out (MASTER_PLAN_3 B0.4 step 1, architecture decision 36).
    created = await _lead()
    await mongo["customers"].update_one({}, {"$set": {"phones.0.sms_opt_in": False}})
    await mongo["leads"].update_one({}, {"$set": {"phone": None}})
    followup = await _sender().send(_request(created, turn="t-followup", purpose="marketing", is_reply=False))
    assert followup.status == "suppressed" and "sms_opt_in" in followup.reason
    assert followup.compliance["outcome"] == "BLOCK" and followup.compliance["rule"] == "explicit_no"
    reply = await _sender().send(_request(created, turn="t-reply"))
    assert reply.status == "sent"


async def test_no_contact_on_file_is_suppressed(mongo):
    created = await _lead()
    await mongo["leads"].update_one({}, {"$set": {"email": None}})
    await mongo["customers"].update_one({}, {"$set": {"emails": []}})
    outcome = await _sender().send(_request(created, channel="email"))
    assert outcome.status == "suppressed" and outcome.reason == "no email contact on file"


async def test_email_goes_to_the_leads_own_address(mongo):
    created = await _lead(channel="email")
    await mongo["leads"].update_one({}, {"$set": {"email": "lead-form@example.test"}})
    outcome = await _sender().send(_request(created, channel="email"))
    assert outcome.status == "sent" and outcome.to == "lead-form@example.test"
    outbox = await mongo[DEV_OUTBOX_COLLECTION].find_one({})
    assert outbox["subject"] == "Thanks"


async def test_shadow_mode_drafts_without_sending_or_recording(mongo):
    created = await _lead()
    driver = FakeChannelDriver()
    outcome = await _sender(driver).send(_request(created, shadow=True))
    assert outcome.status == "shadow" and driver.calls == 0
    assert await mongo[DEV_PLATFORM_MESSAGES_COLLECTION].count_documents({}) == 0


async def test_platform_recording_failure_never_undoes_a_send(mongo):
    created = await _lead()
    outcome = await _sender(platform=BrokenPlatform()).send(_request(created))
    assert outcome.status == "sent" and outcome.platform_record_id is None
    row = await mongo[AI_MESSAGES_COLLECTION].find_one({"idempotency_key": "t1:sms"})
    assert "platform down" in row["platform_record_error"]


async def test_cannot_message_another_dealers_customer(mongo):
    created = await _lead()  # belongs to DEALER
    request = _request(created)
    request.dealer_id = OTHER
    driver = FakeChannelDriver()
    outcome = await _sender(driver).send(request)
    assert outcome.status == "suppressed" and driver.calls == 0
    row = await mongo[AI_MESSAGES_COLLECTION].find_one({"idempotency_key": "t1:sms"})
    assert row["dealer_id"] == OTHER


@pytest.mark.parametrize(("channel", "fallback", "key"), [("sms", False, "t1:sms"), ("email", False, "t1:email"),
                                                           ("email", True, "t1:email:fallback")])
def test_idempotency_key(channel, fallback, key):
    request = SendRequest(dealer_id="d", lead_id="l", customer_id="c", turn_id="t1", channel=channel, text="x",
                          is_fallback=fallback)
    assert request.idempotency_key == key


async def test_customer_phone_is_texted_in_e164(mongo):
    """The platform stores Customer phones as bare 10 digits; Twilio and the
    platform's reply threading both need E.164."""
    created = await _lead()
    await mongo["leads"].update_one({}, {"$set": {"phone": None}})
    customer = await mongo["customers"].find_one({})
    assert customer["phones"][0]["value"].startswith("555") and len(customer["phones"][0]["value"]) == 10
    outcome = await _sender().send(_request(created))
    assert outcome.status == "sent" and outcome.to == "+1" + customer["phones"][0]["value"]


async def test_a_reply_still_goes_on_an_opted_out_channel(mongo):
    # Decision 136: a reply to the customer's own message is customer service, not marketing.
    created = await _lead()
    await set_channel_consent(dealer_scoped_db(DEALER), created["customer_id"], "sms", False, source="test")
    driver = FakeChannelDriver()
    outcome = await _sender(driver).send(_request(created, purpose="reply", is_reply=True))
    assert outcome.status == "sent" and driver.calls == 1


class TimeoutDriver(FakeChannelDriver):
    """The CRM sent the message but didn't answer in time (26 Oct 2026: 63 morning messages)."""

    async def send(self, message):
        from upsell_agent.channels.base import ChannelSendError
        self.calls += 1
        raise ChannelSendError("CRM unreachable: ReadTimeout('')", retryable=True)


async def test_a_crm_timeout_whose_message_went_out_is_sent_not_failed_and_not_resent(mongo):
    created = await _lead()
    await mongo["emails"].insert_one({"ai_idempotency_key": "t1:sms", "status": "delivered", "message_id": "SM123"})
    driver = TimeoutDriver()
    outcome = await _sender(driver).send(_request(created))
    assert outcome.status == "sent" and driver.calls == 1
    row = await mongo[AI_MESSAGES_COLLECTION].find_one({"idempotency_key": "t1:sms"})
    assert row["status"] == "sent" and row["provider_id"] == "SM123" and row["confirmed_after_timeout"] is True


async def test_a_crm_timeout_with_no_record_is_a_failure_and_still_not_resent(mongo):
    created = await _lead()
    driver = TimeoutDriver()
    outcome = await _sender(driver).send(_request(created))
    assert outcome.status == "failed" and driver.calls == 1


async def test_every_message_goes_in_the_customers_language(mongo, monkeypatch):
    """28 Oct 2026 meeting (Deyvi Lopez switched to Spanish, booked in Spanish, then the appointment check "I am looking
    for you in the showroom" went out in English): the sender puts every message in the customer's language."""
    from dataclasses import replace
    from upsell_agent.agent import reply_language
    from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION, DEV_OUTBOX_COLLECTION

    async def fake(text, language, model_name, **_):
        return (f"[{language}] {text}", {"translated": True}) if reply_language.needs_translation(text, language) \
            else (text, None)
    monkeypatch.setattr(reply_language, "in_customer_language", fake)
    created = await _lead()
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]},
                                                     {"$set": {"customer_language": "Spanish", "dealer_id": DEALER}},
                                                     upsert=True)
    showroom = "Hello, this is Nicole with Victory Cars Central. I am looking for you in the showroom - are you here?"
    out = await _sender().send(replace(_request(created), text=showroom))
    assert out.status == "sent"
    sent = await mongo[DEV_OUTBOX_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert sent["text"] == f"[Spanish] {showroom}"
    # Already in their language: left as it is.
    await _sender().send(replace(_request(created, turn="t2"), text="¿Estás en la sala de exposición?"))
    assert await mongo[DEV_OUTBOX_COLLECTION].count_documents({"text": "¿Estás en la sala de exposición?"}) == 1
