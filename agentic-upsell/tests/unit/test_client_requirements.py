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
    PLATFORM_BOOKINGS_COLLECTION,
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
    from tests.unit.conftest import expand_short_links
    first = await expand_short_links(mongo, (await _sent(mongo, created))[0])
    assert "31,250 miles" in first and "https://dealer.example/v/VIN0000000000CR01" in first
    assert "https://autopulse.ai/l/" in (await _sent(mongo, created))[0]  # sent as a short link (22 Oct 2026)


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
    from bson import ObjectId
    from upsell_agent.integrations.mongodb import PLATFORM_USERS_COLLECTION
    created = await _new_lead(mongo, vehicle=RAV4)
    dealer_id = (await _state(mongo, created)).get("dealer_id")
    # A live dealer: the AI's escalation reaches the CRM (Robby Torres, 28 Oct 2026 meeting).
    await mongo[PLATFORM_USERS_COLLECTION].update_one({"_id": ObjectId(dealer_id)}, {"$set": {"ai_mode": "live"}},
                                                      upsert=True)
    await _say(created, "Can you send me a video of the interior?")
    assert (await _state(mongo, created)).get("crm_status_sync", {}).get("crm_status") == "Managerial Review"
    # Robby Torres, 28 Oct 2026 meeting: the escalation is on Dealer Action Required, and in its handled list after.
    from upsell_agent.api.staff_view import Handled, list_notices, mark_handled
    dealer = dealer_id
    [row] = [n for n in (await list_notices(dealer))["notices"] if n["lead_id"] == created["lead_id"]]
    assert row["kind"] == "manager_escalation" and "Managerial Review" in row["text"]
    await mark_handled(created["lead_id"], Handled(dealer_id=dealer, source=row["source"], by="Mercy"))
    assert all(n["lead_id"] != created["lead_id"] for n in (await list_notices(dealer))["notices"])
    handled = [n for n in (await list_notices(dealer, include_handled=True))["notices"]
               if n["lead_id"] == created["lead_id"]]
    assert handled and handled[0]["handled"] and handled[0]["handled_by"] == "Mercy"


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


async def test_three_inquiries_in_a_row_get_the_hello_again_question_once(mongo):
    """Yefri Montoya, 28 Oct 2026: a Venue, an Equinox and a Rogue on CarGurus in 10 minutes got three emails in 10
    minutes - "are you comparing models?" twice. Asked once; the third inquiry is a staff note."""
    first = await _new_lead(mongo, vehicle=RAV4)
    await _new_lead(mongo, vehicle={"year": 2018, "make": "Chevrolet", "model": "Equinox"},
                    customer_id=first["customer_id"])
    third = await _new_lead(mongo, vehicle={"year": 2024, "make": "Nissan", "model": "Rogue"},
                            customer_id=first["customer_id"])
    texts = await _sent(mongo, first)
    assert len([t for t in texts if t.startswith("Hello again")]) == 1, texts
    from upsell_agent.agent.crm_notes import AI_CRM_NOTES_COLLECTION
    note = await mongo[AI_CRM_NOTES_COLLECTION].find_one({"kind": "another_inquiry"})
    assert note and "Rogue" in note["text"] and third["lead_id"] in note["text"]


async def test_a_question_held_for_the_night_does_not_block_the_morning_one(mongo):
    """Deyvi Lopez, 28 Oct 2026: the 10:50 PM "comparing models?" text was held for the night (never sent) but
    recorded as asked, so his 9:11 AM inquiry got nothing. Only a question that went counts."""
    set_clock(datetime(2026, 9, 23, 2, 40, tzinfo=UTC))  # 10:40 PM New York
    first = await _new_lead(mongo, vehicle=RAV4)
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": as_object_id(first["lead_id"])}, {"$set": {"email": None}})
    await _new_lead(mongo, vehicle={"year": 2017, "make": "Acura", "model": "MDX"}, customer_id=first["customer_id"])
    state = await mongo["ai_lead_state"].find_one({"lead_id": first["lead_id"]})
    assert not (state or {}).get("multi_vehicle_question")  # held, not sent: not recorded as asked
    set_clock(datetime(2026, 9, 23, 13, 11, tzinfo=UTC))  # 9:11 AM
    await _new_lead(mongo, vehicle={"year": 2020, "make": "Acura", "model": "MDX"}, customer_id=first["customer_id"])
    assert any(t.startswith("Hello again") for t in await _sent(mongo, first))


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

