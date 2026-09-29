"""The 24-hour channel switch (MASTER_PLAN_1 Stage 10, architecture §6):
scheduling after a send, firing when due, cancelling on a reply, the two-worker
race, stuck claims, delivery callbacks and the provider webhooks. The clock is
moved; nothing waits."""

import asyncio
import base64
import contextlib
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import pytest
from bson import ObjectId
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent.turn import TurnDeps, run_turn
from upsell_agent.api.leads import lead_profile
from upsell_agent.api.webhooks import twilio_signature
from upsell_agent.channels import consent
from upsell_agent.channels.delivery import apply_delivery_status, apply_unsubscribe
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events.handlers import handle_inbound_message, handle_lead_paused
from upsell_agent.events.models import InboundMessageEvent, LeadPausedEvent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import (
    DEV_PLATFORM_MESSAGES_COLLECTION,
    StubPlatformClient,
)
from upsell_agent.main import create_app
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.scheduler import followups
from upsell_agent.worker.locks import Busy

DEALER = simulate.DEV_DEALERS[0]["_id"]
# The send check needs the customer's zone; dev customers have none (conftest.py).
pytestmark = pytest.mark.usefixtures("ny_customer")
DAY = timedelta(hours=24)
# A Tuesday, 10:00 in New York: well inside the 8:00-20:00 SMS contact window
# and business hours, and 24h later still is (architecture §15, decision 11).
START = datetime(2026, 9, 22, 14, 0, tzinfo=UTC)
_start_offset = 0.0


@pytest.fixture(autouse=True)
def daytime_start():
    global _start_offset
    set_clock(START)
    _start_offset = clock.offset_s()


def _since_start(seconds: float) -> None:
    """Move the clock to `seconds` after the test's start."""
    clock.set_offset(_start_offset + seconds)


@pytest.fixture
async def live_dealer(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one(
        {"_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True}})


def _deps(driver=None):
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(driver or FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(channel="sms", comments="Hi, I want a new Toyota RAV4"):
    return await simulate.create_lead(DEALER, lead_type="sales", channel=channel, name="Maria Test",
                                      comments=comments)


async def _first_reply(created, *, channel="sms", deps=None, shadow=False):
    return await run_turn(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                          trigger="lead_created", channel=channel, inbound_text="Hi, I want a new Toyota RAV4",
                          shadow=shadow, deps=deps or _deps())


async def _followups(mongo, created):
    return await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)


async def _outbox(mongo, created, channel=None):
    flt = {"lead_id": created["lead_id"], **({"channel": channel} if channel else {})}
    return await mongo[DEV_OUTBOX_COLLECTION].find(flt).to_list(None)


async def _reply(created, text="Budget is about $30k", channel="sms"):
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel=channel,
                                text=text, received_at=clock.now())
    return await handle_inbound_message(event, _deps())


def _node(log, name):
    return next(n for n in log["nodes"] if n["node"] == name and n["status"] == "done")


# --- Schedule --------------------------------------------------------------------

async def test_a_sent_sms_schedules_the_email_version_for_24h_later(mongo, live_dealer):
    created = await _lead()
    log = await _first_reply(created)

    [doc] = await _followups(mongo, created)
    assert doc["status"] == "pending" and doc["from_channel"] == "sms" and doc["to_channel"] == "email"
    assert doc["to"].endswith("@example.test") and doc["subject"] and doc["text"].startswith("Hi Maria,")
    assert doc["source_turn_id"] == log["turn_id"] and doc["source_provider_id"].startswith("fake-")
    due = doc["due_at"].replace(tzinfo=clock.now().tzinfo)
    assert abs((due - clock.now()) - DAY) < timedelta(seconds=5)
    schedule = _node(log, "schedule")
    assert schedule["output"]["created"] and "in 24h" in schedule["reasoning"][0]
    profile = await lead_profile(DEALER, created["lead_id"])
    assert profile["pending_followup"]["channel"] == "email"


async def test_no_followup_without_a_contact_on_the_other_channel(mongo, live_dealer):
    created = await _lead()
    await mongo[PLATFORM_CUSTOMERS_COLLECTION].update_one({"_id": ObjectId(created["customer_id"])},
                                                          {"$set": {"emails": []}})
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(created["lead_id"])},
                                                      {"$set": {"data.email": None, "email": None}})
    log = await _first_reply(created)
    assert await _followups(mongo, created) == []
    assert _node(log, "schedule")["output"] == {"created": False, "reason": "no email contact on file"}


