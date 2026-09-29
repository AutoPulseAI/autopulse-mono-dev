"""The slot engine (MASTER_PLAN_1 Stage 7, architecture §8): validation,
required slots per lead type, the Decide rules, the fact store's history
rules, staleness, and pre-fill from Customer 360. All plain code."""

from datetime import UTC, datetime, timedelta

import pytest

from upsell_agent import clock
from upsell_agent.agent.qualification import FactSource, LeadType
from upsell_agent.integrations.mongodb import QUALIFICATION_FACTS_COLLECTION, dealer_scoped_db
from upsell_agent.slots.policy import Flags, next_action
from upsell_agent.slots.prefill import facts_from_360, prefill_from_360
from upsell_agent.slots.profile import build_profile
from upsell_agent.slots.requirements import lead_type_for
from upsell_agent.slots.schema import SCHEMA, SLOTS
from upsell_agent.slots.store import RefusedFact, current_facts, fact_history, save_fact
from upsell_agent.slots.validators import validate

DEALER = "66f0000000000000000000a1"
NOW = datetime(2026, 9, 25, 12, 0, tzinfo=UTC)


# --- schema & validators ------------------------------------------------------

def test_every_askable_slot_has_a_hint_and_unique_path():
    assert len({s.path for s in SLOTS}) == len(SLOTS)
    for slot in SLOTS:
        if slot.priority is not None:
            assert slot.ask_hint, slot.path
        if slot.kind == "enum":
            assert slot.choices, slot.path


@pytest.mark.parametrize(("path", "raw", "ok", "value"), [
    ("trade_in.year", "2019", True, 2019),
    ("trade_in.year", 1975, False, None),
    ("trade_in.year", "twenty nineteen", False, None),
    ("trade_in.mileage", "60k", True, 60000),
    ("trade_in.mileage", "60,000 miles", True, 60000),
    ("trade_in.mileage", 900_000, False, None),
    ("trade_in.payoff", "$8,500", True, 8500),
    ("trade_in.payoff", 0, True, 0),
    ("interest.budget", "35k", True, 35000),
    ("trade_in.has_trade", "yep", True, True),
    ("trade_in.has_trade", False, True, False),
    ("trade_in.has_trade", "maybe", False, None),
    ("interest.timeline", "asap", True, "now"),
    ("interest.timeline", "this_month", True, "this_month"),
    ("interest.timeline", "whenever", False, None),
    ("trade_in.condition", "like new", True, "excellent"),
    ("contact.best_time", "evenings", True, "evening"),
    ("interest.model", "  Toyota   RAV4 ", True, "Toyota RAV4"),
    ("interest.model", "x" * 81, False, None),
    ("vehicle.purchase_date", "2020-09-24T19:00:00+00:00", True, "2020-09-24"),
    ("interest.budget", "", False, None),
])
def test_validators(path, raw, ok, value):
    result = validate(SCHEMA[path], raw)
    assert result.ok is ok, result.reason
    if ok:
        assert result.value == value


# --- lead type ------------------------------------------------------------------

@pytest.mark.parametrize(("lead", "expected"), [
    (None, LeadType.GENERAL),
    ({"data": {"lead_type": "service"}, "source": "cargurus"}, LeadType.SERVICE),
    ({"source": "KBB Instant Cash Offer"}, LeadType.TRADE_IN),
    ({"source": "TrueCar SELL MY CAR"}, LeadType.TRADE_IN),
    ({"source": "CarGurus"}, LeadType.SALES),
    ({"source": "Capital One Auto Navigator", "lead_source": ""}, LeadType.SALES),
    ({"source": "service-scheduler"}, LeadType.SERVICE),
    ({"source": "sms"}, LeadType.GENERAL),
    ({"source": "email"}, LeadType.GENERAL),
])
def test_lead_type_from_source(lead, expected):
    assert lead_type_for(lead) == expected


# --- Decide, table-driven for every lead type ------------------------------------

def _fact(path, value, *, pending=False, age_days=0, source="bot_extracted"):
    at = NOW - timedelta(days=age_days)
    return {"_id": f"f-{path}", "path": path, "value": value, "pending": pending, "source": source,
            "valid_from": at, "observed_at": at}


def _profile(lead_type, *facts):
    return build_profile(lead_type, list(facts), now=NOW)


