"""MASTER_PLAN_3 C6: bad numbers / wrong people, hard bounces, duplicate leads
and the photo guardrail. New send rules are checked through the real send
path (Sender + can_contact), the same as a live message."""

from datetime import UTC, datetime

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent import media
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels import consent, suppression
from upsell_agent.channels.delivery import apply_delivery_status
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender, SendRequest
from upsell_agent.compliance.engine import can_contact
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent, LeadResumedEvent
from upsell_agent.guardrails.draft_guard import check_draft
from upsell_agent.integrations.mongodb import (
    AI_CONSENT_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.scheduler import followups
from upsell_agent.tools.inventory_tool import to_record

DEALER = simulate.DEV_DEALERS[0]["_id"]
pytestmark = pytest.mark.usefixtures("ny_customer", "legacy_switch")
START = datetime(2026, 9, 22, 14, 0, tzinfo=UTC)  # Tuesday 10:00 in New York


@pytest.fixture(autouse=True)
def daytime_start():
    set_clock(START)


@pytest.fixture
async def live_dealer(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one(
        {"_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True}})


def _deps(driver=None):
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(driver or FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(name="Maria Test", channel="sms", customer_id=None):
    return await simulate.create_lead(DEALER, lead_type="sales", channel=channel, name=name,
                                      comments="Hi, I want a new Toyota RAV4", customer_id=customer_id)


async def _created(created, channel="sms"):
    return await handlers.handle_lead_created(
        LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
                         customer_id=created["customer_id"], channel=channel), _deps())


async def _say(created, text, channel="sms", lead_id=None):
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=lead_id or created["lead_id"], message_id=f"m-{ObjectId()}",
                                channel=channel, text=text, received_at=clock.now())
    return await handlers.handle_inbound_message(event, _deps())


async def _state(mongo, lead_id):
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": lead_id})


async def _send(created, channel, text="Checking in on your RAV4 search."):
    return await Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0).send(SendRequest(
        dealer_id=DEALER, lead_id=created["lead_id"], customer_id=created["customer_id"],
        turn_id=f"t-{ObjectId()}", channel=channel, text=text, subject=None if channel == "sms" else "RAV4",
        purpose="marketing", is_reply=False))


# --- Wrong person / bad number ------------------------------------------------------

@pytest.mark.parametrize("text", [
    "wrong number", "You have the wrong person.", "This isn't Maria's phone", "No one here by that name",
    "Sorry I don't know anyone named that", "not the right number"])
def test_wrong_person_phrases_are_detected(text):
    assert suppression.detect_wrong_person(text)


@pytest.mark.parametrize("text", [
    "Is this the right number to ask about the RAV4?", "what number should I call", "not interested",
    "I have the wrong color in mind, do you have blue?", "STOP"])
def test_ordinary_messages_are_not_wrong_person(text):
    assert suppression.detect_wrong_person(text) is None


async def test_wrong_number_marks_the_phone_and_sends_nothing(mongo, live_dealer):
    created = await _lead()
    await _created(created)
    sent_before = await mongo[DEV_OUTBOX_COLLECTION].count_documents({"lead_id": created["lead_id"]})

    result = await _say(created, "wrong number")
    assert result["status"] == "wrong_number" and result["channels_left"] == ["email"]
    assert not result["suppressed_lead"]
    assert await mongo[DEV_OUTBOX_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == sent_before

    # Never texted again, replies included; email carries on.
    db = dealer_scoped_db(DEALER)
    for is_reply, purpose in ((False, "marketing"), (True, "reply")):
        decision = await can_contact(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                                     channel="sms", purpose=purpose, is_reply=is_reply, record=False)
        assert decision.outcome == "BLOCK"
    assert (await _send(created, "sms")).status == "suppressed"
    assert (await _send(created, "email")).status == "sent"
    entry = await mongo[AI_CONSENT_COLLECTION].find_one({"consent_type": "contact_invalid"})
    assert entry["channel"] == "sms" and await consent.is_invalid(db, "sms", entry["address"])
    # An opt-out record is NOT what this is: the customer didn't ask us to stop.
    assert not await consent.is_opted_out(db, created["customer_id"], "sms")
    assert (await _state(mongo, created["lead_id"]))["staff_notice"]["kind"] == "bad_contact"


async def test_a_second_bad_contact_leaves_nothing_and_suppresses_the_lead(mongo, live_dealer):
    created = await _lead()
    await _created(created)
    await _say(created, "wrong number")
    result = await _say(created, "this isn't Maria's email, wrong person", channel="email")
    assert result["status"] == "wrong_number" and result["suppressed_lead"] and result["channels_left"] == []
    assert (await _state(mongo, created["lead_id"]))["stage"] == "opted_out"
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "status": {"$in": ["pending", "standby"]}}) == 0
    assert (await _send(created, "email")).status == "suppressed"


async def test_another_phone_on_the_record_is_used_after_a_bad_one(mongo, live_dealer):
    created = await _lead()
    await _created(created)
    await mongo[PLATFORM_CUSTOMERS_COLLECTION].update_one(
        {"_id": ObjectId(created["customer_id"])},
        {"$push": {"phones": {"value": "2125550199", "is_primary": False, "sms_opt_in": True}}})
    await _say(created, "wrong number")
    outcome = await _send(created, "sms")
    assert outcome.status == "sent" and outcome.to == "+12125550199"


# --- Hard bounce --------------------------------------------------------------------

def test_which_provider_events_are_hard():
    assert suppression.is_hard_bounce("bounce", event_type="bounce")
    assert not suppression.is_hard_bounce("bounce", event_type="blocked")
    assert suppression.is_hard_bounce("dropped", reason="Bounced Address")
    assert not suppression.is_hard_bounce("dropped", reason="Spam content")
    assert not suppression.is_hard_bounce("delivered")
    assert suppression.is_bad_number_error("30006") and suppression.is_bad_number_error("21211")
    assert not suppression.is_bad_number_error("30008") and not suppression.is_bad_number_error(None)


async def _email_first_reply(mongo):
    created = await _lead(channel="email")
    await _created(created, channel="email")
    email = await mongo[AI_MESSAGES_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "direction": "outbound", "channel": "email"})
    assert email and email["status"] == "sent"
    return created, email


