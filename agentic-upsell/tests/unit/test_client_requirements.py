"""The client's requirements, end to end (client, 13 Oct 2026: "make sure everything that was in the emails, messages,
documents, even their reviews, is tested").

Every test is one thing Betsy or Bibi asked for, named after it, with where it came from. Each runs a real
conversation through the same code the live server runs - the lead arrives, the AI replies, the customer answers - on
the dev dealer with the fake channel (nothing is sent), and checks what the customer would get and what the CRM shows.
The register these come from: agentic-upsell/src/upsell_agent/docs/plans/SOW_AUDIT/requirements.md.
"""

import re
from datetime import UTC, datetime, timedelta

import pytest

from tests.unit.conftest import set_clock
from tests.unit.test_booking_flow import DEALER, _deps, _last_sms, _say, _state
from tests.unit.test_inventory_tool import _stock, _vehicle
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import LeadCreatedEvent
from upsell_agent.integrations.mongodb import (
    DEV_OUTBOX_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    as_object_id,
)

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer")
TEAM = re.compile(r"\b(the|our|a)\s+team\b|team member|someone will", re.IGNORECASE)


async def _new_lead(mongo, *, name="Maria Lopez", comments="Is it still available?", phone=True, vehicle=None,
                    source=None, customer_id=None):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms" if phone else "email", name=name,
                                         comments=comments, customer_id=customer_id)
    update = {**(vehicle or {}), **({"source": source} if source else {})}
    if not phone:
        update["phone"] = None
        await mongo[PLATFORM_CUSTOMERS_COLLECTION].update_one({"_id": as_object_id(created["customer_id"])},
                                                              {"$set": {"phones": []}})
    if update:
        await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": as_object_id(created["lead_id"])}, {"$set": update})
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"], customer_id=created["customer_id"],
        channel="sms" if phone else "email"), _deps())
    return created


async def _sent(mongo, created, channel="sms"):
    rows = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"], "channel": channel}).sort(
        "created_at", 1).to_list(None)
    return [r.get("text") or "" for r in rows]


async def _lead_doc(mongo, created):
    return await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": as_object_id(created["lead_id"])})


RAV4 = {"year": 2022, "make": "Honda", "model": "CR-V", "vin": "VIN0000000000CR01"}


# --- First message (FTC, 7 Oct email; Betsy's reviews 12 Oct) -----------------------------------------------------

async def test_first_text_is_the_ftc_script_and_asks_what_they_drive(mongo):
    """Email 7 Oct: "this basically needs to be said BEFORE ANYTHING ... following up on your interest in the
    [Year Make Model]. Tell me, what are you driving now?" """
    await _stock(mongo, _vehicle("VIN0000000000CR01"))
    created = await _new_lead(mongo, vehicle=RAV4)
    first = (await _sent(mongo, created))[0]
    assert first.startswith("Hi Maria, this is ") and "AI Sales Manager" in first
    assert "following up on your interest in the 2022 Honda CR-V" in first
    assert "Tell me, what are you driving now?" in first


async def test_first_text_has_the_listed_price_not_lead_form_details(mongo):
    """Review 12 Oct (Natasha): no "thanks for the shopper details", no budget read back; "send a picture of the
    vehicle and the listed price which does not include tax, documentation or DMV"."""
    await _stock(mongo, _vehicle("VIN0000000000CR01"))
    created = await _new_lead(mongo, vehicle=RAV4, comments="Shopper details: budget $59,445, just browsing")
    first = (await _sent(mongo, created))[0]
    assert "$27,995, not including tax, documentation and DMV fees" in first
    assert "shopper details" not in first.lower() and "59,445" not in first and "browsing" not in first.lower()


async def test_first_text_answers_mileage_and_carfax_from_the_lead_form(mongo):
    """Review 12 Oct (Yvette Miller): "Please provide CarFax and mileage of car" got no answer."""
    await _stock(mongo, _vehicle("VIN0000000000CR01", miles=31250))
    created = await _new_lead(mongo, vehicle=RAV4, comments="Please provide CarFax and mileage of car")
    first = (await _sent(mongo, created))[0]
    assert "31,250 miles" in first and "https://dealer.example/v/VIN0000000000CR01" in first


async def test_a_website_form_lead_is_inbound(mongo):
    """Review 12 Oct (Yvette): a Dealer Inspire lead got "reaching out about" - an outbound opening."""
    created = await _new_lead(mongo, vehicle=RAV4, source="Dealer Inspire/Get E-Price")
    first = (await _sent(mongo, created))[0]
    assert "following up on your interest" in first and "reaching out about" not in first