SALES_ALL = [_fact("interest.new_or_used", "new"), _fact("interest.model", "RAV4"), _fact("interest.budget", 35000),
             _fact("interest.timeline", "this_month"), _fact("trade_in.has_trade", False)]
TRADE_ALL = [_fact("trade_in.year", 2019), _fact("trade_in.make", "Honda"), _fact("trade_in.model", "Civic"),
             _fact("trade_in.mileage", 60000), _fact("trade_in.condition", "good"), _fact("trade_in.payoff", 8000)]
SERVICE_ALL = [_fact("vehicle.year", 2020), _fact("vehicle.make", "Subaru"), _fact("vehicle.model", "Outback"),
               _fact("vehicle.mileage", 54000), _fact("interest.service_needed", "oil change"),
               _fact("contact.best_time", "morning")]


@pytest.mark.parametrize(("lead_type", "facts", "action", "asked"), [
    # nothing filled: the two highest-priority requirements, two per message (MASTER_PLAN_3 Bq)
    (LeadType.SALES, [], "ask", ["interest.new_or_used", "interest.model"]),
    (LeadType.TRADE_IN, [], "ask", ["trade_in.year", "trade_in.make", "trade_in.model", "trade_in.mileage"]),
    # service leads: what they need first
    (LeadType.SERVICE, [], "ask", ["interest.service_needed", "vehicle.year", "vehicle.make", "vehicle.model"]),
    (LeadType.GENERAL, [], "ask", ["interest.lead_type"]),
    # partly filled: the next missing ones, budget OR payment as one requirement
    (LeadType.SALES, SALES_ALL[:2], "ask", ["interest.budget", "interest.monthly_payment", "interest.timeline"]),
    (LeadType.TRADE_IN, TRADE_ALL[:4], "ask", ["trade_in.condition", "trade_in.payoff"]),
    # everything filled
    (LeadType.SALES, SALES_ALL, "qualified", []),
    (LeadType.TRADE_IN, TRADE_ALL, "qualified", []),
    (LeadType.SERVICE, SERVICE_ALL, "qualified", []),
    # a monthly payment satisfies the budget requirement
    (LeadType.SALES, [*SALES_ALL[:2], _fact("interest.monthly_payment", 450), *SALES_ALL[3:]], "qualified", []),
    # has a trade: the trade-in details become required
    (LeadType.SALES, [*SALES_ALL[:4], _fact("trade_in.has_trade", True)], "ask",
     ["trade_in.year", "trade_in.make", "trade_in.model", "trade_in.mileage"]),
    (LeadType.SALES, [*SALES_ALL[:4], _fact("trade_in.has_trade", True), *TRADE_ALL], "qualified", []),
    # general lead that told us it's here for service takes the service list
    (LeadType.GENERAL, [_fact("interest.lead_type", "service"), *SERVICE_ALL], "qualified", []),
    (LeadType.GENERAL, [_fact("interest.lead_type", "service")], "ask",
     ["interest.service_needed", "vehicle.year", "vehicle.make", "vehicle.model"]),
    # stale counts as missing
    (LeadType.TRADE_IN, [*TRADE_ALL[:3], _fact("trade_in.mileage", 60000, age_days=45), *TRADE_ALL[4:]], "ask",
     ["trade_in.mileage"]),
    # a value waiting for confirmation comes first
    (LeadType.SALES, [*SALES_ALL[:4], _fact("trade_in.has_trade", False, pending=True)], "confirm",
     ["trade_in.has_trade"]),
])
def test_decide(lead_type, facts, action, asked):
    decision = next_action(_profile(lead_type, *facts), Flags())
    assert decision["action"] == action
    assert decision["slots"] == asked


def test_decide_rule_order_stop_beats_handoff_beats_everything():
    profile = _profile(LeadType.SALES)
    assert next_action(profile, Flags(opted_out=True, wants_human=True))["action"] == "stop"
    assert next_action(profile, Flags(wants_human=True))["action"] == "handoff"
    assert next_action(profile, Flags(upset=True, upset_confidence=0.9))["action"] == "handoff"
    # MASTER_PLAN_2 Phase 4: one ambiguous message or frustration with the bot isn't a handoff.
    assert next_action(profile, Flags(upset=True, upset_confidence=0.6))["action"] != "handoff"
    assert next_action(profile, Flags(annoyed_at_bot=True))["action"] != "handoff"
    rules = next_action(profile, Flags(wants_human=True))["rules"]
    # 10 rules since MASTER_PLAN_3 B4 added offer_visit between confirm and ask.
    assert [r["result"] for r in rules] == ["no", "fired"] + ["skipped"] * 8