async def test_no_followup_when_opted_out_of_the_other_channel(mongo, live_dealer):
    created = await _lead()
    await consent.set_channel_consent(dealer_scoped_db(DEALER), created["customer_id"], "email", False, source="test")
    log = await _first_reply(created)
    assert await _followups(mongo, created) == []
    assert "opted out" in _node(log, "schedule")["output"]["reason"]


async def test_shadow_mode_schedules_nothing(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created, shadow=True)
    assert await _followups(mongo, created) == []


async def test_a_newer_message_supersedes_the_pending_followup(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    await run_turn(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                   trigger="inbound_message", channel="sms", inbound_text="my budget is $30k", shadow=False,
                   deps=_deps())
    docs = sorted(await _followups(mongo, created), key=lambda d: d["created_at"])
    assert [d["status"] for d in docs] == ["superseded", "pending"]


async def test_a_permanent_send_failure_makes_the_followup_due_now(mongo, live_dealer):
    created = await _lead()
    log = await _first_reply(created, deps=_deps(FakeChannelDriver(permanent_failure=True)))
    assert log["summary"]["send_status"] == "failed"
    [doc] = await _followups(mongo, created)
    assert doc["due_at"].replace(tzinfo=clock.now().tzinfo) <= clock.now()
    assert "send failed" in doc["reason"]


# --- Fire ------------------------------------------------------------------------

async def test_nothing_fires_before_it_is_due(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    _since_start((DAY - timedelta(minutes=1)).total_seconds())
    assert (await followups.fire_due(_deps()))["fired"] == 0
    assert (await _followups(mongo, created))[0]["status"] == "pending"


async def test_after_24h_the_email_version_goes_out_once(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    [scheduled] = await _followups(mongo, created)
    _since_start(DAY.total_seconds() + 60)

    summary = await followups.fire_due(_deps())
    assert summary["results"] == {"sent": 1}
    [email] = await _outbox(mongo, created, "email")
    assert email["text"] == scheduled["text"] and email["subject"] == scheduled["subject"]
    assert email["idempotency_key"].endswith(":email:fallback")
    [doc] = await _followups(mongo, created)
    assert doc["status"] == "sent" and doc["sent_message_id"]

    row = await mongo[AI_MESSAGES_COLLECTION].find_one({"idempotency_key": email["idempotency_key"]})
    assert row["is_fallback"] is True and row["status"] == "sent"
    turn = await mongo[AI_TURN_LOG_COLLECTION].find_one({"trigger": "followup"})
    assert turn["outcome"] == "followup_sent"
    assert [n["node"] for n in turn["nodes"] if n["status"] == "done"] == ["followup", "send"]
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["last_followup_at"] and state["last_send_status"] == "sent"

    # Never a second switch: nothing new is scheduled or sent.
    _since_start(3 * DAY.total_seconds())
    assert (await followups.fire_due(_deps()))["fired"] == 0
    assert len(await _followups(mongo, created)) == 1
    assert len(await _outbox(mongo, created)) == 2


async def test_an_email_lead_switches_to_sms(mongo, live_dealer):
    created = await _lead(channel="email")
    await _first_reply(created, channel="email")
    [doc] = await _followups(mongo, created)
    assert doc["to_channel"] == "sms" and doc["subject"] is None and len(doc["text"]) <= 320
    _since_start(DAY.total_seconds() + 60)
    await followups.fire_due(_deps())
    [sms] = await _outbox(mongo, created, "sms")
    assert sms["to"].startswith("+1")


async def test_a_reply_cancels_the_pending_followup(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    result = await _reply(created)
    assert result["followups_cancelled"] == 1
    statuses = sorted(d["status"] for d in await _followups(mongo, created))
    # The reply's own turn scheduled a fresh one for its answer.
    assert statuses == ["cancelled", "pending"]


async def test_a_reply_one_second_before_due_still_cancels(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    await handle_lead_paused(LeadPausedEvent(event_id="p1", dealer_id=DEALER, lead_id=created["lead_id"]))
    [doc] = await _followups(mongo, created)
    assert doc["status"] == "cancelled"  # paused cancels too; set it back to test the reply path alone
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].update_one({"_id": doc["_id"]}, {"$set": {"status": "pending"}})
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]}, {"$set": {"status": "active"}})

    _since_start(DAY.total_seconds() - 1)
    await _reply(created, text="thanks, will call you")
    _since_start(DAY.total_seconds() + 1)
    await followups.fire_due(_deps())
    assert await _outbox(mongo, created, "email") == []


async def test_a_reply_that_lands_after_the_claim_cancels_it_at_the_recheck(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    _since_start(DAY.total_seconds() + 60)
    doc = await followups.claim_next("w1")
    # The customer's reply was recorded between the claim and the send.
    await mongo[AI_MESSAGES_COLLECTION].insert_one(
        {"dealer_id": DEALER, "lead_id": created["lead_id"], "direction": "inbound", "channel": "sms",
         "text": "yes", "created_at": clock.now()})
    assert await followups.fire_one(doc, _deps()) == "cancelled"
    [row] = await _followups(mongo, created)
    assert row["status"] == "cancelled" and "replied" in row["reason"]
    assert await _outbox(mongo, created, "email") == []


@pytest.mark.parametrize(("setup", "reason"), [
    ("paused", "lead is paused"),
    ("shadow", "dealer AI mode is shadow"),
    ("off", "dealer AI mode is off"),
    ("no_dealer", "dealer AI mode is off"),
])
async def test_rechecks_cancel_instead_of_sending(mongo, live_dealer, setup, reason):
    created = await _lead()
    await _first_reply(created)
    users = mongo[PLATFORM_USERS_COLLECTION]
    if setup == "paused":
        await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]},
                                                         {"$set": {"status": "paused"}})
    elif setup == "no_dealer":
        await users.delete_one({"_id": ObjectId(DEALER)})
    else:
        await users.update_one({"_id": ObjectId(DEALER)}, {"$set": {"ai_mode": setup}})
    _since_start(DAY.total_seconds() + 60)
    assert (await followups.fire_due(_deps()))["results"] == {"cancelled": 1}
    [doc] = await _followups(mongo, created)
    assert doc["status"] == "cancelled" and doc["reason"].startswith(reason)
    assert await _outbox(mongo, created, "email") == []