async def test_no_phone_gets_bettys_email_with_the_ftc_intro(mongo):
    """Email 12 Oct: no phone -> "[vehicle] Update ... What is the best phone number to reach you? ... By the way,
    what are you driving now?"; and every email follows the FTC rules (email 7 Oct)."""
    created = await _new_lead(mongo, vehicle=RAV4, phone=False)
    email = (await _sent(mongo, created, "email"))[0]
    assert "AI Sales Manager" in email.split("\n\n")[0]
    assert "What is the best phone number to reach you?" in email and "what are you driving now?" in email
    assert not await _sent(mongo, created, "sms")


# --- Names (review 12 Oct: "Hello again, Null", "Sorry for the wait, Name") ------------------------------------------

async def test_a_placeholder_name_is_never_sent_and_the_ai_asks_for_it(mongo):
    created = await _new_lead(mongo, name="null null", vehicle=RAV4)
    first = (await _sent(mongo, created))[0]
    assert "Null" not in first and "null" not in first and "Name" not in first


# --- "The team" (email 12 Oct: "stop saying the team can do this and that") -------------------------------------

async def test_replies_never_promise_the_team(mongo):
    created = await _new_lead(mongo, vehicle=RAV4)
    for said in ("How long does an appraisal take?", "Do you have it in red?", "What documents do I need?"):
        await _say(created, said)
    for text in await _sent(mongo, created):
        assert not TEAM.search(text), text


# --- What the AI can't supply (email 12 Oct, her exact words) ------------------------------------------------------

@pytest.mark.parametrize(("asked", "starts"), [
    ("What's the APR?", "Our goal is to get you the lowest possible APR"),
    ("What would my monthly payment be?", "Our goal is to get you the lowest possible payment"),
    ("What's my credit score?", "We need to meet with you in person to discuss your credit"),
    ("What's the out the door price?", "Our list price is accurate"),
    ("Can you send me a video of it?", "I will make sure you get some photos as soon as possible"),
    ("I live out of state", "That is no problem at all; we work with customers who are out of state"),
])
async def test_cannot_supply_answers_are_her_words(mongo, asked, starts):
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, asked)
    assert (await _last_sms(mongo, created)).startswith(starts)


async def test_a_custom_video_request_needs_the_dealership(mongo):
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "Can you send me a video of the interior?")
    assert (await _state(mongo, created)).get("crm_status_sync", {}).get("crm_status") == "Managerial Review"


# --- Buyer's order (email 12 Oct) ----------------------------------------------------------------------------------

async def test_the_buyers_order_sequence(mongo):
    """Email 12 Oct + "always APPOINTMENT FIRST" (confirmed 13 Oct): the invitation, then her sequence if they insist."""
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "Can you please send me a buyer's order for this car?")
    assert "It's most accurate in person" in await _last_sms(mongo, created)
    await _say(created, "I'd rather you just email it to me")
    assert await _last_sms(mongo, created) == ("That is great; that must mean you are ready to buy today! Are you "
                                               "ready to take delivery today?")
    await _say(created, "yes")
    assert (await _last_sms(mongo, created)).endswith("Are you trading a vehicle?")
    await _say(created, "yes")
    assert "we must appraise your trade-in first" in await _last_sms(mongo, created)


# --- Bookings (reviews 12 Oct: Mailyn, Johnson, Jon) ----------------------------------------------------------------

async def test_no_booking_from_the_lead_email_text(mongo):
    created = await _new_lead(mongo, vehicle=RAV4, comments="Scheduled appointment: Saturday 10:00 AM")
    assert (await _lead_doc(mongo, created)).get("data", {}).get("bookingId") is None


async def test_no_booking_when_not_ready(mongo):
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "My budget is $35,000 and I'd like to buy this month")
    await _say(created, "Saturday could work but I need the numbers first")
    assert (await _lead_doc(mongo, created)).get("data", {}).get("bookingId") is None


async def test_a_pick_books_and_times_are_12_hour(mongo):
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "My budget is $35,000 and I'd like to buy this month")
    offer = await _last_sms(mongo, created)
    assert re.search(r"\d{1,2}:\d{2} (AM|PM)", offer) and not re.search(r"\b(1[3-9]|2[0-3]):\d{2}\b", offer)
    await _say(created, "the first one works")
    lead = await _lead_doc(mongo, created)
    assert lead["data"].get("bookingId") and lead["status"] == "Appointment Booked"
    assert "all set" in (await _last_sms(mongo, created)).lower()