def test_decide_is_deterministic_and_passes_questions_through():
    profile = _profile(LeadType.SALES, *SALES_ALL[:2])
    flags = Flags(questions=[{"text": "Is it AWD?", "label": "answerable"}])
    assert next_action(profile, flags) == next_action(profile, flags)
    assert next_action(profile, flags)["answer_questions"] == [{"text": "Is it AWD?", "label": "answerable"}]
    assert next_action(profile, flags)["required_filled"] == 2 and next_action(profile, flags)["required_total"] == 5


def test_at_most_two_requirements_are_asked_per_message():
    decision = next_action(_profile(LeadType.SALES), Flags())
    assert len(decision["asks"]) == 2


def test_offer_visit_carries_no_bonus_ask():
    # decision 107, revised: the offer used to come with one extra required-slot
    # question stacked on ("Let's arrange a time... Do you have a trade-in?");
    # a customer mid-conversation about the offer found that confusing. The
    # offer is now the whole reply.
    profile = _profile(LeadType.SALES, *SALES_ALL[:4])  # trade-in still missing
    decision = next_action(profile, Flags(visit_offer={"attempt": 1, "why": "Offering a visit"}))
    assert decision["action"] == "offer_visit" and decision["asks"] == []


def test_answering_a_question_while_a_visit_is_pending_carries_no_bonus_ask():
    # The customer asked "thursday what date?" about a visit offer that's still
    # awaiting their pick (held over one reply): the reply should answer that
    # and stop there, not also ask about a trade-in.
    profile = _profile(LeadType.SALES, *SALES_ALL[:4])
    flags = Flags(questions=[{"text": "thursday what date?", "label": "clarify"}], visit_pending=True)
    decision = next_action(profile, flags)
    assert decision["action"] == "answer" and decision["asks"] == []


def test_answering_a_question_with_no_visit_pending_still_asks():
    # Same shape, but nothing about a visit is open: the usual bonus ask applies.
    profile = _profile(LeadType.SALES, *SALES_ALL[:4])
    flags = Flags(questions=[{"text": "what colors do you have?", "label": "answerable"}], visit_pending=False)
    decision = next_action(profile, flags)
    assert decision["action"] == "answer" and decision["asks"] != []


# --- profile ---------------------------------------------------------------------

def test_profile_states_and_api_shape():
    profile = _profile(LeadType.TRADE_IN, _fact("trade_in.year", 2019),
                       _fact("trade_in.mileage", 60000, age_days=45), _fact("trade_in.payoff", 8000, pending=True),
                       _fact("vehicle.make", "Honda", source="tool_verified"))
    states = {path: slot.state for path, slot in profile.slots.items()}
    assert states == {"trade_in.year": "filled", "trade_in.mileage": "stale", "trade_in.payoff": "needs_confirming",
                      "vehicle.make": "filled"}
    api = profile.to_api()
    rows = {r["path"]: r for r in api["slots"]}
    assert rows["vehicle.make"]["source"] == "platform" and rows["trade_in.year"]["source"] == "customer"
    assert rows["trade_in.make"]["state"] == "missing"
    assert api["required"] == {"filled": 0, "total": 4}
    assert api["groups"][0]["id"] == "interest"


# --- fact store --------------------------------------------------------------------

async def test_new_value_replaces_old_and_keeps_history(mongo):
    db = dealer_scoped_db(DEALER)
    first = await save_fact(db, customer_id="c1", lead_id="l1", path="trade_in.mileage", value=60000,
                            source=FactSource.BOT_EXTRACTED, source_message_id="m1")
    second = await save_fact(db, customer_id="c1", lead_id="l1", path="trade_in.mileage", value=62000,
                             source=FactSource.BOT_EXTRACTED, source_message_id="m2")
    assert first.changed and second.changed
    [current] = [f for f in await current_facts(db, "c1", "l1") if f["path"] == "trade_in.mileage"]
    assert current["value"] == 62000
    [old] = await fact_history(db, "c1", "l1")
    assert old["value"] == 60000 and old["replaced_by"] == second.id and old["valid_to"] is not None