async def test_an_email_hard_bounce_suppresses_that_email_and_sms_carries_on(mongo, live_dealer):
    created, email = await _email_first_reply(mongo)
    result = await apply_delivery_status(StubPlatformClient(), "bounced", provider_id=email["provider_id"],
                                         error="550 no such user", hard=True)
    assert result.contact_suppressed["marked"] and result.contact_suppressed["channels_left"] == ["sms"]
    assert result.followup_due_now  # the SMS version goes now, not in 24 hours
    db = dealer_scoped_db(DEALER)
    assert await consent.is_invalid(db, "email", email["to"])
    assert not await consent.is_opted_out(db, created["customer_id"], "email")
    assert (await _send(created, "email")).status == "suppressed"

    assert (await followups.fire_due(_deps()))["results"] == {"sent": 1}
    [sms] = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"], "channel": "sms"}).to_list(None)
    assert sms["to"].startswith("+1")
    assert (await _state(mongo, created["lead_id"])).get("stage") != "opted_out"


async def test_a_soft_bounce_does_not_suppress_the_address(mongo, live_dealer):
    created, email = await _email_first_reply(mongo)
    result = await apply_delivery_status(StubPlatformClient(), "bounced", provider_id=email["provider_id"],
                                         error="mailbox full")
    assert result.contact_suppressed is None and result.followup_due_now
    assert not await consent.is_invalid(dealer_scoped_db(DEALER), "email", email["to"])
    assert (await _send(created, "email")).status == "sent"


async def test_hard_bounce_on_the_last_channel_suppresses_the_lead(mongo, live_dealer):
    created, email = await _email_first_reply(mongo)
    await _say(created, "wrong number", channel="sms")  # the phone goes first
    result = await apply_delivery_status(StubPlatformClient(), "bounced", provider_id=email["provider_id"], hard=True)
    assert result.contact_suppressed["suppressed_lead"]
    assert (await _state(mongo, created["lead_id"]))["stage"] == "opted_out"


