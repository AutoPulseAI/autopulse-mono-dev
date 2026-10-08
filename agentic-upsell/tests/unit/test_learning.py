"""PLAN_4 stream L: the AI Learning & Optimization Engine (client blueprint
box 5) - touch outcome tracking, the learned angle / wording / send time,
verified price drops, original new/used, and the engagement report."""

import random
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient

from tests.unit.conftest import make_settings, set_clock
from tests.unit.test_cadence import (
    DEALER,
    _fire_next_touch,
    _new_lead,
    _outbox,
    _pending_touches,
    _say,
    _state,
    live_dealer,  # noqa: F401 - the fixture pytestmark_flow uses
    pytestmark_flow,
)
from upsell_agent import clock
from upsell_agent.agent import cadence, lead_bucket, lifecycle
from upsell_agent.agent.cadence import CadenceState
from upsell_agent.channels.sender import SendOutcome
from upsell_agent.guardrails.draft_guard import check_draft
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_PRICE_SNAPSHOTS_COLLECTION,
    AI_TOUCHES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_VEHICLES_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.learning import bandit, insights, optimizer, price_watch, touches, variants

NY = ZoneInfo("America/New_York")


def _sent(channel="sms", status="sent"):
    return SendOutcome(status=status, idempotency_key=f"x:{channel}", channel=channel)


# --- The chooser (pure) ----------------------------------------------------------------------------------------

def test_with_too_little_data_the_default_is_kept_and_tests_split_evenly():
    levels = [("all leads", {"a": (bandit.ArmStats(5, 1), bandit.ArmStats()),
                             "b": (bandit.ArmStats(5, 4), bandit.ArmStats())})]
    pick = bandit.choose(["a", "b"], levels, random.Random(1), default="a")
    assert pick.option == "a" and pick.method == "default" and "not enough data" in pick.why
    picks = {bandit.choose(["a", "b"], levels, random.Random(seed)).option for seed in range(20)}
    assert picks == {"a", "b"}  # the A/B assignment: both get used
    assert bandit.choose(["a", "b"], levels, random.Random(1)).method == "split"


def test_with_enough_data_the_option_that_gets_replies_wins_most_of_the_time():
    levels = [("all leads", {"a": (bandit.ArmStats(100, 10), bandit.ArmStats()),
                             "b": (bandit.ArmStats(100, 40), bandit.ArmStats())})]
    picks = [bandit.choose(["a", "b"], levels, random.Random(seed), default="a").option for seed in range(200)]
    assert picks.count("b") > 190
    pick = bandit.choose(["a", "b"], levels, random.Random(3), default="a")
    assert pick.method == "learned" and pick.scores["b"]["expected_rate"] > pick.scores["a"]["expected_rate"]


def test_the_same_seed_gives_the_same_decision():
    levels = [("all leads", {"a": (bandit.ArmStats(40, 12), bandit.ArmStats()),
                             "b": (bandit.ArmStats(40, 13), bandit.ArmStats())})]
    assert len({bandit.choose(["a", "b"], levels, random.Random("lead-1:9")).option for _ in range(10)}) == 1


def test_the_platform_prior_counts_as_at_most_twenty_touches():
    alpha, beta = bandit.posterior(bandit.ArmStats(), bandit.ArmStats(10_000, 5_000))
    assert alpha + beta == pytest.approx(22)  # Beta(1,1) + 20 pseudo-touches
    alpha, beta = bandit.posterior(bandit.ArmStats(10, 9), bandit.ArmStats())
    assert (alpha, beta) == (10, 2)


def test_the_most_specific_context_with_enough_data_is_used():
    narrow = {"a": (bandit.ArmStats(40, 30), bandit.ArmStats()), "b": (bandit.ArmStats(40, 2), bandit.ArmStats())}
    broad = {"a": (bandit.ArmStats(400, 4), bandit.ArmStats()), "b": (bandit.ArmStats(400, 300), bandit.ArmStats())}
    pick = bandit.choose(["a", "b"], [("leads like this one", narrow), ("all leads", broad)], random.Random(0))
    assert pick.option == "a" and pick.level == "leads like this one"
    thin = {"a": (bandit.ArmStats(4, 3), bandit.ArmStats()), "b": (bandit.ArmStats(4, 0), bandit.ArmStats())}
    pick = bandit.choose(["a", "b"], [("leads like this one", thin), ("all leads", broad)], random.Random(0))
    assert pick.option == "b" and pick.level == "all leads"