async def test_restating_a_value_refreshes_it_and_clears_pending(mongo):
    db = dealer_scoped_db(DEALER)
    await save_fact(db, customer_id="c1", lead_id="l1", path="trade_in.payoff", value=8000,
                    source=FactSource.BOT_EXTRACTED, source_message_id="m1", pending=True)
    again = await save_fact(db, customer_id="c1", lead_id="l1", path="trade_in.payoff", value=8000,
                            source=FactSource.BOT_EXTRACTED, source_message_id="m2")
    assert not again.changed
    [fact] = await current_facts(db, "c1", "l1")
    assert fact["pending"] is False
    assert await mongo[QUALIFICATION_FACTS_COLLECTION].count_documents({}) == 1


async def test_ai_guesses_and_unlinked_extractions_are_refused(mongo):
    db = dealer_scoped_db(DEALER)
    with pytest.raises(RefusedFact):
        await save_fact(db, customer_id="c1", lead_id="l1", path="trade_in.payoff", value=1,
                        source=FactSource.BOT_INFERRED)
    with pytest.raises(RefusedFact):
        await save_fact(db, customer_id="c1", lead_id="l1", path="trade_in.payoff", value=1,
                        source=FactSource.BOT_EXTRACTED)
    with pytest.raises(RefusedFact):
        await save_fact(db, customer_id="c1", lead_id="l1", path="not.a.slot", value=1,
                        source=FactSource.TOOL_VERIFIED)


async def test_lead_scope_slots_belong_to_one_lead_customer_scope_to_all(mongo):
    db = dealer_scoped_db(DEALER)
    await save_fact(db, customer_id="c1", lead_id="lead-1", path="interest.model", value="RAV4",
                    source=FactSource.BOT_EXTRACTED, source_message_id="m1")
    await save_fact(db, customer_id="c1", lead_id="lead-1", path="trade_in.year", value=2019,
                    source=FactSource.BOT_EXTRACTED, source_message_id="m1")
    other_lead = {f["path"] for f in await current_facts(db, "c1", "lead-2")}
    assert other_lead == {"trade_in.year"}


# --- pre-fill --------------------------------------------------------------------

DATA_360 = {
    "customer": {"preferred_communication_mode": "sms"},
    "vehicles": [{"vin": "V1", "year": 2019, "make": "Honda", "model": "Civic", "is_current_owner": True}],
    "deals": [{"vin": "V1", "computed_date": "2020-09-24T19:00:00.000Z"}],
    "repair_orders": [{"computed_date": "2025-01-10T00:00:00.000Z"}, {"computed_date": "2026-03-01T00:00:00.000Z"}],
    "appointments": [{"computed_date": "2099-01-01T09:00:00.000Z"}],
    "trade_ins": [{"year": 2019, "make": "Honda", "model": "Civic", "miles": 60000, "condition": "good",
                   "status": "open"}],
}


def test_facts_from_360():
    found = facts_from_360(DATA_360, now=NOW)
    assert found == {
        "vehicle.year": 2019, "vehicle.make": "Honda", "vehicle.model": "Civic",
        "vehicle.purchase_date": "2020-09-24", "vehicle.purchased_from": "this dealership",
        "service.last_visit": "2026-03-01", "appointment.next_date": "2099-01-01",
        "trade_in.year": 2019, "trade_in.make": "Honda", "trade_in.model": "Civic", "trade_in.mileage": 60000,
        "trade_in.condition": "good", "contact.preferred_channel": "sms",
    }


async def test_prefill_saves_platform_facts_but_never_overwrites_the_customer(mongo):
    clock.set_offset((NOW - clock.now()).total_seconds())
    db = dealer_scoped_db(DEALER)
    await save_fact(db, customer_id="c1", lead_id="l1", path="trade_in.mileage", value=65000,
                    source=FactSource.BOT_EXTRACTED, source_message_id="m1")
    added = await prefill_from_360(db, customer_id="c1", lead_id="l1", data=DATA_360)
    assert "trade_in.mileage" not in {a["path"] for a in added}
    facts = {f["path"]: f for f in await current_facts(db, "c1", "l1")}
    assert facts["trade_in.mileage"]["value"] == 65000
    assert facts["vehicle.make"]["source"] == "tool_verified"
    assert await prefill_from_360(db, customer_id="c1", lead_id="l1", data=None) == []