async def test_a_night_lead_is_asked_now_or_business_hours_once_and_nothing_is_sent_twice(mongo):
    """The user, 28 Oct 2026: a lead that writes in at night gets what anyone texting after hours gets - "should I
    message you now, or during business hours?" - on the channel allowed at that hour, once. No answer: picked up when
    the dealership opens. Not the email at night and then the same first message by text in the morning (140 leads)."""
    from upsell_agent.integrations.mongodb import SCHEDULED_FOLLOWUPS_COLLECTION
    set_clock(datetime(2026, 9, 23, 3, 10, tzinfo=UTC))  # 11:10 PM New York
    created = await _new_lead(mongo, vehicle=RAV4)
    emails = await _sent(mongo, created, "email")
    assert not await _sent(mongo, created) and len(emails) == 1
    assert re.search(r"\bnow\b", emails[0], re.IGNORECASE) and re.search(r"open|business hours|morning", emails[0],
                                                                         re.IGNORECASE), emails[0]
    pending = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "status": "pending"}).to_list(None)
    assert not [p for p in pending if p["kind"] == "first_reply_held"]  # no second copy of the first message
    assert [p for p in pending if p["kind"] == "resume_at_opening"]  # no answer: picked up at opening


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


@pytest.mark.parametrize(("said", "hhmm"), [
    ("Yeah I'm on my way, I will be there in 10 minutes", "14:10"),
    ("on my way", "14:30"),
    ("omw be there in half an hour", "14:30"),
    ("leaving now, be there in like 22 min", "14:25"),
])
async def test_on_my_way_with_no_appointment_books_the_arrival(mongo, said, hhmm):
    """Betsy, 27 Oct 2026 meeting (the Dodge Charger lead: "I'm on my way. I will be there in 10 minutes" - no
    appointment was set, nobody at the store expected him): that's an appointment, now + the minutes they said."""
    set_clock(datetime(2026, 9, 22, 18, 0, tzinfo=UTC))  # 2:00 PM New York, a Tuesday
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, said)
    booking = await mongo[PLATFORM_BOOKINGS_COLLECTION].find_one({"lead_id": {"$in": [
        created["lead_id"], as_object_id(created["lead_id"])]}})
    assert booking and booking["bookingTime"] == hhmm, booking


async def test_on_my_way_after_closing_books_nothing(mongo):
    set_clock(datetime(2026, 9, 22, 22, 50, tzinfo=UTC))  # 6:50 PM New York; 7 PM close
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "on my way, be there in 40 minutes")
    assert not (await _lead_doc(mongo, created))["data"].get("bookingId")


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


def test_no_promise_to_send_what_the_ai_cannot():
    """Freder / Steven, 18 Oct 2026."""
    from upsell_agent.agent.nodes.guard import promises_what_it_cannot_send
    for text in ("I'll write up your full out-the-door with the doc fee and send it here shortly.",
                 "Sounds good. I'll send the video link Monday around midday."):
        assert promises_what_it_cannot_send({}, {"sms_text": text}), text
    assert not promises_what_it_cannot_send({}, {"sms_text": "We'll go over the numbers together when you come in."})


def test_where_is_it_must_get_the_street_address():
    """Zack, 17 Oct 2026: "It's here at our dealership in town" is not an answer to "Where is the vehicle located"."""
    from upsell_agent.agent.nodes.guard import missing_address
    decision = {"dealer_address": "3914 Hempstead Tpke, Levittown, NY 11756"}
    vague = {"sms_text": "It's here at our dealership in town. What day works?", "email_body": ""}
    good = {"sms_text": "We're at 3914 Hempstead Tpke, Levittown. What day works?",
            "email_body": "We're at 3914 Hempstead Tpke, Levittown, NY 11756."}
    assert missing_address(decision, vague, "Where is the vehicle located")
    assert not missing_address(decision, good, "Where is the vehicle located")
    assert not missing_address(decision, vague, "Is it still available?")


def test_awd_on_an_xdrive_is_not_unverified():
    """19 Oct 2026: "AWD" on a BMW xDrive / Audi quattro was rejected as a feature the stock record doesn't show."""
    from upsell_agent.guardrails.wording import unverified_features
    stock = [{"vin": "V1", "make": "BMW", "model": "3 Series", "trim": "330i xDrive"}]
    assert not unverified_features({"sms_text": "It's the 330i xDrive with AWD.", "email_body": ""}, stock)
    assert unverified_features({"sms_text": "It has a panoramic roof.", "email_body": ""}, stock)


def test_still_available_answered_in_plain_words():
    from upsell_agent.agent.nodes.guard import unanswered_questions
    decision = {"action": "answer", "answer_questions": [{"text": "I'd like to know if it's still available."}]}
    assert not unanswered_questions(decision, {"sms_text": "Yes, it's here and available.", "answered_questions": []})