def test_wording_variants_never_touch_the_clients_mandated_text():
    assert variants.wording_options(cadence.NAME_NUDGE.id) == []
    for theme in cadence.DAY_THEMES:
        options = variants.wording_options(theme.id)
        assert options[0] == "a" and 2 <= len(options) <= 3
        assert variants.instruction(theme.id, "a") == theme.instruction  # A is today's wording
        for option in options[1:]:
            assert variants.instruction(theme.id, option) != theme.instruction
    assert "Never" in variants.instruction("financing_help", "b")  # the never-invent rule stays in every phrasing


# --- Touch tracking and attribution -------------------------------------------------------------------------

async def _touch(db, lead_id, *, touch_id, at, kind="cadence", theme="financing_help", lead_state=None, **plan):
    set_clock(at)
    lead = {"_id": ObjectId(lead_id), "source": "CarGurus"}
    assert await touches.record_touch(db, touch_id=touch_id, lead_id=lead_id, customer_id="c1", kind=kind,
                                      outcomes=[_sent("sms"), _sent("email")], lead=lead,
                                      lead_state=lead_state or {"bucket": "general", "original_bucket": "credit",
                                                                "vehicle_type": "used"},
                                      touch={"theme": theme, **plan})


async def test_a_touch_is_one_row_with_its_context_and_both_channels(mongo):
    db = dealer_scoped_db(DEALER)
    lead_id = str(ObjectId())
    at = datetime(2026, 10, 6, 14, 0, tzinfo=UTC)  # 10:00 in New York
    await _touch(db, lead_id, touch_id="t1", at=at, variant="b", time_variant="morning", touch_number=9, day=14)
    # A re-run of the same touch never counts twice.
    await touches.record_touch(db, touch_id="t1", lead_id=lead_id, customer_id="c1", kind="cadence",
                               outcomes=[_sent("email")], lead={}, lead_state={})
    [row] = await mongo[AI_TOUCHES_COLLECTION].find({"lead_id": lead_id}).to_list(None)
    assert sorted(row["channels"]) == ["email", "sms"]
    assert (row["bucket"], row["original_bucket"], row["source"], row["vehicle_type"]) == (
        "general", "credit", "cargurus", "used")
    assert (row["variant"], row["time_variant"], row["touch_number"], row["day"]) == ("b", "morning", 9, 14)
    assert row["local_hour"] == 10 and row["weekday"] == "Tue" and row["time_band"] == "morning"
    assert row["replied_at"] is None and row["appointment_7d"] is False


async def test_a_send_that_didnt_go_out_is_not_a_touch(mongo):
    db = dealer_scoped_db(DEALER)
    assert not await touches.record_touch(db, touch_id="t2", lead_id=str(ObjectId()), customer_id="c1",
                                          kind="cadence", outcomes=[_sent(status="suppressed"),
                                                                    _sent("email", "shadow"), None])
    assert await mongo[AI_TOUCHES_COLLECTION].count_documents({}) == 0
    assert touches.touch_kind("inbound_message") is None and touches.touch_kind("lead_created") == "first_reply"