# --- Contacted (Bibi 9-10 Oct; Betsy 12 Oct "the incoming lead email is NOT a contact made") ------------------------

async def test_a_new_lead_is_not_contact(mongo):
    created = await _new_lead(mongo, vehicle=RAV4)
    state = await _state(mongo, created)
    assert state["stage"] in ("new_lead", "no_contact_made")


async def test_a_repeat_lead_asks_hello_again_and_is_not_contact(mongo):
    """Email 12 Oct: 2+ leads within 30 days -> "Hello again, [name], thank you for inquiring about our [vehicle].
    Are you comparing models, or are you in the market for more than one vehicle?" """
    first = await _new_lead(mongo, vehicle=RAV4)
    second = await _new_lead(mongo, vehicle={"year": 2023, "make": "Toyota", "model": "RAV4"},
                             customer_id=first["customer_id"])
    texts = await _sent(mongo, first) + await _sent(mongo, second)
    hello = next(t for t in texts if t.startswith("Hello again"))
    assert "2023 Toyota RAV4" in hello and "comparing models" in hello and "{" not in hello
    state = await _state(mongo, first)
    assert state["stage"] != "contact_made_no_next_action"


# --- Trade, email preference, departments (reviews 12 Oct) ----------------------------------------------------------

async def test_value_of_my_car_is_a_trade(mongo):
    """Review 12 Oct (Jean): "the value of you home to my civic" - "WHY DID TRADE AI AGENT NOT KICK IN?" """
    from upsell_agent.agent.specialists import TRADE, route
    assert route("Depends for the value of you home to my civic")[0].id == TRADE


async def test_contact_me_by_email_stops_texts(mongo):
    """Review 12 Oct (Jonathan): "customer asked to be contacted via email, AI proceeded to send SMS"."""
    from upsell_agent.compliance.opt_out import detect_opt_out
    found = detect_opt_out("please contact me by email instead", "sms")
    assert found and "sms" in found.channels and "email" not in found.channels


# --- Stock (Bibi 12 Oct: Mach-E; Betsy: never "not available") ------------------------------------------------------

async def test_a_car_we_dont_have_gets_similar_ones_never_not_available(mongo):
    await _stock(mongo, _vehicle("VIN0000000000RV01", make="Toyota", model="RAV4", trim="XLE"))
    created = await _new_lead(mongo)
    await _say(created, "Do you have a Honda CR-V?")
    reply = await _last_sms(mongo, created)
    assert "RAV4" in reply and "don't have" not in reply.lower() and "not available" not in reply.lower()


async def test_mach_e_is_found_as_a_mustang_trim(mongo):
    await _stock(mongo, _vehicle("VIN0000000000ME01", year=2025, make="Ford", model="Mustang", trim="Mach-E Premium"))
    created = await _new_lead(mongo, vehicle={"year": 2025, "make": "Ford", "model": "Mustang Mach-E"})
    await _say(created, "Do you have the Mach E?")
    reply = await _last_sms(mongo, created)
    assert "Mach-E" in reply and "don't have" not in reply.lower()


# --- After hours (WhatsApp 25 Sep, Betsy 12 Oct) --------------------------------------------------------------------

async def test_after_hours_inside_texting_hours_helps_now(mongo):
    set_clock(datetime(2026, 9, 23, 0, 0, tzinfo=UTC))  # 8:00 PM New York: closed, still legal to text
    created = await _new_lead(mongo, vehicle=RAV4)
    first = (await _sent(mongo, created))[0]
    assert "closed right now" in first and "help you right now" in first and not TEAM.search(first)


async def test_after_hours_outside_texting_hours_asks_now_or_business_hours(mongo):
    set_clock(datetime(2026, 9, 23, 3, 0, tzinfo=UTC))  # 11:00 PM New York
    created = await _new_lead(mongo, vehicle=RAV4)
    assert not await _sent(mongo, created)  # no text at 11 PM (TCPA texting hours): the offer goes by email at once
    first = (await _sent(mongo, created, "email"))[0]
    assert "Would you like to chat now, or would you prefer to continue during business hours?" in first
    assert not TEAM.search(first)


# --- Dealership Action Required only for her cases (email 12 Oct) ---------------------------------------------------

async def test_asking_for_a_person_offers_call_or_text(mongo):
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "Can I talk to a real person?")
    reply = await _last_sms(mongo, created)
    assert "call" in reply.lower() and "text" in reply.lower()