async def test_auto_reply_off_counts_as_off(mongo, live_dealer):
    await mongo[PLATFORM_USERS_COLLECTION].update_one({"_id": ObjectId(DEALER)},
                                                      {"$set": {"setting.autoReplyEnabled": False}})
    created = await _lead()
    await _first_reply(created)
    _since_start(DAY.total_seconds() + 60)
    assert (await followups.fire_due(_deps()))["results"] == {"cancelled": 1}


async def test_two_workers_racing_send_exactly_once(mongo, live_dealer):
    leads = [await _lead() for _ in range(3)]
    for created in leads:
        await _first_reply(created)
    _since_start(DAY.total_seconds() + 60)

    first, second = await asyncio.gather(
        followups.fire_due(_deps(), claimed_by="worker-1"), followups.fire_due(_deps(), claimed_by="worker-2"))
    assert first["fired"] + second["fired"] == 3
    for created in leads:
        assert len(await _outbox(mongo, created, "email")) == 1
        assert [d["status"] for d in await _followups(mongo, created)] == ["sent"]


async def test_a_busy_lead_puts_the_followup_back_for_shortly_after(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    _since_start(DAY.total_seconds() + 60)

    @contextlib.asynccontextmanager
    async def busy(_dealer_id, _lead_id):
        raise Busy("a turn is running")
        yield

    assert (await followups.fire_due(_deps(), lock=busy))["results"] == {"busy": 1}
    [doc] = await _followups(mongo, created)
    assert doc["status"] == "pending"
    assert doc["due_at"].replace(tzinfo=clock.now().tzinfo) > clock.now()
    clock.set_offset(clock.offset_s() + 31)
    assert (await followups.fire_due(_deps()))["results"] == {"sent": 1}


async def test_a_stuck_claim_is_reset_and_sent_once(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    _since_start(DAY.total_seconds() + 60)
    await followups.claim_next("dead-worker")  # the worker died right after claiming

    assert (await followups.fire_due(_deps()))["fired"] == 0  # younger than 5 minutes: left alone
    clock.set_offset(clock.offset_s() + 6 * 60)
    summary = await followups.fire_due(_deps())
    assert summary["reset"] == 1 and summary["results"] == {"sent": 1}
    assert len(await _outbox(mongo, created, "email")) == 1


async def test_a_crash_mid_send_is_never_sent_twice(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    _since_start(DAY.total_seconds() + 60)
    doc = await followups.claim_next("dead-worker")
    # The dead worker had reached the provider: its row is stuck in `sending`.
    await dealer_scoped_db(DEALER).collection(AI_MESSAGES_COLLECTION).insert_one(
        {"idempotency_key": f"{doc['source_turn_id']}:email:fallback", "direction": "outbound",
         "status": "sending", "lead_id": created["lead_id"], "channel": "email", "created_at": clock.now()})
    clock.set_offset(clock.offset_s() + 6 * 60)

    summary = await followups.fire_due(_deps())
    assert summary["results"] == {"unknown": 1}
    assert await _outbox(mongo, created, "email") == []
    assert (await _followups(mongo, created))[0]["status"] == "unknown"


# --- Delivery callbacks --------------------------------------------------------------

async def _sent_sms(mongo, created):
    return await mongo[AI_MESSAGES_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "direction": "outbound", "channel": "sms"})


async def test_an_undelivered_sms_makes_its_followup_fire_now(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    sms = await _sent_sms(mongo, created)

    result = await apply_delivery_status(StubPlatformClient(), "undelivered", provider_id=sms["provider_id"],
                                         error="Twilio error 30003")
    assert result.applied and result.followup_due_now
    assert (await _sent_sms(mongo, created))["delivery_status"] == "undelivered"
    platform_copy = await mongo[DEV_PLATFORM_MESSAGES_COLLECTION].find_one({"provider_id": sms["provider_id"]})
    assert platform_copy["delivery_status"] == "undelivered"

    assert (await followups.fire_due(_deps()))["results"] == {"sent": 1}  # no clock move needed
    assert len(await _outbox(mongo, created, "email")) == 1


async def test_a_late_callback_never_moves_status_backwards(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    sms = await _sent_sms(mongo, created)
    await apply_delivery_status(StubPlatformClient(), "delivered", provider_id=sms["provider_id"])
    stale = await apply_delivery_status(StubPlatformClient(), "sent", provider_id=sms["provider_id"])
    assert not stale.applied and "stale" in stale.detail
    assert (await _sent_sms(mongo, created))["delivery_status"] == "delivered"


async def test_a_failed_followup_never_triggers_another(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    _since_start(DAY.total_seconds() + 60)
    await followups.fire_due(_deps())
    email = await mongo[AI_MESSAGES_COLLECTION].find_one({"lead_id": created["lead_id"], "is_fallback": True})
    result = await apply_delivery_status(StubPlatformClient(), "bounced", provider_id=email["provider_id"])
    assert result.applied and not result.followup_due_now


async def test_an_unsubscribe_turns_email_off_and_the_switch_is_suppressed(mongo, live_dealer):
    created = await _lead(channel="email")
    await _first_reply(created, channel="email")
    email = await mongo[AI_MESSAGES_COLLECTION].find_one({"lead_id": created["lead_id"], "direction": "outbound"})
    result = await apply_unsubscribe(provider_id=email["provider_id"], source="sendgrid_unsubscribe")
    assert result.consent_off
    assert await consent.is_opted_out(dealer_scoped_db(DEALER), created["customer_id"], "email")


async def test_unknown_provider_id_is_ignored(mongo):
    result = await apply_delivery_status(StubPlatformClient(), "delivered", provider_id="SMnope")
    assert not result.found


# --- Webhooks ---------------------------------------------------------------------------

class FakeEnqueue:
    def __init__(self):
        self.calls = []

    async def __call__(self, function, *, key, **kwargs):
        self.calls.append(function)
        return key


def _client(**settings):
    app = create_app(make_settings("PROD").model_copy(update=settings), connect=False)
    app.state.enqueue = FakeEnqueue()
    return TestClient(app)


def _twilio_post(client, params, token="twilio-token", signature=None):
    url = "http://testserver/v1/webhooks/twilio/status"
    sig = signature if signature is not None else twilio_signature(token, url, params)
    return client.post("/v1/webhooks/twilio/status", content=urlencode(params),
                       headers={"X-Twilio-Signature": sig, "Content-Type": "application/x-www-form-urlencoded"})


async def test_twilio_callback_with_a_good_signature_updates_status_and_queues_the_switch(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    sms = await _sent_sms(mongo, created)
    params = {"MessageSid": sms["provider_id"], "MessageStatus": "failed", "ErrorCode": "30006"}
    with _client(twilio_auth_token="twilio-token") as client:
        response = await asyncio.to_thread(_twilio_post, client, params)
        assert response.status_code == 204
        assert client.app.state.enqueue.calls == ["fire_due_followups"]
    row = await _sent_sms(mongo, created)
    assert row["delivery_status"] == "failed" and "30006" in row["delivery_error"]


def test_twilio_callback_rejects_bad_or_missing_signatures(mongo):
    params = {"MessageSid": "SM1", "MessageStatus": "delivered"}
    with _client(twilio_auth_token="twilio-token") as client:
        assert _twilio_post(client, params, signature="forged").status_code == 401
        assert _twilio_post(client, params, token="other-token").status_code == 401
    with _client() as client:  # no token configured: nothing is accepted
        assert _twilio_post(client, params).status_code == 401


def test_twilio_signature_matches_twilios_own_validator():
    # Twilio's docs example; the expected value was checked against
    # twilio.request_validator.RequestValidator.compute_signature.
    url = "https://mycompany.com/myapp.php?foo=1&bar=2"
    params = {"CallSid": "CA1234567890ABCDE", "Caller": "+12349013030", "Digits": "1234",
              "From": "+12349013030", "To": "+18005551212"}
    assert twilio_signature("12345", url, params) == "0/KCTR6DLpKmkAf8muzZqo1nDgQ="


def _sendgrid_keys():
    private = ec.generate_private_key(ec.SECP256R1())
    public_der = private.public_key().public_bytes(serialization.Encoding.DER,
                                                   serialization.PublicFormat.SubjectPublicKeyInfo)
    return private, base64.b64encode(public_der).decode()


def _sendgrid_post(client, private, events, timestamp="1700000000"):
    body = json.dumps(events).encode()
    signature = base64.b64encode(private.sign(timestamp.encode() + body, ec.ECDSA(hashes.SHA256()))).decode()
    return client.post("/v1/webhooks/sendgrid/events", content=body, headers={
        "Content-Type": "application/json", "X-Twilio-Email-Event-Webhook-Signature": signature,
        "X-Twilio-Email-Event-Webhook-Timestamp": timestamp})


async def test_sendgrid_events_bounce_and_unsubscribe(mongo, live_dealer):
    created = await _lead(channel="email")
    await _first_reply(created, channel="email")
    email = await mongo[AI_MESSAGES_COLLECTION].find_one({"lead_id": created["lead_id"], "direction": "outbound"})
    private, public = _sendgrid_keys()
    events = [
        {"event": "bounce", "sg_message_id": f"{email['provider_id']}.filterdrecv-1", "reason": "550 no such user"},
        {"event": "unsubscribe", "sg_message_id": "unknown", "ai_idempotency_key": email["idempotency_key"]},
        {"event": "deferred", "sg_message_id": f"{email['provider_id']}.x"},
    ]
    with _client(sendgrid_webhook_public_key=public) as client:
        response = await asyncio.to_thread(_sendgrid_post, client, private, events)
        assert response.status_code == 200 and response.json() == {"received": 3, "applied": 2}
        assert client.app.state.enqueue.calls == ["fire_due_followups"]  # the SMS switch is due now
    row = await mongo[AI_MESSAGES_COLLECTION].find_one({"_id": email["_id"]})
    assert row["delivery_status"] == "bounced" and "550" in row["delivery_error"]
    assert await consent.is_opted_out(dealer_scoped_db(DEALER), created["customer_id"], "email")


def test_sendgrid_rejects_a_bad_signature(mongo):
    private, public = _sendgrid_keys()
    other_private, _ = _sendgrid_keys()
    with _client(sendgrid_webhook_public_key=public) as client:
        assert _sendgrid_post(client, other_private, [{"event": "delivered"}]).status_code == 401
        body = json.dumps([{"event": "delivered"}])
        assert client.post("/v1/webhooks/sendgrid/events", content=body).status_code == 401
    with _client() as client:
        assert _sendgrid_post(client, private, [{"event": "delivered"}]).status_code == 401


async def test_a_campaigns_worth_of_due_followups_drains_concurrently_and_once_each(mongo, live_dealer):
    # 24h after a campaign, its replies' follow-ups all fall due together
    # (Stage 12 burst finding): fired `concurrency` at a time, each exactly once.
    leads = [await _lead() for _ in range(25)]
    for created in leads:
        await _first_reply(created)
    _since_start(DAY.total_seconds() + 60)

    in_flight = {"now": 0, "peak": 0}
    driver = FakeChannelDriver()
    original = driver.send

    async def slow_send(message):
        in_flight["now"] += 1
        in_flight["peak"] = max(in_flight["peak"], in_flight["now"])
        await asyncio.sleep(0.02)
        in_flight["now"] -= 1
        return await original(message)

    driver.send = slow_send
    summary = await followups.fire_due(_deps(driver), concurrency=5)
    assert summary["results"] == {"sent": 25}
    assert 1 < in_flight["peak"] <= 5
    for created in leads:
        assert len(await _outbox(mongo, created, "email")) == 1