async def test_a_number_the_carrier_cannot_reach_is_marked_and_email_takes_over(mongo, live_dealer):
    created = await _lead()
    await _created(created)
    sms = await mongo[AI_MESSAGES_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "direction": "outbound", "channel": "sms"})
    result = await apply_delivery_status(StubPlatformClient(), "undelivered", provider_id=sms["provider_id"],
                                         error="Twilio error 30006", hard=True)
    assert result.contact_suppressed["channels_left"] == ["email"] and result.followup_due_now
    assert (await followups.fire_due(_deps()))["results"] == {"sent": 1}
    assert (await _send(created, "sms")).status == "suppressed"


# --- Duplicate leads ----------------------------------------------------------------

async def test_a_second_lead_for_the_same_customer_is_linked_not_worked(mongo, live_dealer):
    first = await _lead()
    assert (await _created(first))["status"] == "done"
    second = await _lead(customer_id=first["customer_id"])
    result = await _created(second)
    assert result["status"] == "duplicate" and result["duplicate_of"] == first["lead_id"]

    # No first reply, no timers, no stage for the duplicate; the primary lists it.
    assert await mongo[DEV_OUTBOX_COLLECTION].count_documents({"lead_id": second["lead_id"]}) == 0
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents({"lead_id": second["lead_id"]}) == 0
    dup = await _state(mongo, second["lead_id"])
    assert dup["duplicate_of"] == first["lead_id"] and dup["status"] == "paused" and not dup.get("stage")
    primary = await _state(mongo, first["lead_id"])
    assert [x["lead_id"] for x in primary["linked_leads"]] == [second["lead_id"]]
    assert primary["staff_notice"]["kind"] == "duplicate_lead"
    # Client, 10 Oct 2026: the new inquiry is answered - on the primary, in the same conversation.
    assert result["new_inquiry"]["status"] == "done", result["new_inquiry"]
    assert result["new_inquiry"]["send_status"] == "sent"
    sent = {"lead_id": first["lead_id"], "direction": "outbound", "turn_id": f"new-inquiry-{second['lead_id']}"}
    assert await mongo[AI_MESSAGES_COLLECTION].count_documents(sent) >= 1
    replies = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": first["lead_id"]}).to_list(None)
    # A repeat of the same event changes nothing and doesn't answer twice.
    again = await _created(second)
    assert again["status"] == "duplicate"
    assert len((await _state(mongo, first["lead_id"]))["linked_leads"]) == 1
    assert await mongo[DEV_OUTBOX_COLLECTION].count_documents({"lead_id": first["lead_id"]}) == len(replies)


async def test_the_same_phone_on_a_different_customer_record_is_a_duplicate_too(mongo, live_dealer):
    first = await _lead()
    await _created(first)
    second = await _lead()  # same name: the dev customer gets the same phone and email
    assert second["customer_id"] != first["customer_id"]
    assert (await _created(second))["status"] == "duplicate"


async def test_a_different_customer_is_not_a_duplicate(mongo, live_dealer):
    first = await _lead()
    await _created(first)
    other = await _lead(name="Dana Other")
    assert (await _created(other))["status"] == "done"


async def test_customer_messages_go_to_the_primary_even_when_threaded_to_the_duplicate(mongo, live_dealer):
    first = await _lead()
    await _created(first)
    second = await _lead(customer_id=first["customer_id"])
    await _created(second)
    result = await _say(second, "My budget is about $30,000", lead_id=second["lead_id"])
    assert result["status"] == "done"
    row = await mongo[AI_MESSAGES_COLLECTION].find_one({"direction": "inbound"})
    assert row["lead_id"] == first["lead_id"]
    assert await mongo[AI_MESSAGES_COLLECTION].count_documents(
        {"lead_id": second["lead_id"], "direction": "outbound"}) == 0


async def test_resuming_a_duplicate_does_not_start_a_second_workflow(mongo, live_dealer):
    first = await _lead()
    await _created(first)
    second = await _lead(customer_id=first["customer_id"])
    await _created(second)
    result = await handlers.handle_lead_resumed(
        LeadResumedEvent(event_id="r1", dealer_id=DEALER, lead_id=second["lead_id"]))
    assert result["status"] == "duplicate"
    assert (await _state(mongo, second["lead_id"]))["status"] == "paused"