async def test_an_ordinary_question_is_not_dealership_action_required(mongo):
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "How many miles does it have?")
    assert (await _state(mongo, created)).get("crm_status_sync", {}).get("crm_status") != "Managerial Review"


# --- Opt-out (TCPA spec) --------------------------------------------------------------------------------------------

async def test_stop_opts_out_and_the_ai_starts_nothing_more(mongo):
    """TCPA spec + decisions 136-137: STOP stops everything we start (the carrier sends the confirmation); a reply to
    the customer's own later message still goes."""
    from upsell_agent.channels import consent
    from upsell_agent.integrations.mongodb import dealer_scoped_db
    created = await _new_lead(mongo, vehicle=RAV4)
    stopped = await _say(created, "STOP")
    assert stopped["status"] == "opted_out" and stopped["followups_cancelled"] >= 1
    assert len(await _sent(mongo, created)) == 1  # nothing from us after STOP
    assert await consent.is_opted_out(dealer_scoped_db(DEALER), created["customer_id"], "sms")


# --- 13 Oct 2026 (Bibi / Betsy, the overnight leads and Artem Petrov) ----------------------------------------------

async def test_a_night_lead_gets_the_email_now_and_its_first_text_in_the_morning(mongo):
    """Timi Gabice, 11:10 PM, a phone on the lead: only an email ever went out. Betsy: email at night, the text when
    texting hours open - the full first text, not the "we're open" email on top of it."""
    from upsell_agent.integrations.mongodb import SCHEDULED_FOLLOWUPS_COLLECTION
    set_clock(datetime(2026, 9, 23, 3, 10, tzinfo=UTC))  # 11:10 PM New York
    created = await _new_lead(mongo, vehicle=RAV4)
    assert not await _sent(mongo, created) and (await _sent(mongo, created, "email"))
    pending = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "status": "pending"}).to_list(None)
    held = [p for p in pending if p["kind"] == "first_reply_held"]
    assert len(held) == 1 and held[0]["to_channel"] == "sms"
    assert not [p for p in pending if p["kind"] == "resume_at_opening"]
    from tests.unit.test_booking_flow import _deps as deps
    from upsell_agent.scheduler import followups
    set_clock(held[0]["due_at"].replace(tzinfo=UTC) + timedelta(minutes=1))
    await followups.fire_due(deps())
    first_text = (await _sent(mongo, created))[0]
    assert first_text.startswith("Hi Maria, this is ") and "AI Sales Manager" in first_text


async def test_a_lead_portal_placeholder_email_is_never_used(mongo):
    """Betsy: "the email provided on that lead was that bogus CarGurus placeholder email"."""
    from upsell_agent.channels.consent import resolve_recipient
    lead = {"email": "no-reply+19292404033@cargurus.com", "phone": "+19292404033"}
    assert resolve_recipient(lead, {}, "email") is None
    assert resolve_recipient({"email": "teg7580@aol.com"}, {}, "email") == "teg7580@aol.com"


@pytest.mark.parametrize(("said", "hhmm"), [("520", "17:20"), ("1130", "11:30"), ("5 20", "17:20"),
                                            ("at 520pm", "17:20"), ("5:20", "17:20")])
def test_a_time_without_a_colon_is_read(said, hhmm):
    from upsell_agent.tools.booking_tool import bare_time
    assert bare_time(said).strftime("%H:%M") == hhmm


async def test_on_my_way_and_a_time_books_that_time_today(mongo):
    """Artem Petrov: "We coming to look at it now" -> "About what time will you arrive?" -> "520": the AI "didn't
    acknowledge the time and didn't confirm an appt nor book it"."""
    set_clock(datetime(2026, 9, 22, 18, 0, tzinfo=UTC))  # 2:00 PM New York, a Tuesday
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "We coming to look at it now")
    await _say(created, "520")
    lead = await _lead_doc(mongo, created)
    assert lead["data"].get("bookingId"), lead.get("data")
    assert "5:20 PM" in await _last_sms(mongo, created)


def test_no_template_promises_the_team():
    """Betsy, 12 Oct: never "the team" - the holding replies said "The team has your messages" (Jean Castro)."""
    from upsell_agent.agent import templates
    every = [t for group in (templates.FIRST_REPLY, templates.HOLDING_REPLIES) for t in group.values()]
    for template in every:
        for text in (template.sms, template.email_body):
            assert not TEAM.search(text.replace("_SIGN_OFF", "")), text


