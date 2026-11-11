"""Betsy, 10-12 Nov 2026: "ai do not use the required ftc first response message with the vehicle image and therefore
the customer opted out!" Live, 11 Nov 2026: leads that came in at night (Carl Reid, Anton Bobytskyi, Vasilios
Stefanidis, Arsim bojaj, ILikeYourCutG Mckeever, Patricia Ann Grannum-Turner) got the FTC first message by EMAIL at
night, and their first TEXT at opening was the morning message ("Good morning, Carl. This is Nicole with Victory Cars
Central. I will be happy to help you pick up where we left off...") - no AI disclosure, no vehicle, no photo.

The first text a customer gets is the FTC first message, whatever turn sends it: the opening, the vehicle's price,
its photo, and "what are you driving now?". Still one text in the morning (the user, 28 Oct 2026: never the
morning message and the first message both).
"""

from datetime import UTC, datetime

import pytest

from tests.unit.conftest import set_clock
from tests.unit.test_after_hours import dealer_with_hours  # noqa: F401 - the dealer's opening hours, as live
from tests.unit.test_booking_flow import _deps
from tests.unit.test_client_requirements import RAV4, _new_lead, _sent
from tests.unit.test_inventory_tool import _stock, _vehicle
from upsell_agent.channels import consent
from upsell_agent.integrations.mongodb import DEV_OUTBOX_COLLECTION, SCHEDULED_FOLLOWUPS_COLLECTION
from upsell_agent.scheduler import followups

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer")

NIGHT = datetime(2026, 9, 23, 3, 10, tzinfo=UTC)  # Tue 11:10 PM New York
MORNING = datetime(2026, 9, 23, 14, 0, tzinfo=UTC)  # Wed 10:00 AM New York


async def _texts(mongo, created):
    return await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"], "channel": "sms"}).sort(
        "created_at", 1).to_list(None)


@pytest.mark.parametrize("at_night", ["email_now_text_when_open", "wait_for_text"])
async def test_a_night_leads_first_text_in_the_morning_is_the_ftc_first_message(mongo, dealer_with_hours, monkeypatch,
                                                                              at_night):
    monkeypatch.setattr(consent, "AT_NIGHT", at_night)
    await _stock(mongo, _vehicle("VIN0000000000CR01"))
    set_clock(NIGHT)
    created = await _new_lead(mongo, vehicle=RAV4)
    assert not await _texts(mongo, created)
    morning = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "status": "pending"}).to_list(None)
    assert morning, "nothing planned for the morning"

    set_clock(MORNING)
    await followups.fire_due(_deps())
    texts = await _texts(mongo, created)
    assert len(texts) == 1, [t["text"] for t in texts]  # one text in the morning, not two
    first = texts[0]
    assert first["text"].startswith("Hi Maria, this is "), first["text"]
    assert "AI Sales Manager" in first["text"] and "following up on your interest in the 2022 Honda CR-V" in first["text"]
    assert "what are you driving now?" in first["text"]
    assert "left off" not in first["text"]
    assert first["media_urls"] == ["https://img.example/VIN0000000000CR01.jpg"]


async def test_a_customer_already_texted_still_gets_the_morning_message(mongo):
    """Not the first text: the morning message stays as it is (a lead that texted us at night, test_after_hours)."""
    from upsell_agent.agent.nodes.decide import first_text_of_the_conversation
    pack = {"working_memory": [{"direction": "outbound", "channel": "sms", "text": "Hi Maria, this is ..."}]}
    assert first_text_of_the_conversation("resume_at_opening", "sms", pack) is False
    pack = {"working_memory": [{"direction": "outbound", "channel": "email", "text": "Hi Maria, this is ..."}]}
    assert first_text_of_the_conversation("resume_at_opening", "sms", pack) is True
    assert first_text_of_the_conversation("resume_at_opening", "email", pack) is False
    assert first_text_of_the_conversation("inbound_message", "sms", {"working_memory": []}) is False


async def test_emails_sent_at_night_are_unchanged(mongo, dealer_with_hours):
    await _stock(mongo, _vehicle("VIN0000000000CR01"))
    set_clock(NIGHT)
    created = await _new_lead(mongo, vehicle=RAV4)
    [email] = await _sent(mongo, created, "email")
    assert "AI Sales Manager" in email


async def test_with_betsys_morning_wording_in_ai_studio_the_first_text_is_still_the_ftc_message(
        mongo, dealer_with_hours, monkeypatch):
    """Live, 11 Nov 2026: AI Studio's morning message ("Good morning, {first_name}. This is {agent_name} with
    {dealership}. I will be happy to help you pick up where we left off...") replaced the first text entirely."""
    from upsell_agent import ai_studio
    betsy = {"mode": "fixed", "text": "Good morning, {first_name}. This is {agent_name} with {dealership}.  I will be "
                                      "happy to help you pick up where we left off.  Tell me, what are you driving now?"}
    real = ai_studio.message
    monkeypatch.setattr(ai_studio, "message",
                        lambda section, key: betsy if key == "after_hours_resume" else real(section, key))
    monkeypatch.setattr(consent, "AT_NIGHT", "email_now_text_when_open")
    await _stock(mongo, _vehicle("VIN0000000000CR01"))
    set_clock(NIGHT)
    created = await _new_lead(mongo, vehicle=RAV4)
    set_clock(MORNING)
    await followups.fire_due(_deps())
    [first] = await _texts(mongo, created)
    assert first["text"].startswith("Hi Maria, this is ") and "AI Sales Manager" in first["text"], first["text"]
    assert "left off" not in first["text"] and "Good morning" not in first["text"]
    assert first["media_urls"] == ["https://img.example/VIN0000000000CR01.jpg"]

    # A customer who already had a text keeps getting Betsy's morning wording (test_after_hours covers that turn).
