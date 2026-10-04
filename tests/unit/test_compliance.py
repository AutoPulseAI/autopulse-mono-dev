"""MASTER_PLAN_3 C1 (with B2 and B3): the send check `can_contact`, the
customer's time zone, inbound/outbound origin, natural-language opt-outs,
REVIEW, add-only consent and compliance records, and the campaign check queue.

Times are fixed: the dev dealer A is in New York, open Monday-Friday
9:00-19:00 (devtools/simulate.py). In September New York is UTC-4 and Los
Angeles UTC-7. Sept 22, 2026 is a Tuesday."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels import consent
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.compliance import send_checks
from upsell_agent.compliance.customer_zone import CONTINENTAL_ZONES, customer_zone
from upsell_agent.compliance.engine import can_contact
from upsell_agent.compliance.opt_out import (
    NL_CONFIRMATION,
    classify_keyword,
    confirmation_text,
    detect_opt_in,
    detect_opt_out,
)
from upsell_agent.compliance.origin import origin_from_records
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadResumedEvent
from upsell_agent.integrations.mongodb import (
    AI_COMPLIANCE_LOG_COLLECTION,
    AI_CONSENT_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_SEND_CHECKS_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink

NY = ZoneInfo("America/New_York")
DEALER = simulate.DEV_DEALERS[0]["_id"]


def ny(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 9, day, hour, minute, tzinfo=NY).astimezone(UTC)


@pytest.fixture
async def dealers(mongo):
    await simulate.ensure_platform_dealers()


def _deps() -> TurnDeps:
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(mongo, *, source=None, comments="Looking at a used Honda CR-V", zip_code="10001",
                opt_in=None, dealervault=False):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Cora Check",
                                         comments=comments)
    if source is not None:
        await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(created["lead_id"])},
                                                          {"$set": {"source": source, "lead_source": source}})
    await mongo[PLATFORM_CUSTOMERS_COLLECTION].update_one(
        {"_id": ObjectId(created["customer_id"])},
        {"$set": {"phones.0.sms_opt_in": opt_in, "dealervault_upload": dealervault}})
    if zip_code:
        await mongo[PLATFORM_DEALS_COLLECTION].insert_one(
            {"dealer_id": DEALER, "deal_number": str(ObjectId()), "customer_id": ObjectId(created["customer_id"]),
             "Zip": zip_code, "State": "XX"})
    return created


async def _check(created, *, channel="sms", purpose="marketing", is_reply=False, campaign=False, record=True):
    return await can_contact(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                             channel=channel, purpose=purpose, is_reply=is_reply, campaign=campaign, record=record)


# --- Customer time zone (B0.5) --------------------------------------------------------

async def test_zone_from_the_dealervault_zip(mongo, dealers):
    created = await _lead(mongo, zip_code="90012")
    zone = await customer_zone(dealer_scoped_db(DEALER), created["customer_id"], "+15550000000")
    assert zone.zones == ("America/Los_Angeles",) and zone.method == "zip" and zone.state == "CA"


async def test_zone_from_a_two_zone_state_keeps_both(mongo, dealers):
    created = await _lead(mongo, zip_code=None)
    await mongo[PLATFORM_DEALS_COLLECTION].insert_one(
        {"dealer_id": DEALER, "deal_number": "d-tx", "customer_id": ObjectId(created["customer_id"]), "State": "TX"})
    zone = await customer_zone(dealer_scoped_db(DEALER), created["customer_id"], None)
    assert zone.method == "state" and set(zone.zones) == {"America/Chicago", "America/Denver"}


async def test_zone_from_the_area_code_then_all_zones(mongo, dealers):
    created = await _lead(mongo, zip_code=None)
    db = dealer_scoped_db(DEALER)
    by_phone = await customer_zone(db, created["customer_id"], "+13105551234")
    assert by_phone.method == "area_code" and by_phone.zones == ("America/Los_Angeles",)
    unknown = await customer_zone(db, created["customer_id"], "+442071234567")
    assert unknown.method == "unknown" and unknown.zones == CONTINENTAL_ZONES


# --- Origin (B2) ----------------------------------------------------------------------------

@pytest.mark.parametrize(("lead", "customer", "from_campaign", "origin", "unmapped"), [
    ({"source": "AutoTrader"}, {}, False, "inbound", False),
    ({"source": "website"}, {"dealervault_upload": True}, False, "inbound", False),  # their own web form
    ({"source": "sms"}, {}, False, "inbound", False),                                 # they texted first
    ({"source": "campaign", "lead_source": "campaign_Spring"}, {}, False, "outbound", False),
    ({"source": "AutoTrader"}, {}, True, "outbound", False),                          # a campaign reply
    ({}, {"dealervault_upload": True}, False, "outbound", False),
    ({"source": "mystery-feed"}, {}, False, "outbound", True),
    ({}, {}, False, "outbound", True),
])
def test_origin_per_lead(lead, customer, from_campaign, origin, unmapped):
    result = origin_from_records(lead, customer, from_campaign=from_campaign)
    assert (result.origin, result.unmapped) == (origin, unmapped)


# --- Opt-out phrases (C1 item 3) ------------------------------------------------------------

@pytest.mark.parametrize(("text", "kind", "channels"), [
    ("STOP", "keyword", ("sms",)),
    ("Unsubscribe", "keyword", ("sms",)),
    ("please don't text me anymore", "phrase", ("sms",)),
    ("stop emailing me", "phrase", ("email",)),
    ("remove my number", "phrase", ("sms", "voice")),
    ("stop contacting me", "phrase", ("sms", "email", "voice")),
    ("Leave me alone!", "phrase", ("sms", "email", "voice")),
    ("take me off your list", "phrase", ("sms", "email", "voice")),
    ("no more messages", "phrase", ("sms", "email", "voice")),
])
def test_opt_outs(text, kind, channels):
    found = detect_opt_out(text, "sms")
    assert found and found.kind == kind and found.channels == channels
    assert found.confirm is (kind == "phrase")


@pytest.mark.parametrize("text", ["I'm not interested", "not right now", "Can I stop by Saturday?",
                                  "I don't want to stop by today", "Call me tomorrow"])
def test_objections_are_not_opt_outs(text):
    assert detect_opt_out(text, "sms") is None


# --- can_contact: the four outcomes ------------------------------------------------------

async def test_reply_in_a_conversation_the_customer_started_goes_at_any_hour(mongo, dealers):
    set_clock(ny(22, 23, 30))
    created = await _lead(mongo, source="AutoTrader")
    decision = await _check(created, is_reply=True)
    assert decision.outcome == "ALLOW" and not decision.quiet_hours and decision.origin["origin"] == "inbound"


async def test_reply_in_an_outbound_conversation_at_night_asks_nothing(mongo, dealers):
    set_clock(ny(22, 23, 30))
    created = await _lead(mongo, source="campaign")
    decision = await _check(created, is_reply=True)
    assert decision.outcome == "ALLOW" and decision.quiet_hours and decision.rule == "reply_quiet_hours"
    assert decision.resume_at == ny(23, 8)


async def test_followup_waits_for_the_customers_8am_and_the_dealer_open(mongo, dealers):
    set_clock(ny(22, 9, 30))  # 6:30 in Los Angeles
    created = await _lead(mongo, source="website", zip_code="90012")
    decision = await _check(created)
    assert decision.outcome == "HOLD" and decision.until == ny(22, 11)  # 8:00 Los Angeles
    # MASTER_PLAN_4 F1: California's own row (federal default), not the old interim 8:00-20:00.
    assert "outside CA: Mon-Fri 08:00-21:00" in decision.reason


async def test_unknown_zone_uses_the_hours_legal_everywhere(mongo, dealers):
    set_clock(ny(22, 10, 30))
    created = await _lead(mongo, source="website", zip_code=None)
    decision = await _check(created)
    # MASTER_PLAN_4 F1: no state, so the strictest row (Kentucky's 10:00 start) in every continental zone:
    # 10:00 Los Angeles.
    assert decision.outcome == "HOLD" and decision.until == ny(22, 13)
    assert decision.zone["method"] == "unknown"
    assert "STRICTEST" in decision.reason


async def test_campaign_to_a_dealervault_contact_without_consent_is_blocked(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="", dealervault=True)
    decision = await _check(created, campaign=True)
    assert decision.outcome == "BLOCK" and decision.rule == "no_consent"
    assert decision.origin["origin"] == "outbound"


async def test_platform_opt_in_flag_allows_a_campaign_and_is_kept_as_evidence(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="", dealervault=True, opt_in=True)
    decision = await _check(created, campaign=True)
    assert decision.outcome == "ALLOW" and decision.consent["source"] == "platform_sms_opt_in"
    [entry] = await mongo[AI_CONSENT_COLLECTION].find({"consent_type": "marketing_consent"}).to_list(None)
    assert entry["consent_status"] == "granted" and entry["consent_evidence_id"] == decision.consent["evidence_id"]


async def test_own_inquiry_covers_ai_followups_not_campaigns(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    assert (await _check(created)).outcome == "ALLOW"
    assert (await _check(created, campaign=True)).outcome == "BLOCK"


async def test_lead_form_opt_in_alone_needs_review(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="", dealervault=True, comments="TCPAOptIn: true; wants a truck")
    decision = await _check(created, campaign=True)
    assert decision.outcome == "REVIEW" and "CONSENT_REVIEW_REQUIRED" in decision.reason
    [entry] = await mongo[AI_CONSENT_COLLECTION].find({"consent_type": "marketing_consent"}).to_list(None)
    assert entry["consent_status"] == "review_required" and entry["evidence"]["quote"] == "TCPAOptIn: true"


async def test_lead_form_no_blocks_followups_but_the_reply_still_goes(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="AutoTrader", comments="TCPAOptIn: false; hello")
    assert (await _check(created)).rule == "explicit_no"
    assert (await _check(created, is_reply=True)).outcome == "ALLOW"
    assert (await _check(created, channel="email")).outcome == "ALLOW"


async def test_opt_out_blocks_what_we_start_but_not_replies(mongo, dealers):
    # Decisions 136-137: an opt-out stops everything the system starts; a reply to the
    # customer's own message is customer service and still goes, as does the one confirmation.
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    await consent.set_channel_consent(dealer_scoped_db(DEALER), created["customer_id"], "sms", False, "test")
    assert (await _check(created)).rule == "opted_out"
    assert (await _check(created, purpose="transactional")).rule == "opted_out"
    assert (await _check(created, purpose="reply", is_reply=True)).outcome == "ALLOW"
    assert (await _check(created, purpose="opt_out_confirmation", is_reply=True)).outcome == "ALLOW"
    # The other channel carries on (Omnichannel PDF: "continue every remaining permitted channel").
    assert (await _check(created, channel="email")).outcome == "ALLOW"


async def test_dnd_and_ai_voice_are_blocked(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    assert (await _check(created, channel="voice")).rule == "ai_voice_disabled"
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(created["lead_id"])},
                                                      {"$set": {"fe_lead_status": "DND"}})
    assert (await _check(created, is_reply=True)).rule == "do_not_contact"


async def test_frequency_cap_counts_every_allow_and_holds_the_fourth(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    for _ in range(3):
        assert (await _check(created)).outcome == "ALLOW"
    fourth = await _check(created)
    assert fourth.outcome == "HOLD" and fourth.frequency["sent_last_24h"] == 3
    assert abs((fourth.until - (ny(22, 12) + timedelta(hours=24))).total_seconds()) < 5
    # Transactional texts don't count toward the cap.
    assert (await _check(created, purpose="transactional")).outcome == "ALLOW"


async def test_email_has_no_time_rule(mongo, dealers):
    set_clock(ny(22, 23))
    created = await _lead(mongo, source="", dealervault=True)
    assert (await _check(created, channel="email", campaign=True)).outcome == "ALLOW"


async def test_marketing_stops_at_20_transactional_at_21(mongo, dealers):
    # Saturday 18:00 would be closed (17:00); use a Tuesday with the dealer open until 19:00.
    set_clock(ny(22, 18, 30))
    created = await _lead(mongo, source="website", zip_code="60601")  # Chicago: 17:30
    assert (await _check(created, purpose="transactional")).outcome == "ALLOW"
    assert (await _check(created)).outcome == "ALLOW"


async def test_every_decision_is_logged_add_only(mongo, dealers):
    set_clock(ny(22, 9, 30))
    created = await _lead(mongo, source="website", zip_code="90012")
    decision = await _check(created)
    [log] = await mongo[AI_COMPLIANCE_LOG_COLLECTION].find({}).to_list(None)
    assert str(log["_id"]) == decision.log_id and log["decision"] == "HOLD"
    for key in ("dealer_id", "customer_id", "channel", "purpose", "consent_evidence_id", "jurisdiction",
                "local_time", "dnc", "frequency", "decision", "decision_reason", "at"):
        assert key in log
    assert log["local_time"] == {"America/Los_Angeles": "Tue 06:30"}
    # A planning check isn't logged.
    await _check(created, record=False)
    assert await mongo[AI_COMPLIANCE_LOG_COLLECTION].count_documents({}) == 1


# --- Consent history (decision 77) -------------------------------------------------------

async def test_consent_changes_add_entries_and_never_edit_them(mongo, dealers):
    db = dealer_scoped_db(DEALER)
    await consent.set_channel_consent(db, "c1", "sms", False, "customer_stop")
    [first] = await mongo[AI_CONSENT_COLLECTION].find({}).to_list(None)
    set_clock(clock.now() + timedelta(minutes=1))
    await consent.set_channel_consent(db, "c1", "sms", True, "customer_start")
    entries = await mongo[AI_CONSENT_COLLECTION].find({}).sort("recorded_at", 1).to_list(None)
    assert entries[0] == first and [e["consent_status"] for e in entries] == ["opted_out", "opted_in"]
    assert not await consent.is_opted_out(db, "c1", "sms")


async def test_old_consent_documents_are_migrated(mongo):
    await mongo[AI_CONSENT_COLLECTION].insert_one(
        {"dealer_id": DEALER, "customer_id": "c9", "sms": {"allowed": False, "source": "customer_stop",
                                                           "at": clock.now()}})
    assert await consent.migrate_legacy_consent() == 1
    assert await consent.is_opted_out(dealer_scoped_db(DEALER), "c9", "sms")
    assert await mongo[AI_CONSENT_COLLECTION].count_documents({"consent_type": {"$exists": False}}) == 0


# --- In the conversation (handlers, turn) ------------------------------------------------

def _inbound(created, text, channel="sms"):
    message_id = str(ObjectId())
    return InboundMessageEvent(event_id=message_id, dealer_id=DEALER, customer_id=created["customer_id"],
                               lead_id=created["lead_id"], message_id=message_id, channel=channel, text=text,
                               received_at=clock.now())


async def test_a_general_opt_out_phrase_stops_every_channel_with_one_confirmation(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    result = await handlers.handle_inbound_message(_inbound(created, "Please stop contacting me"), _deps())
    assert result["status"] == "opted_out" and result["kind"] == "phrase"
    db = dealer_scoped_db(DEALER)
    for channel in ("sms", "email", "voice"):
        assert await consent.is_opted_out(db, created["customer_id"], channel)
    [sent] = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    assert sent["text"] == NL_CONFIRMATION and sent["channel"] == "sms"
    # The lead isn't silenced (decision 137): the opt-out entries do the stopping.
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["status"] != "opted_out"


async def test_a_channel_named_phrase_stops_only_that_channel(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    await handlers.handle_inbound_message(_inbound(created, "don't email me, text is fine", channel="sms"), _deps())
    db = dealer_scoped_db(DEALER)
    assert await consent.is_opted_out(db, created["customer_id"], "email")
    assert not await consent.is_opted_out(db, created["customer_id"], "sms")
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["status"] != "opted_out"


async def test_keyword_stop_gets_no_confirmation_from_us(mongo, dealers):
    created = await _lead(mongo, source="website")
    await handlers.handle_inbound_message(_inbound(created, "STOP"), _deps())
    assert await mongo[DEV_OUTBOX_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 0


async def test_possible_opt_out_opens_a_review_with_a_plain_reply(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    result = await handlers.handle_inbound_message(
        _inbound(created, "why do you keep texting me about cars?"), _deps())
    log = await mongo[AI_TURN_LOG_COLLECTION].find_one({"turn_id": result["turn_id"]})
    decide = next(n for n in log["nodes"] if n["node"] == "decide")
    assert decide["output"]["hold_questions"] and decide["output"]["asks"] == []
    assert "?" not in log["summary"]["reply"] and log["summary"]["review_opened"] is True
    db = dealer_scoped_db(DEALER)
    assert await consent.open_review(db, created["customer_id"])
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["staff_notice"]["kind"] == "possible_opt_out"
    # Marketing stops, and (PLAN_4 stream X1 item 3) so does every other automated text; a reply still goes.
    assert (await _check(created)).outcome == "REVIEW"
    assert (await _check(created, purpose="transactional")).outcome == "REVIEW"
    assert (await _check(created, purpose="reply", is_reply=True)).outcome == "ALLOW"

    # The customer writes again with something that isn't an opt-out: resolved.
    await handlers.handle_inbound_message(_inbound(created, "Actually, is the CR-V still there?"), _deps())
    assert not await consent.open_review(db, created["customer_id"])


async def test_an_admin_resume_resolves_the_review(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    await handlers.handle_inbound_message(_inbound(created, "I'm getting too many messages"), _deps())
    db = dealer_scoped_db(DEALER)
    assert await consent.open_review(db, created["customer_id"])
    await handlers.handle_lead_resumed(LeadResumedEvent(event_id="r1", dealer_id=DEALER, lead_id=created["lead_id"]))
    assert not await consent.open_review(db, created["customer_id"])


# --- The campaign check queue (decision 66) ----------------------------------------------

async def test_campaign_requests_get_an_answer_on_their_own_entry(mongo, dealers):
    set_clock(ny(22, 12))
    allowed = await _lead(mongo, source="", dealervault=True, opt_in=True)
    blocked = await _lead(mongo, source="", dealervault=True)
    for key, created in (("campaign:a:0", allowed), ("campaign:b:0", blocked)):
        await mongo[AI_SEND_CHECKS_COLLECTION].insert_one(
            {"request_key": key, "dealer_id": DEALER, "campaign_id": "camp1", "campaign_lead_id": key,
             "lead_id": created["lead_id"], "phone": None, "channel": "sms", "purpose": "marketing",
             "status": "pending", "requested_at": clock.now()})
    summary = await send_checks.answer_pending("test-worker")
    assert summary["answered"] == 2 and summary["ALLOW"] == 1 and summary["BLOCK"] == 1
    a = await mongo[AI_SEND_CHECKS_COLLECTION].find_one({"request_key": "campaign:a:0"})
    b = await mongo[AI_SEND_CHECKS_COLLECTION].find_one({"request_key": "campaign:b:0"})
    assert a["status"] == "answered" and a["decision"] == "ALLOW"
    assert b["decision"] == "BLOCK" and "consent" in b["reason"]
    # The ALLOW counts toward the cap straight away.
    log = await mongo[AI_COMPLIANCE_LOG_COLLECTION].find_one({"request_id": "campaign:a:0"})
    assert log["decision"] == "ALLOW" and log["campaign"] is True and log["source"] == "campaign"


async def test_a_campaign_outside_the_window_is_held(mongo, dealers):
    set_clock(ny(22, 21))
    created = await _lead(mongo, source="", dealervault=True, opt_in=True)
    await mongo[AI_SEND_CHECKS_COLLECTION].insert_one(
        {"request_key": "campaign:c:0", "dealer_id": DEALER, "lead_id": created["lead_id"], "channel": "sms",
         "purpose": "marketing", "status": "pending", "requested_at": clock.now()})
    await send_checks.answer_pending("test-worker")
    entry = await mongo[AI_SEND_CHECKS_COLLECTION].find_one({"request_key": "campaign:c:0"})
    assert entry["decision"] == "HOLD" and entry["until"].replace(tzinfo=UTC) == ny(23, 9)


# --- C1 extension (decisions 135-144) ------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("START", "start"), ("start", "start"), ("Unstop", "start"), ("YES", "start"), ("YES!", "start"),
    ("yes", None), ("Yes", None), ("yes please", None), ("STOP", "stop"),
])
def test_start_words_and_yes_only_in_capitals(text, expected):
    assert classify_keyword(text) == expected


@pytest.mark.parametrize("channels,text", [
    (("sms",), "Understood, we won't text you again."),
    (("email",), "Understood, we won't email you again."),
    (("voice",), "Understood, we won't call you again."),
    (("sms", "voice"), "Understood, we won't text or call you again."),
    (("sms", "email", "voice"), NL_CONFIRMATION),
])
def test_the_confirmation_says_only_what_was_stopped(channels, text):
    assert confirmation_text(channels) == text


@pytest.mark.parametrize("text,channels", [
    ("You can text me again", ("sms",)),
    ("ok you may now text me", ("sms",)),
    ("texts are fine", ("sms",)),
    ("you can email me again", ("email",)),
    ("emails are ok", ("email",)),
    ("you can call me again", ("voice",)),
    ("You can contact me again, I changed my mind", None),
    ("please opt me back in", None),
    ("resubscribe me", None),
])
def test_opt_in_phrases(text, channels):
    found = detect_opt_in(text)
    assert found is not None and found.channels == channels


@pytest.mark.parametrize("text", ["yes", "ok", "sure, text me the details", "you can't text me again",
                                  "I changed my mind about the color", "can you email me the price?"])
def test_answers_are_not_opt_ins(text):
    assert detect_opt_in(text) is None


async def test_a_reply_goes_out_after_an_opt_out_and_follow_ups_dont(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    await handlers.handle_inbound_message(_inbound(created, "don't text me"), _deps())
    [confirmation] = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    assert confirmation["text"] == "Understood, we won't text you again."
    later = await handlers.handle_inbound_message(_inbound(created, "Actually, is the CR-V still there?"), _deps())
    assert later["status"] == "done"
    sent = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    assert len(sent) == 2 and sent[1]["channel"] == "sms"
    # Still opted out: nothing the system starts goes by text.
    assert (await _check(created)).rule == "opted_out"
    assert await consent.is_opted_out(dealer_scoped_db(DEALER), created["customer_id"], "sms")


async def test_never_contact_me_is_every_channel_and_still_answers(mongo, dealers):
    # Decision 135: "do not contact" is the every-channel opt-out; decision 137: replies still go.
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    await handlers.handle_inbound_message(_inbound(created, "lose my number"), _deps())
    db = dealer_scoped_db(DEALER)
    for channel in ("sms", "email", "voice"):
        assert await consent.is_opted_out(db, created["customer_id"], channel)
    later = await handlers.handle_inbound_message(_inbound(created, "wait, one question first"), _deps())
    assert later["status"] == "done"


async def test_an_opt_in_phrase_reverses_its_channel_and_the_message_is_answered(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    db = dealer_scoped_db(DEALER)
    await handlers.handle_inbound_message(_inbound(created, "stop contacting me"), _deps())
    result = await handlers.handle_inbound_message(
        _inbound(created, "you can text me again, is the CR-V still there?"), _deps())
    assert result["status"] == "done"
    assert not await consent.is_opted_out(db, created["customer_id"], "sms")
    assert await consent.is_opted_out(db, created["customer_id"], "email")  # only the channel it named
    entry = await consent.latest_opt_out(db, created["customer_id"], "sms")
    assert entry["consent_source"] == "customer_opt_in_phrase" and entry["evidence"]["matched"]


async def test_a_general_opt_in_reverses_every_channel_but_not_an_email_unsubscribe(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    db = dealer_scoped_db(DEALER)
    await handlers.handle_inbound_message(_inbound(created, "don't text me"), _deps())
    await consent.set_channel_consent(db, created["customer_id"], "email", False, source="sendgrid_unsubscribe")
    await handlers.handle_inbound_message(_inbound(created, "you can contact me again"), _deps())
    assert not await consent.is_opted_out(db, created["customer_id"], "sms")
    # Decision 143: the email provider's unsubscribe stays (only its own link undoes it).
    assert await consent.is_opted_out(db, created["customer_id"], "email")


async def test_a_lowercase_yes_does_not_opt_back_in(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    db = dealer_scoped_db(DEALER)
    await handlers.handle_inbound_message(_inbound(created, "STOP"), _deps())
    await handlers.handle_inbound_message(_inbound(created, "yes"), _deps())
    assert await consent.is_opted_out(db, created["customer_id"], "sms")
    result = await handlers.handle_inbound_message(_inbound(created, "YES"), _deps())
    assert result["status"] == "opted_in" and not await consent.is_opted_out(db, created["customer_id"], "sms")


async def test_an_opt_out_is_kept_by_phone_for_a_reimported_customer(mongo, dealers):
    # Decision 140 (TCPA PDF §12: re-imported records don't erase suppression).
    db = dealer_scoped_db(DEALER)
    await consent.set_channel_consent(db, "old-customer", "sms", False, "customer_stop", address="(212) 555-0147")
    assert await consent.is_opted_out(db, "new-customer", "sms", "+12125550147")
    assert not await consent.is_opted_out(db, "new-customer", "sms", "+12125550148")
    assert not await consent.is_opted_out(db, "new-customer", "sms")
    await consent.set_channel_consent(db, "old-customer", "email", False, "sendgrid_unsubscribe",
                                      address="Cora@Example.com")
    assert await consent.is_opted_out(db, "new-customer", "email", "cora@example.com ")


async def test_the_platform_flag_never_regrants_consent_after_an_opt_out(mongo, dealers):
    # Decision 141: the platform sets sms_opt_in on any inbound text, even one after a STOP.
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="", dealervault=True, opt_in=True)
    assert (await _check(created, campaign=True)).outcome == "ALLOW"
    await handlers.handle_inbound_message(_inbound(created, "STOP"), _deps())
    db = dealer_scoped_db(DEALER)
    # Reversed by something other than the customer (here: a test entry): the flag still doesn't count.
    set_clock(ny(22, 12, 5))
    await consent.set_channel_consent(db, created["customer_id"], "sms", True, source="test_admin")
    assert (await _check(created, campaign=True)).rule == "no_consent"
    set_clock(ny(22, 12, 10))
    await consent.set_channel_consent(db, created["customer_id"], "sms", False, source="customer_stop")
    set_clock(ny(22, 12, 15))
    await handlers.handle_inbound_message(_inbound(created, "START"), _deps())
    allowed = await _check(created, campaign=True)
    assert allowed.outcome == "ALLOW" and allowed.consent["source"] == "customer_start"


async def test_leads_silenced_by_an_old_opt_out_are_made_active(mongo, dealers):
    created = await _lead(mongo, source="website")
    await mongo[AI_LEAD_STATE_COLLECTION].update_one(
        {"lead_id": created["lead_id"]}, {"$set": {"status": "opted_out"}}, upsert=True)
    assert await consent.migrate_silenced_opt_outs() == 1
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["status"] == "active"
    assert await consent.migrate_silenced_opt_outs() == 0