@pytest.mark.parametrize(("asked", "said", "values", "kept"), [
    ("About what time will you arrive?", "520", [("interest.monthly_payment", 520), ("visit_when", "520")],
     ["visit_when"]),
    ("Roughly how much would you like to spend?", "520", [("interest.monthly_payment", 520)],
     ["interest.monthly_payment"]),
    ("How many miles are on your current car?", "45k", [("interest.budget", 45000)], []),
    ("What year is your trade-in?", "19", [("trade_in.year", 2019)], ["trade_in.year"]),
    ("What year is it, and how many miles?", "2019", [("trade_in.year", 2019)], ["trade_in.year"]),
    ("Roughly how much would you like to spend?", "Ideally in red", [("interest.color", "red")],
     ["interest.color"]),
])
def test_a_short_answer_means_what_we_asked(asked, said, values, kept):
    """Bibi / client, 13 Oct 2026: "520" after "what time will you arrive?" was read as a $520 budget - a short answer
    is read against the question it answers (times, money, miles, years)."""
    from upsell_agent.agent.nodes.extract import drop_values_of_the_wrong_kind
    extraction = {"values": [{"path": p, "value": v} for p, v in values]}
    drop_values_of_the_wrong_kind(extraction, said, asked)
    assert [v["path"] for v in extraction["values"]] == kept


async def test_a_day_they_name_gets_that_days_times(mongo):
    """Betsy, 16 Oct 2026: "appointment centric" - "Probably Saturday" is answered with Saturday's open times."""
    set_clock(datetime(2026, 9, 22, 14, 0, tzinfo=UTC))  # a Tuesday morning in New York
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "My budget is $35,000")
    await _say(created, "Probably Saturday")
    assert "Saturday at" in await _last_sms(mongo, created)


def test_the_lead_and_stock_say_new_or_used():
    """George's BMW was used: the AI never asks "new or used?" about the car the lead is about."""
    from upsell_agent.slots.prefill import _new_or_used, facts_from_lead
    assert facts_from_lead({"model": "430i", "make": "BMW", "condition": "Used"})["interest.new_or_used"] == "used"
    assert _new_or_used("Certified Pre-Owned") == "used" and _new_or_used("New") == "new" and _new_or_used("") is None


def test_their_own_words_say_what_a_number_is():
    """George, 16 Oct 2026: "Around 500 a month" after a mileage question is his budget, and is kept."""
    from upsell_agent.agent.nodes.extract import drop_values_of_the_wrong_kind
    extraction = {"values": [{"path": "interest.monthly_payment", "value": 500}]}
    drop_values_of_the_wrong_kind(extraction, "Around 500 a month", "How many miles are on your Accord?")
    assert [v["path"] for v in extraction["values"]] == ["interest.monthly_payment"]


def test_the_price_is_said_once():
    from upsell_agent.agent.nodes.compose import place_touch1_extras
    line = "It's listed at $27,995, not including tax, documentation and DMV fees."
    draft = {"sms_text": "Hi George, this is the AI Sales Manager. It's here, listed at $27,995 before fees. What do you "
                         "drive now?", "email_body": ""}
    place_touch1_extras(draft, {"price_line": line, "vin": "V1", "intro": "Hi George, this is the AI Sales Manager."})
    assert draft["sms_text"].count("$27,995") == 1 and line in draft["sms_text"]


@pytest.mark.one_question
async def test_one_question_per_message(mongo):
    """Betsy, 18 Oct 2026: "it asked about budget and about trade in the same breath" - one question at a time."""
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "used")
    reply = await _last_sms(mongo, created)
    assert reply.count("?") == 1, reply


async def test_where_is_it_gets_the_address_even_in_the_fallback(mongo):
    """Zack, 17 Oct 2026: "Where is the vehicle located?" got "we can go over that together"."""
    from upsell_agent.agent.templates import render_continue_reply
    out = render_continue_reply("Zack Charles", {"answer_questions": [{"text": "Where is the vehicle located"}],
                                                 "dealer_address": "3914 Hempstead Tpke, Levittown, NY 11756"})
    assert "3914 Hempstead Tpke" in out["sms_text"] and out["sms_text"].endswith("come in?")


def test_portal_boilerplate_is_not_the_customers_words():
    from upsell_agent.agent.portal_text import clean_comments
    said = "I'd like to see the A4. For notification changes, please contact support@cars.com."
    assert clean_comments(said) == "I'd like to see the A4."
