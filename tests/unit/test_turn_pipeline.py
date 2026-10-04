"""The real turn pipeline (MASTER_PLAN_1 Stages 7-9): load context with
Customer 360 pre-fill, AI extract (offline model), validate, decide, AI
compose, guard with one rewrite, template fallbacks, the turn deadline, the
AI-call budget, lead status, and campaign replies. Runs the actual LangGraph
graph end to end."""

from datetime import UTC, datetime, timedelta

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent.turn import TurnDeps, run_turn
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    QUALIFICATION_FACTS_COLLECTION,
)
from upsell_agent.observability.trace import MemoryTraceSink

# MASTER_PLAN_3 B1: these first replies are the in-hours kind.
pytestmark = pytest.mark.usefixtures("during_opening_hours")

DEALER = simulate.DEV_DEALERS[0]["_id"]
OTHER = simulate.DEV_DEALERS[1]["_id"]
AI_PATH = ["load_context", "extract", "validate", "search_stock", "decide", "compose", "guard", "send", "schedule"]


def _settings(**overrides):
    return make_settings("DEV").model_copy(update=overrides)


async def _lead(lead_type="sales", channel="sms", comments="hi", history=None, name="Maria Test"):
    return await simulate.create_lead(DEALER, lead_type=lead_type, channel=channel, name=name, comments=comments,
                                      history=history)


async def _turn(created, text, *, trigger="inbound_message", channel="sms", settings=None, sink=None):
    return await run_turn(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                          trigger=trigger, channel=channel, inbound_text=text, shadow=False,
                          deps=TurnDeps(settings=settings or _settings(), sink=sink or MemoryTraceSink()),
                          source_message_id=f"msg-{ObjectId()}")


def _done(log):
    return [n["node"] for n in log["nodes"] if n["status"] == "done"]


def _node(log, name, attempt=None):
    nodes = [n for n in log["nodes"] if n["node"] == name and n["status"] == "done"]
    return nodes[-1] if attempt is None else nodes[attempt - 1]


async def _facts(mongo, created):
    return {f["path"]: f for f in await mongo[QUALIFICATION_FACTS_COLLECTION].find(
        {"customer_id": created["customer_id"], "valid_to": None}).to_list(None)}


# --- Stage 8: first reply through the AI -------------------------------------------

async def test_first_reply_runs_the_ai_pipeline_on_the_lead_comments(mongo):
    created = await _lead(comments="Hi, I want a new Toyota RAV4")
    log = await _turn(created, "Hi, I want a new Toyota RAV4", trigger="lead_created")
    assert _done(log) == AI_PATH
    assert log["outcome"] == "ask"
    # two asks per message (MASTER_PLAN_3 Bq): one detail, plus Touch 1's own closing question
    # ("what are you driving now?", MASTER_PLAN_3 C4 - the client's required ending, decision 34 reversed)
    assert log["summary"]["asked"] == ["interest.budget", "interest.monthly_payment", "trade_in.has_trade"]
    facts = await _facts(mongo, created)
    assert facts["interest.new_or_used"]["value"] == "new"
    assert facts["interest.model"]["value"] == "Toyota RAV4"
    assert facts["interest.model"]["source"] == "bot_extracted" and facts["interest.model"]["source_message_id"]
    outbox = await mongo[DEV_OUTBOX_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert "how much would you like to spend" in outbox["text"]


async def test_template_mode_skips_the_ai(mongo):
    created = await _lead()
    log = await _turn(created, "hi", trigger="lead_created", settings=_settings(first_reply_mode="template"))
    assert _done(log) == ["load_context", "fallback", "send", "schedule"]
    assert log["outcome"] == "template_reply" and log["summary"]["ai_calls"] == 0


# --- Stage 7/8: qualifying over a conversation ----------------------------------

async def test_sales_lead_is_qualified_over_a_chat(mongo):
    """MASTER_PLAN_3 B4: once the model and roughly when are both known (here,
    turn 2), a visit is offered before trade-in or anything else is asked -
    qualified/partly_qualified only apply once the offer is resolved
    (declined 3 times, or booked). See tests/unit/test_visit_offer.py and
    test_booking_tool.py for the offer/decline/booking flow itself."""
    created = await _lead(comments="Looking for a new Toyota RAV4")
    await _turn(created, "Looking for a new Toyota RAV4", trigger="lead_created")
    second = await _turn(created, "My budget is $35,000 and I'd like to buy this month")
    assert second["outcome"] == "offer_visit"
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}
    assert state["conversation"]["visit"]["attempts"] == 1
    assert state["required"] == {"filled": 4, "total": 5}