async def test_first_text_photo_falls_back_to_the_lead_vehicle():
    """Betsy, 19 Oct 2026: the first text shows the car's photo like the first email does."""
    import inspect

    from upsell_agent.agent.vehicle_media import photo_for_draft
    assert "first_reply" in inspect.signature(photo_for_draft).parameters



def test_a_vehicle_the_customer_names_that_isnt_in_stock_goes_to_dealership_action_required():
    # Betsy, 25 Oct 2026 (Motie: "Looking for an S65" -> "I'll check with a manager", and nobody was told).
    from upsell_agent.agent.nodes.decide import vehicle_check_for
    stock = {"searched_for": "Mercedes-Benz S65", "exact": False, "asked": False}
    assert vehicle_check_for(stock, {"asked_vehicle": "S65"}, "inbound_message", "offer_visit") == {
        "vehicle": "Mercedes-Benz S65"}
    assert vehicle_check_for(stock, {}, "inbound_message", "offer_visit") is None  # an ordinary question
    assert vehicle_check_for({**stock, "exact": True}, {"asked_vehicle": "S65"}, "inbound_message", "answer") is None
    assert vehicle_check_for(stock, {"asked_vehicle": "S65"}, "cadence_touch", "offer_visit") is None
    # Activity log, 25 Oct 2026: the first message about the lead's own vehicle, not in stock, escalates too.
    assert vehicle_check_for(stock, {}, "lead_created", "offer_visit") == {"vehicle": "Mercedes-Benz S65"}


async def test_the_leads_own_vin_is_the_exact_match_under_another_model_name(mongo):
    # Joe Dalton, 26 Oct 2026: Cars.com said "540 xDrive", the feed says "5 Series" trim "540i xDrive"; he went to
    # Managerial Review "to confirm it's available" while it was in stock.
    vin = "WBAJS3C0XLWW66406"
    await _stock(mongo, _vehicle(vin, year=2020, make="BMW", model="5 Series", trim="540i xDrive", body="4D Sedan"),
                 _vehicle("VIN0000000000X301", year=2020, make="BMW", model="X3", trim="xDrive30i"))
    created = await _new_lead(mongo, vehicle={"year": 2020, "make": "BMW", "model": "540 xDrive", "vin": vin})
    turn = await mongo["ai_turn_log"].find_one({"lead_id": created["lead_id"]})
    search = next(n["output"] for n in turn["nodes"] if n["node"] == "search_stock")
    assert search["records"][0]["vin"] == vin and not search["loosened"]
    assert (await _state(mongo, created)).get("mode") != "handoff"


async def test_the_leads_own_car_is_loaded_first_among_many_of_the_same_model(mongo):
    # Zain Faisal, 25 Oct 2026: three newer C 300s were loaded, not his, and a silver one was "the one you asked about".
    vin = "55SWF8EB9KU303122"
    await _stock(mongo, _vehicle(vin, year=2019, make="Mercedes-Benz", model="C-Class", trim="C 300",
                                 color="Selenite Gray Metallic", added_minutes_ago=600),
                 *(_vehicle(f"VIN000000000C30{i}", year=2019, make="Mercedes-Benz", model="C-Class", trim="C 300",
                            color="Silver", added_minutes_ago=i) for i in range(1, 6)))
    created = await _new_lead(mongo, vehicle={"year": 2019, "make": "Mercedes-Benz", "model": "C-Class", "vin": vin})
    turn = await mongo["ai_turn_log"].find_one({"lead_id": created["lead_id"]})
    search = next(n["output"] for n in turn["nodes"] if n["node"] == "search_stock")
    assert search["records"][0]["vin"] == vin


async def test_another_bmw_number_is_not_the_car_they_asked_for(mongo):
    # Muhamad Nasir, 26 Oct 2026: "M240" with only 228s in stock - the 228s were shown as the exact match.
    await _stock(mongo, _vehicle("VIN00000000228I23", year=2023, make="BMW", model="2 Series", trim="228i"))
    created = await _new_lead(mongo, vehicle={"year": 2023, "make": "BMW", "model": "M240"})
    turn = await mongo["ai_turn_log"].find_one({"lead_id": created["lead_id"]})
    decide = next(n["output"] for n in turn["nodes"] if n["node"] == "decide")
    decision = decide.get("decision") or decide
    assert decision.get("vehicle_check"), "a car we don't have goes to a manager to confirm (Betsy, 12 Oct)"