async def test_a_closed_primary_does_not_block_a_new_lead(mongo, live_dealer):
    first = await _lead()
    await _created(first)
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": first["lead_id"]}, {"$set": {"stage": "closed_lost"}})
    second = await _lead(customer_id=first["customer_id"])
    assert (await _created(second))["status"] == "done"


# --- Photos -------------------------------------------------------------------------

RECORDS = [
    {"vin": "VIN1", "photo_urls": ["https://cdn.dealer.example/vin1/1.jpg"]},
    {"vin": "VIN2", "photo_urls": []},
    {"vin": "VIN3", "photo_urls": ["http://insecure.example/a.jpg", "https://cdn.dealer.example/no-image.png"]},
    {"vin": "VIN4", "photo_urls": ["https://cdn.dealer.example/placeholder.jpg", "https://ok.example/vin4.jpg"]},
]


def test_a_photo_comes_only_from_the_vehicle_that_was_asked_for():
    assert media.choose_photo("VIN1", RECORDS).url == "https://cdn.dealer.example/vin1/1.jpg"
    assert media.choose_photo("vin1", RECORDS).available  # VINs compare case-insensitively
    assert media.choose_photo("VIN4", RECORDS).url == "https://ok.example/vin4.jpg"  # skips the placeholder


@pytest.mark.parametrize("vin,why", [
    ("VIN2", "no photo"), ("VIN3", "no photo"), ("NOPE", "not in this dealer"), (None, "nothing to show")])
def test_no_usable_photo_means_no_photo_and_never_another_vehicles(vin, why):
    choice = media.choose_photo(vin, RECORDS)
    assert choice.url is None and not choice.available and why in choice.reason


def test_inventory_records_carry_their_photos_without_sending_them_to_the_model():
    record = to_record({"vin": "VIN1", "media": {"photo_links": ["https://cdn.dealer.example/1.jpg", None]}})
    assert record.photo_urls == ["https://cdn.dealer.example/1.jpg"]
    assert "photo_urls" not in record.model_dump()
    assert media.choose_photo("VIN1", [record]).url == "https://cdn.dealer.example/1.jpg"


@pytest.mark.parametrize("text", [
    "I've attached a photo of the RAV4.", "Here's a pic of the car.", "Photos are below.",
    "See the picture: https://cdn.example/rav4.jpg", "Sending you the images now."])
def test_a_draft_may_not_claim_a_photo_that_is_not_attached(text):
    assert media.unattached_photo_claim(text)
    draft = {"sms_text": text, "email_subject": "RAV4", "email_body": "Hi Maria, " + text}
    result = check_draft(draft, customer_texts=[], known_values=[])
    assert not result["checks"]["no_unattached_photo_claims"] and not result["passed"]


def test_plain_wording_about_photos_is_fine():
    for text in ("I can't send photos by text, but I can show you the car in person.",
                 "Do you want to see it Thursday?"):
        assert not media.unattached_photo_claim(text)


async def test_a_new_lead_from_the_same_customer_restarts_the_90_day_clock(mongo, live_dealer):
    """Client, 10 Oct 2026 (Betsy): "when a customer re-engages, sends a new lead, the 90 day clock starts over" -
    every dealer, every lead: the Day 91 period and the own-inquiry texting window count from the new lead."""
    from datetime import timedelta

    from tests.unit.conftest import set_clock
    from upsell_agent import clock
    first = await _lead()
    await _created(first)
    set_clock(clock.now() + timedelta(days=60))
    second = await _lead(customer_id=first["customer_id"])
    result = await _created(second)
    assert result["reengaged"]["status"] == "restarted"
    state = await _state(mongo, first["lead_id"])
    anchor = state["day91_anchor"]
    anchor = anchor if anchor.tzinfo else anchor.replace(tzinfo=clock.now().tzinfo)
    assert abs((anchor - clock.now()).total_seconds()) < 60
    assert state["last_inquiry_at"] and state["stage"] == "contact_made_no_next_action"
    # Day 100 of the first lead, Day 40 of the re-engagement: still open, not closed at Day 91.
    set_clock(clock.now() + timedelta(days=40))
    from upsell_agent.agent import lifecycle
    await lifecycle.close_expired()
    assert (await _state(mongo, first["lead_id"]))["stage"] != "closed_lost"