async def test_trade_in_lead_qualifies_from_one_detailed_message(mongo):
    created = await _lead(lead_type="trade_in")
    log = await _turn(created, "It's a 2019 Honda Civic with 60,000 miles, good condition, I owe $8,000 on it")
    # PLAN_4 stream X3 item 2: the payoff they gave is itself a reason to come in, so the fully answered lead is
    # offered a visit built on it (before: "qualified" and passed to the team with no ask).
    assert log["outcome"] == "offer_visit"
    assert "$8,000 payoff" in log["summary"]["reply"]
    facts = await _facts(mongo, created)
    assert {p: facts[p]["value"] for p in ("trade_in.year", "trade_in.make", "trade_in.model", "trade_in.mileage",
                                            "trade_in.condition", "trade_in.payoff")} == {
        "trade_in.year": 2019, "trade_in.make": "Honda", "trade_in.model": "Civic", "trade_in.mileage": 60000,
        "trade_in.condition": "good", "trade_in.payoff": 8000}


async def test_a_hedged_value_is_confirmed_before_it_is_relied_on(mongo):
    created = await _lead(lead_type="trade_in")
    first = await _turn(created, "It's a 2019 Honda Civic with about 60,000 miles")
    # The confirmation, plus one ask (MASTER_PLAN_3 Bq: a confirmation counts as one of the two).
    assert first["outcome"] == "confirm" and first["summary"]["asked"] == ["trade_in.mileage", "trade_in.condition"]
    assert (await _facts(mongo, created))["trade_in.mileage"]["pending"] is True
    second = await _turn(created, "Yes, that's right")
    assert _node(second, "validate")["output"]["confirmed"] == ["trade_in.mileage"]
    assert (await _facts(mongo, created))["trade_in.mileage"]["pending"] is False
    assert second["outcome"] == "ask"


async def test_saying_no_to_a_confirmation_drops_the_value(mongo):
    created = await _lead(lead_type="trade_in")
    await _turn(created, "It's a 2019 Honda Civic with about 60,000 miles")
    second = await _turn(created, "No")
    assert _node(second, "validate")["output"]["dropped"] == ["trade_in.mileage"]
    assert "trade_in.mileage" not in await _facts(mongo, created)


async def test_a_value_the_customer_never_said_is_rejected_and_not_saved(mongo):
    created = await _lead(lead_type="trade_in")
    log = await _turn(created, "My 2018 Honda #reject")
    [rejected] = _node(log, "validate")["output"]["rejected"]
    assert rejected["path"] == "trade_in.payoff" and rejected["checks"]["quote_found"] is False
    assert "trade_in.payoff" not in await _facts(mongo, created)


async def test_prefill_from_customer_360_on_the_first_turn(mongo):
    history = {"vehicles": [{"vin": "DEVPIPE0000000001", "year": 2020, "make": "Subaru", "model": "Outback"}],
               "deals": [{"vin": "DEVPIPE0000000001", "years_ago": 4, "price": 29500, "salesperson": "Pat"}]}
    created = await _lead(lead_type="service", history=history)
    log = await _turn(created, "Need an oil change")
    prefilled = {p["path"] for p in _node(log, "load_context")["output"]["prefilled"]}
    assert {"vehicle.year", "vehicle.make", "vehicle.model", "vehicle.purchase_date"} <= prefilled
    facts = await _facts(mongo, created)
    assert facts["vehicle.make"]["source"] == "tool_verified"
    # Vehicle known from the platform, service from the customer: only mileage and time remain.
    assert log["summary"]["asked"] == ["vehicle.mileage", "contact.best_time"]  # two asks per message
    again = await _turn(created, "About 54k miles")
    assert _node(again, "load_context")["output"]["prefilled"] == []  # only once per lead