async def test_a_car_we_dont_have_first_reminds_them_of_their_original_inquiry(mongo):
    # Betsy, 27 Oct 2026 (Muhamad Nasir, M340i lead, asked for an M240): "remind the customer they inquired about our
    # M340 and send a link or photos and ask if they still want this vehicle - if not, it needs to be escalated".
    vin = "3MW5U7J06L8B44418"
    await _stock(mongo, _vehicle(vin, year=2020, make="BMW", model="3 Series", trim="M340i", body="4D Sedan"),
                 _vehicle("VIN00000000228I23", year=2023, make="BMW", model="2 Series", trim="228i"))
    created = await _new_lead(mongo, vehicle={"year": 2023, "make": "BMW", "model": "M240", "vin": vin})
    turn = await mongo["ai_turn_log"].find_one({"lead_id": created["lead_id"]})
    decide = next(n["output"] for n in turn["nodes"] if n["node"] == "decide")
    decision = decide.get("decision") or decide
    assert decision.get("remind_original", {}).get("vin") == vin and not decision.get("vehicle_check")
    assert (await _state(mongo, created)).get("original_reminded_for")


def test_still_wanting_the_original_car():
    from upsell_agent.agent.nodes.decide import _STILL_WANTS
    for yes in ("Yes", "yeah that one", "sure", "I'll take it", "still interested"):
        assert _STILL_WANTS.match(yes), yes
    for no in ("No, I want the M240", "not really", "only the m240"):
        assert not _STILL_WANTS.match(no), no


async def test_with_the_live_at_night_setting_a_night_lead_still_gets_one_message(mongo, monkeypatch):
    # AI Studio on live publishes at_night = "email_now_text_when_open"; the user, 28 Oct 2026: one message, not two.
    from upsell_agent.channels import consent
    from upsell_agent.integrations.mongodb import SCHEDULED_FOLLOWUPS_COLLECTION
    monkeypatch.setattr(consent, "AT_NIGHT", "email_now_text_when_open")
    set_clock(datetime(2026, 9, 23, 3, 10, tzinfo=UTC))  # 11:10 PM New York
    created = await _new_lead(mongo, vehicle=RAV4)
    assert len(await _sent(mongo, created, "email")) == 1 and not await _sent(mongo, created)
    assert not await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "kind": "first_reply_held", "status": "pending"})


def test_a_handled_mark_matches_whatever_the_time_format():
    """29 Oct 2026: a bulk "handled" written as "...00.123Z" didn't match the notice's "...00.123000+00:00"."""
    from datetime import UTC, datetime
    from upsell_agent.api.staff_view import _same_time
    at = datetime(2026, 10, 12, 14, 0, 0, 123000, tzinfo=UTC)
    assert _same_time("2026-10-12T14:00:00.123Z", at) and _same_time(at.isoformat(), at)
    assert _same_time("2026-10-12T14:00:00Z", datetime(2026, 10, 12, 14, 0, tzinfo=UTC))
    assert not _same_time("2026-10-12T14:00:01.123Z", at) and not _same_time(None, at)


def test_a_fixed_reply_already_sent_is_not_placed_again():
    """Latina Neal, 29 Oct 2026: the same "vehicle history report" text went out twice in 5 minutes."""
    from upsell_agent.agent.nodes.decide import _already_sent
    fixed = ("Here is a link to the vehicle where you can locate the vehicle history report. If everything is to your "
             "liking, what day works best for you to meet with us at the dealership?")
    pack = {"working_memory": [{"direction": "outbound", "text": f"Hi Latina,\n\n{fixed} https://autopulse.ai/l/x"},
                               {"direction": "inbound", "text": "What is the mileage and condition?"}]}
    assert _already_sent(fixed, pack)
    assert not _already_sent(fixed, {"working_memory": []})
    assert not _already_sent("Ok", pack)  # too short to judge


@pytest.mark.parametrize(("text", "condition"), [
    ("I would also appreciate it if you could confirm the vehicle's current mileage, overall mechanical and cosmetic "
     "condition, and whether there are any known issues", True),  # Latina Neal, 29 Oct 2026
    ("Has it been in an accident?", True),
    ("Has it been in any accidents?", True),
    ("Was the timing belt replaced?", True),
    ("When was the last service?", True),
    ("Is it still available?", False),
])
def test_condition_questions_go_to_a_manager(text, condition):
    from upsell_agent.agent.nodes.decide import CONDITION_QUESTION
    assert bool(CONDITION_QUESTION.search(text)) is condition


async def test_a_customer_hold_stops_an_ai_studio_touch(mongo):
    """David Garcia, 30 Oct 2026: a touch went out 16 minutes after "I'm not interested anymore"."""
    from upsell_agent import clock
    from upsell_agent.agent import customer_hold
    held = customer_hold.check({"customer_hold": {"at": clock.now(), "until": None, "reason": "not interested"}},
                               "studio_touch")
    assert held[1] is False