async def test_a_reply_is_credited_to_the_latest_touch_once_with_its_windows(mongo):
    db = dealer_scoped_db(DEALER)
    lead_id = str(ObjectId())
    start = datetime(2026, 10, 6, 14, 0, tzinfo=UTC)
    await _touch(db, lead_id, touch_id="old", at=start)
    await _touch(db, lead_id, touch_id="new", at=start + timedelta(days=7))
    await touches.on_customer_reply(db, lead_id, text="👍", at=start + timedelta(days=8, hours=1))
    new = await mongo[AI_TOUCHES_COLLECTION].find_one({"touch_id": "new"})
    assert (new["replied_24h"], new["replied_72h"], new["meaningful_reply"]) == (False, True, False)
    assert new["reply_hours"] == 25.0
    # A real answer in the 72h window upgrades it; the older touch is never credited.
    await touches.on_customer_reply(db, lead_id, text="Yes I'd like to come in Saturday",
                                    at=start + timedelta(days=8, hours=2))
    assert (await mongo[AI_TOUCHES_COLLECTION].find_one({"touch_id": "new"}))["meaningful_reply"] is True
    assert (await mongo[AI_TOUCHES_COLLECTION].find_one({"touch_id": "old"}))["replied_at"] is None


async def test_a_stop_is_a_reply_but_not_a_meaningful_one():
    assert not touches.is_meaningful("STOP") and touches.is_meaningful("What colors do you have?")


async def test_appointment_show_and_opt_out_are_attributed(mongo):
    db = dealer_scoped_db(DEALER)
    lead_id = str(ObjectId())
    start = datetime(2026, 10, 6, 14, 0, tzinfo=UTC)
    await _touch(db, lead_id, touch_id="t", at=start)
    await touches.on_stage_change(db, lead_id, lifecycle.Stage.APPOINTMENT_SET, at=start + timedelta(days=2))
    await touches.on_stage_change(db, lead_id, lifecycle.Stage.SALES_VISIT, at=start + timedelta(days=4))
    row = await mongo[AI_TOUCHES_COLLECTION].find_one({"touch_id": "t"})
    assert row["appointment_7d"] is True and row["showed_at"] is not None
    await touches.on_opt_out(db, lead_id=None, customer_id="c1", channel="sms", at=start + timedelta(days=5))
    assert (await mongo[AI_TOUCHES_COLLECTION].find_one({"touch_id": "t"}))["opted_out_channel"] == "sms"
    # An appointment more than 7 days after the last touch isn't credited to it.
    other = str(ObjectId())
    await _touch(db, other, touch_id="t-late", at=start)
    await touches.on_stage_change(db, other, lifecycle.Stage.APPOINTMENT_SET, at=start + timedelta(days=9))
    assert (await mongo[AI_TOUCHES_COLLECTION].find_one({"touch_id": "t-late"}))["appointment_7d"] is False