# --- Stage 8: handoff, guard, fallbacks, limits --------------------------------------

async def test_asking_for_a_person_hands_the_lead_off(mongo):
    created = await _lead()
    log = await _turn(created, "Can a real person call me instead?")
    assert log["outcome"] == "handoff"
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}
    # PLAN_4 stream H: they said how ("call me"), so the handoff says it too.
    assert state["status"] == "handoff" and state["status_reason"] == "Customer asked for a person - wants a call"


async def test_guard_rejection_gets_one_rewrite(mongo):
    created = await _lead(lead_type="trade_in")
    sink = MemoryTraceSink()
    log = await _turn(created, "It has 80k miles #retry", sink=sink)
    first, second = _node(log, "guard", 1), _node(log, "guard", 2)
    assert first["output"]["passed"] is False and "numbers the customer never gave us" in first["output"]["violations"][0]
    assert second["output"]["passed"] is True
    assert _node(log, "compose", 2)["input"]["guard_feedback"]
    assert log["summary"]["send_status"] == "sent" and "fallback" not in _done(log)
    assert [e["type"] for e in sink.events].count("node_retry") == 1


async def test_second_guard_failure_sends_the_template_and_flags_a_human(mongo):
    # PLAN_4 stream Q: one double rejection sends the safe template and the AI carries on; a second fallback in
    # a row hands the lead to staff.
    created = await _lead()
    log = await _turn(created, "hello #fallback")
    assert log["outcome"] == "fallback" and "fallback" in _done(log)
    assert log["summary"]["flag_human"] is False
    outbox = await mongo[DEV_OUTBOX_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert "$" not in outbox["text"] and "guarantee" not in outbox["text"].lower()
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}
    assert state["status"] != "handoff" and state["conversation"]["fallbacks_in_a_row"] == 1
    log = await _turn(created, "hello again #fallback")
    assert log["outcome"] == "fallback" and log["summary"]["flag_human"] is True
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}
    assert state["status"] == "handoff" and state["status_reason"] == "AI couldn't write a safe reply"


async def test_a_slow_model_hits_the_turn_deadline_and_the_template_goes_out(mongo):
    created = await _lead()
    log = await _turn(created, "hello #slow", settings=_settings(reply_deadline_s=0.5, extract_timeout_s=5))
    assert log["outcome"] == "fallback"
    assert "limit" in log["summary"]["fallback_reason"]
    assert log["summary"]["send_status"] == "sent"


async def test_extract_timing_out_routes_to_the_template(mongo):
    created = await _lead()
    log = await _turn(created, "hello #slow", settings=_settings(extract_timeout_s=0.2))
    assert _done(log) == ["load_context", "extract", "fallback", "send", "schedule"]
    assert log["summary"]["fallback_reason"].startswith("extract failed")


async def test_the_ai_call_budget_is_enforced(mongo):
    created = await _lead(lead_type="trade_in")
    log = await _turn(created, "It has 80k miles #retry", settings=_settings(max_ai_calls_per_turn=2))
    assert log["summary"]["ai_calls"] == 2
    assert log["outcome"] == "fallback" and "AI calls" in log["summary"]["fallback_reason"]