@pytestmark_flow
async def test_the_real_flow_records_touches_and_credits_the_reply(mongo):
    created = await _new_lead()
    [first] = await mongo[AI_TOUCHES_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    assert first["kind"] == "first_reply" and first["bucket"] and first["theme_label"] == "Touch 1"
    await _fire_next_touch(mongo, created)  # the name nudge
    nudge = await mongo[AI_TOUCHES_COLLECTION].find_one({"lead_id": created["lead_id"], "theme": "name_nudge"})
    assert nudge["kind"] == "cadence" and sorted(nudge["channels"]) == ["email", "sms"]
    assert nudge.get("variant") is None  # the client's exact "{FirstName}?" is never varied
    await _say(created, "Sorry, busy week - is it still available?")
    nudge = await mongo[AI_TOUCHES_COLLECTION].find_one({"_id": nudge["_id"]})
    assert nudge["replied_24h"] and nudge["meaningful_reply"]
    assert (await mongo[AI_TOUCHES_COLLECTION].find_one({"_id": first["_id"]}))["replied_at"] is None


@pytestmark_flow
async def test_day_2_to_7_touches_get_a_wording_variant_in_their_fixed_theme(mongo):
    created = await _new_lead()
    await _say(created, "Yes, I'm still interested")
    [touch] = await _pending_touches(mongo, created)
    plan = touch["touch"]
    assert plan["theme"] == "vehicle_visual"  # the client's fixed order
    assert plan["variant"] in variants.wording_options("vehicle_visual")
    assert plan["instruction"] == variants.instruction("vehicle_visual", plan["variant"])
    assert plan["choice"]["wording"]["method"] == "split"


# --- The angle, wording and send time ---------------------------------------------------------------------

def _extended_state(used=None):
    started = datetime(2026, 10, 6, 9, 30, tzinfo=NY)
    return CadenceState(started_at=started, touch_number=9, last_touch_at=started + timedelta(days=6),
                        last_touch_day=7, themes_used=used or [t.id for t in cadence.DAY_THEMES])


async def _choose(state, lead_state=None, lead=None, *, send_time_ab=False, learning=True, now=None):
    now = now or datetime(2026, 10, 13, 12, 0, tzinfo=NY)
    planned = cadence.plan_touch(state, now=now, tz=NY, first_contact_done=True)
    return await optimizer.choose_for_touch(
        dealer_scoped_db(DEALER), planned, lead_id="lead-1", state=state, lead=lead or {},
        lead_state=lead_state or {"bucket": "general"}, tz=NY, now=now, learning=learning,
        send_time_ab=send_time_ab)


async def test_a_new_dealer_keeps_the_standard_angle_order_and_never_the_unverified_price_angle(mongo):
    planned, extra = await _choose(_extended_state())
    # Before stream L the price angle came first with nothing to say; now it isn't a candidate without a drop.
    # Day 14 is in Days 8-30 ("nurture & re-engage", client 8 Oct 2026): its first angle without a price drop.
    assert planned.theme.id == "similar_arrivals" and planned.day == 14
    assert extra["choice"]["angle"]["method"] == "default"
    assert "price_or_offer" not in extra["choice"]["angle"]["candidates"]
    assert "price_drop" not in extra


async def _settled_touches(mongo, theme, n, replies, *, bucket="general", dealer=DEALER, field="theme"):
    at = datetime(2026, 9, 1, 14, 0, tzinfo=UTC)
    await mongo[AI_TOUCHES_COLLECTION].insert_many([
        {"dealer_id": dealer, "touch_id": f"{theme}-{dealer}-{i}-{ObjectId()}", "kind": "cadence",
         field: theme, **({"theme": "financing_help"} if field == "variant" else {}),
         "bucket": bucket, "source": "unknown", "vehicle_type": "unknown", "time_band": "morning",
         "sent_at": at, "replied_72h": i < replies} for i in range(n)])


async def test_with_enough_data_the_angle_that_gets_replies_is_used_more(mongo):
    # Every Days 8-30 angle has been used once, so all of them (but the two most recent) are candidates.
    state = _extended_state(["appointment_value", "similar_arrivals", "objection_check", "vehicle_visual",
                             "direct_close", "trade_in"])
    for theme in ("similar_arrivals", "objection_check", "vehicle_visual"):
        await _settled_touches(mongo, theme, 40, 2)
    await _settled_touches(mongo, "appointment_value", 40, 30)
    picks = []
    for seed in range(12):
        state.started_at = datetime(2026, 10, 6, 9, 30, tzinfo=NY) + timedelta(minutes=seed)
        planned, extra = await _choose(state)
        picks.append(planned.theme.id)
    assert picks.count("appointment_value") >= 10
    assert extra["choice"]["angle"]["method"] == "learned"
    # The last two angles used are never repeated straight away ("do not blindly repeat").
    used = ["similar_arrivals", "objection_check", "vehicle_visual", "direct_close", "appointment_value"]
    _, extra = await _choose(_extended_state(used))
    assert "appointment_value" not in extra["choice"]["angle"]["candidates"]


async def test_another_dealers_data_is_only_a_prior(mongo):
    other = str(ObjectId())
    for theme in ("objection_check",):
        await _settled_touches(mongo, theme, 200, 10, dealer=other)
    await _settled_touches(mongo, "similar_arrivals", 200, 150, dealer=other)
    planned, extra = await _choose(_extended_state())
    assert extra["choice"]["angle"]["method"] == "learned"
    scores = extra["choice"]["angle"]
    assert planned.theme.id in scores["candidates"]


async def test_the_send_time_test_moves_a_touch_to_the_afternoon_inside_the_window(mongo):
    times = set()
    for seed in range(10):
        state = _extended_state()
        state.started_at = datetime(2026, 10, 6, 9, 30, tzinfo=NY) + timedelta(minutes=seed)
        planned, extra = await _choose(state, send_time_ab=True)
        times.add((extra["time_variant"], planned.due_at.astimezone(NY).hour))
    assert times == {("morning", 10), ("afternoon", 15)}


async def test_learning_off_gives_todays_plan(mongo):
    planned, extra = await _choose(_extended_state(), learning=False)
    assert planned.theme.id == "similar_arrivals" and "variant" not in extra
    assert optimizer.touch_dict(planned, extra)["instruction"] == cadence.BY_ID["similar_arrivals"].instruction


# --- Verified price drops --------------------------------------------------------------------------------

VIN = "2T3P1RFV5PW000111"


async def _price(db, price, at, vin=VIN):
    set_clock(at)
    return await price_watch.record_prices(db, [{"vin": vin, "price": price, "title": "2023 Toyota RAV4 XLE"}], at=at)


async def test_a_verified_drop_needs_the_same_vin_lower_by_a_meaningful_amount_and_still_in_stock(mongo):
    db = dealer_scoped_db(DEALER)
    start = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
    await _price(db, 30_000, start)
    await _price(db, 30_000, start + timedelta(days=5))  # unchanged: no drop
    assert await price_watch.current_drop(db, VIN, start + timedelta(days=5)) is None
    await _price(db, 29_900, start + timedelta(days=6))  # $100 isn't meaningful
    assert await price_watch.current_drop(db, VIN, start + timedelta(days=6)) is None
    await _price(db, 28_500, start + timedelta(days=7))
    drop = await price_watch.current_drop(db, VIN, start + timedelta(days=7))
    assert (drop["price"], drop["previous_price"], drop["amount"]) == (28_500, 30_000, 1_500)
    # Not seen in the feed for 48 hours: no longer verified.
    assert await price_watch.current_drop(db, VIN, start + timedelta(days=10)) is None
    # Back up part of the way: not announced as a drop.
    await _price(db, 29_000, start + timedelta(days=8))
    assert await price_watch.current_drop(db, VIN, start + timedelta(days=8)) is None
    # A zero price is "no price", never a drop.
    await _price(db, 0, start + timedelta(days=9))
    assert (await mongo[AI_PRICE_SNAPSHOTS_COLLECTION].find_one({"vin": VIN}))["price"] == 29_000


async def test_the_sweep_reads_prices_like_api_car_and_marks_sold_vehicles(mongo):
    await mongo[AI_LEAD_STATE_COLLECTION].insert_one({"dealer_id": DEALER, "lead_id": "l1"})
    await mongo[PLATFORM_VEHICLES_COLLECTION].insert_many([
        {"dealerId": DEALER, "vin": VIN, "internetreduced": "31000", "year": 2023, "make": "Toyota",
         "model": "RAV4"},
        {"dealerId": DEALER, "vin": "OTHER1", "internetreduced": 0}])
    start = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
    set_clock(start)
    summary = await price_watch.sweep(start)
    assert summary["dealers"] == 1 and summary["new"] == 1  # the unpriced one isn't snapshotted
    row = await mongo[AI_PRICE_SNAPSHOTS_COLLECTION].find_one({"vin": VIN})
    assert row["price"] == 31_000 and row["title"] == "2023 Toyota RAV4"
    await mongo[PLATFORM_VEHICLES_COLLECTION].update_one({"vin": VIN}, {"$set": {"internetreduced": 29_500}})
    later = start + timedelta(hours=6)
    set_clock(later)
    assert (await price_watch.sweep(later))["drops"] == 1
    await mongo[PLATFORM_VEHICLES_COLLECTION].delete_one({"vin": VIN})
    assert (await price_watch.sweep(later + timedelta(hours=6)))["gone"] == 1
    assert await price_watch.current_drop(dealer_scoped_db(DEALER), VIN, later + timedelta(hours=6)) is None


async def test_reading_inventory_snapshots_its_prices(mongo):
    from upsell_agent.tools.inventory_tool import StubInventorySource, get_vehicle

    await mongo[PLATFORM_VEHICLES_COLLECTION].insert_one(
        {"dealerId": DEALER, "vin": VIN, "internetreduced": 27_995, "year": 2023, "make": "Toyota", "model": "RAV4"})
    record = await get_vehicle(DEALER, VIN, StubInventorySource())
    assert record is not None and record.price == 27_995  # the listed price (client, 7 Oct 2026)
    assert (await mongo[AI_PRICE_SNAPSHOTS_COLLECTION].find_one({"vin": VIN}))["price"] == 27_995


def test_the_guard_allows_the_drop_price_only_for_that_vehicle():
    record = {"vin": VIN, "year": 2023, "make": "Toyota", "model": "RAV4",
              "price_drop": {"price": 28_500, "previous_price": 30_000, "amount": 1_500}}
    draft = {"sms_text": "Good news - the 2023 Toyota RAV4 just came down to $28,500 (was $30,000).",
             "email_subject": "Price drop", "email_body": "The 2023 Toyota RAV4 is now $28,500.",
             "sms_vins": [VIN], "email_vins": [VIN]}
    assert check_draft(draft, customer_texts=[], known_values=[], inventory=[record])["passed"]
    # Not naming the vehicle, or another price: rejected.
    assert not check_draft({**draft, "sms_vins": [], "email_vins": []}, customer_texts=[], known_values=[],
                           inventory=[record])["passed"]
    assert not check_draft({**draft, "sms_text": "It's now $27,000!"}, customer_texts=[], known_values=[],
                           inventory=[record])["passed"]
    # A record without a verified drop (any reply turn) never allows a price.
    plain = {k: v for k, v in record.items() if k != "price_drop"}
    assert not check_draft(draft, customer_texts=[], known_values=[], inventory=[plain])["passed"]


@pytestmark_flow
async def test_a_verified_drop_becomes_the_day_14_touch_and_states_only_that_price(mongo):
    db = dealer_scoped_db(DEALER)
    created = await _new_lead(comments="Is the 2023 Toyota RAV4 still available?")
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(created["lead_id"])},
                                                      {"$set": {"data.vin": VIN}})
    await mongo[PLATFORM_VEHICLES_COLLECTION].insert_one(
        {"dealerId": DEALER, "vin": VIN, "internetreduced": 30_000, "year": 2023, "make": "Toyota",
         "model": "RAV4", "trim": "XLE", "condition": "used", "mileage": 12000})
    await price_watch.record_prices(db, [{"vin": VIN, "price": 30_000, "title": "2023 Toyota RAV4 XLE"}],
                                    at=clock.now())
    for _ in range(7):  # the name nudge and Days 2-7
        await _fire_next_touch(mongo, created)
    # The price drops before Day 14 is planned (the Day 7 touch plans it as it goes out)...
    [pending] = await _pending_touches(mongo, created)
    assert pending["touch"]["day"] == 14
    await mongo[PLATFORM_VEHICLES_COLLECTION].update_one({"vin": VIN}, {"$set": {"internetreduced": 28_500}})
    set_clock(clock.now() + timedelta(days=1))
    await price_watch.sweep()
    state = await _state(mongo, created)
    plan = await optimizer.plan(db, cadence.plan_touch(cadence.CadenceState.load(state), now=clock.now(), tz=NY,
                                                       first_contact_done=True),
                                lead_id=created["lead_id"], state=cadence.CadenceState.load(state), lead=None,
                                lead_state=state, tz=NY, now=clock.now())
    touch = plan[1]
    assert touch["theme"] == "price_or_offer" and touch["price_drop"]["price"] == 28_500
    assert "$28,500" in touch["instruction"] and VIN in touch["instruction"]
    # ...and fired for real: the vehicle is re-read fresh, the price stated, the guard passes.
    await mongo["scheduled_followups"].update_one({"_id": pending["_id"]}, {"$set": {"touch": touch}})
    before = len(await _outbox(mongo, created))
    await _fire_next_touch(mongo, created)
    sms = next(m for m in (await _outbox(mongo, created))[before:] if m["channel"] == "sms")["text"]
    assert "$28,500" in sms
    turn = await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"], "trigger": "cadence_touch"}
                                                    ).sort("created_at", -1).to_list(1)
    assert turn[0]["outcome"] != "fallback"
    row = await mongo[AI_TOUCHES_COLLECTION].find_one({"lead_id": created["lead_id"], "theme": "price_or_offer"})
    assert row["price_drop_vin"] == VIN and row["variant"] == "price_drop"


async def test_a_drop_that_no_longer_holds_when_the_touch_fires_loses_its_price(mongo):
    from upsell_agent.config import Settings

    db = dealer_scoped_db(DEALER)
    touch = {"theme": "price_or_offer", "instruction": "x", "variant": "price_drop",
             "price_drop": {"vin": VIN, "price": 28_500, "previous_price": 30_000, "amount": 1_500}}
    out = await optimizer.recheck_price_drop(db, touch, Settings(PLATFORM_CLIENT="stub"))
    assert "price_drop" not in out and out["instruction"] == cadence.PRICE_CHANGE.instruction
    assert "no longer holds" in out["price_drop_lapsed"]


# --- New / used, current and original ------------------------------------------------------------------------

async def test_original_vehicle_type_is_kept_when_the_customer_changes_it(mongo):
    db = dealer_scoped_db(DEALER)
    lead = {"data": {"vehicle": {"condition": "New"}}}
    state = await lead_bucket.track_vehicle_type(db, lead_id="l1", lead=lead, lead_state={}, profile=None)
    assert state["vehicle_type"] == state["original_vehicle_type"] == "new"
    profile = {"slots": [{"path": "interest.new_or_used", "value": "used", "state": "filled"}]}
    state = await lead_bucket.track_vehicle_type(db, lead_id="l1", lead=lead, lead_state=state, profile=profile)
    stored = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": "l1"})
    assert (stored["vehicle_type"], stored["original_vehicle_type"]) == ("used", "new")
    api = lead_bucket.vehicle_type_for_api(stored)
    assert api["changed"] and [h["vehicle_type"] for h in api["history"]] == ["new", "used"]