async def test_email_reply_and_model_metrics(mongo):
    created = await _lead(channel="email")
    log = await _turn(created, "I want a used Ford", channel="email")
    assert log["summary"]["reply"].startswith("Hi Maria,")
    assert _node(log, "extract")["metrics"]["model"] == "offline"
    assert log["summary"]["ai_calls"] == 2 and log["summary"]["tokens_in"] > 0
    outbox = await mongo[DEV_OUTBOX_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert outbox["channel"] == "email" and outbox["subject"] == "Your inquiry"


# --- Stage 9: campaign replies ----------------------------------------------------

# A campaign reply is an outbound conversation: at night it asks nothing and
# says the team picks up at 8:00 (MASTER_PLAN_3 C1, architecture decision 29).
# These tests run at a fixed Tuesday 10:00 in New York.
CAMPAIGN_DAYTIME = datetime(2026, 9, 22, 14, 0, tzinfo=UTC)


async def _campaign(created, *, dealer=DEALER, days_ago=1, name="Spring Service Event"):
    from upsell_agent.integrations.mongodb import get_db
    campaign_id = ObjectId()
    await get_db()["campaigns"].insert_one({
        "_id": campaign_id, "name": name, "description": "Book spring maintenance", "message_type": "sms",
        "dealer_id": ObjectId(dealer), "message_content": {"subject": "", "body": "20% off maintenance - reply to book!"}})
    await get_db()["campaignleads"].insert_one({
        "campaign_id": str(campaign_id), "lead_id": ObjectId(created["lead_id"]), "dealer_id": dealer,
        "status": "sent", "sent_at": clock.now() - timedelta(days=days_ago), "name": "x"})
    return str(campaign_id)


async def test_a_reply_to_a_campaign_is_answered_in_its_context(mongo, ny_customer):
    set_clock(CAMPAIGN_DAYTIME)
    created = await _lead(lead_type="service")
    campaign_id = await _campaign(created)
    log = await _turn(created, "Yes please, can I book an oil change?")
    campaign = _node(log, "load_context")["output"]["campaign"]
    assert campaign["campaign_id"] == campaign_id and campaign["body"].startswith("20% off")
    assert _node(log, "compose")["input"]["campaign"]["name"] == "Spring Service Event"
    assert "Spring Service Event" in log["summary"]["reply"]
    assert log["summary"]["campaign_id"] == campaign_id

    # We've answered now: the next reply is a reply to us, not to the campaign.
    later = await _turn(created, "Saturday morning works")
    assert _node(later, "load_context")["output"]["campaign"] is None


async def test_a_campaign_named_after_a_model_with_digits_passes_the_guard(mongo, ny_customer):
    set_clock(CAMPAIGN_DAYTIME)
    # Burst test finding (Stage 12): "RAV4" was read as an invented number 4,
    # so every reply to this campaign failed the guard twice, went out as the
    # template and handed the lead to a person.
    created = await _lead()
    await _campaign(created, name="Spring RAV4 & CX-5 Event")
    log = await _turn(created, "Interested")
    assert _node(log, "guard")["output"]["passed"] is True
    assert log["outcome"] != "fallback" and not log["summary"]["flag_human"]
    assert "RAV4" in log["summary"]["reply"]
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["status"] != "handoff"


async def test_old_or_other_dealers_campaigns_are_ignored(mongo):
    created = await _lead()
    await _campaign(created, days_ago=20)
    log = await _turn(created, "hi")
    assert _node(log, "load_context")["output"]["campaign"] is None

    created_b = await _lead(name="Other Dealer Customer")
    await _campaign(created_b, dealer=OTHER)  # campaign record belongs to another dealer
    log = await _turn(created_b, "hi")
    assert _node(log, "load_context")["output"]["campaign"] is None


async def test_turn_log_is_saved_under_the_right_dealer(mongo):
    created = await _lead()
    await _turn(created, "I want a new Toyota")
    assert await mongo[AI_TURN_LOG_COLLECTION].count_documents({"dealer_id": DEALER}) == 1
    assert await mongo[AI_TURN_LOG_COLLECTION].count_documents({"dealer_id": OTHER}) == 0