# --- The report ---------------------------------------------------------------------------------------------

async def test_the_engagement_report_counts_only_settled_touches(mongo):
    db = dealer_scoped_db(DEALER)
    now = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
    await _settled_touches(mongo, "a", 40, 20, field="variant")
    await _settled_touches(mongo, "b", 40, 8, field="variant")
    lead_id = str(ObjectId())
    await _touch(db, lead_id, touch_id="fresh", at=now - timedelta(hours=1))  # too new for any rate
    set_clock(now)
    report = await insights.engagement(db, days=60, now=now)
    assert report["totals"]["touches"] == 81 and report["totals"]["settled"] == 80
    assert report["totals"]["response_rate"] == pytest.approx(28 / 80, abs=1e-4)
    [wording] = [w for w in report["winners"] if w["test"] == "wording:financing_help"]
    assert wording["leader"] == "a" and wording["enough_data"] and wording["leader_label"].endswith("wording A")
    labels = {r["key"]: r["label"] for r in report["by_variant"]}
    assert labels["financing_help:b"] == "Financing help - wording B"
    assert report["learning"]["min_samples"] == bandit.MIN_SAMPLES


def test_the_insights_api_needs_the_shared_secret_and_answers_per_dealer(mongo):
    from upsell_agent.main import create_app

    with TestClient(create_app(make_settings("PROD"), connect=False)) as client:
        assert client.get("/v1/insights/engagement", params={"dealer_id": DEALER}).status_code == 401
        body = client.get("/v1/insights/engagement", params={"dealer_id": DEALER, "days": 7},
                          headers={"Authorization": "Bearer test-secret"}).json()
    assert body["days"] == 7 and body["totals"]["touches"] == 0 and body["winners"] == []
