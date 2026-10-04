"""MASTER_PLAN_4 F1: per-state contact hours (compliance/state_hours.py,
applied by compliance/engine.py rule 8 and compliance/call_check.py), from
the client's two TCPA tables of 1 Oct 2026 (docs/data/6/tcpa_7.md).

Dates: Sept 22, 2026 is a Tuesday; Sept 26 a Saturday, Sept 27 a Sunday;
Sept 7, 2026 is Labor Day (a Monday)."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from tests.unit.conftest import set_clock
from upsell_agent.compliance import engine, state_hours
from upsell_agent.compliance.call_check import can_call
from upsell_agent.compliance.customer_zone import CONTINENTAL_ZONES, CustomerZone, customer_zone
from upsell_agent.compliance.engine import can_contact
from upsell_agent.compliance.state_hours import STATE_RULES, STRICTEST, rules_for
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import (
    AI_COMPLIANCE_LOG_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    dealer_scoped_db,
)

NY = ZoneInfo("America/New_York")
CHI = ZoneInfo("America/Chicago")
DEALER = simulate.DEV_DEALERS[0]["_id"]


def local(tz: ZoneInfo, month: int, day: int, hour: int, minute: int = 0, year: int = 2026) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=tz)


def ok(state: str, at: datetime) -> bool:
    return state_hours.allowed(at, (str(at.tzinfo),), rules_for((state,)))


# --- One rule type at a time ----------------------------------------------------------------

@pytest.mark.parametrize("state,start", [("CT", 9), ("NV", 9), ("NM", 9), ("SD", 9), ("TX", 9), ("KY", 10)])
def test_late_start_states(state, start):
    tz = NY  # the zone doesn't matter to the row itself; only the local clock
    assert not ok(state, local(tz, 9, 22, start - 1, 59))
    assert ok(state, local(tz, 9, 22, start))


@pytest.mark.parametrize("state,end", [("FL", 20), ("MD", 20), ("OK", 20), ("WA", 20), ("AL", 20), ("NY", 21),
                                       ("CA", 21), ("CT", 20), ("NV", 20)])
def test_evening_cutoffs(state, end):
    assert ok(state, local(NY, 9, 22, end - 1, 59))
    assert not ok(state, local(NY, 9, 22, end))


@pytest.mark.parametrize("state", ["AL", "LA", "MS", "SD", "RI"])
def test_sunday_bans(state):
    assert not ok(state, local(NY, 9, 27, 12))  # Sunday noon
    assert ok(state, local(NY, 9, 26, 12))      # Saturday noon is fine


def test_texas_sundays_are_noon_to_nine():
    assert not ok("TX", local(CHI, 9, 27, 11, 59))
    assert ok("TX", local(CHI, 9, 27, 12))
    assert ok("TX", local(CHI, 9, 27, 20, 59))
    assert not ok("TX", local(CHI, 9, 27, 21))
    assert ok("TX", local(CHI, 9, 26, 9))  # Saturday keeps the 9:00 start


@pytest.mark.parametrize("state", ["AL", "LA", "RI"])
def test_holiday_bans(state):
    labor_day = local(NY, 9, 7, 12)
    assert not ok(state, labor_day)
    assert ok(state, local(NY, 9, 8, 12))
    assert ok("NY", labor_day)  # no holiday rule in New York


def test_rhode_island_weekdays_and_saturday():
    assert not ok("RI", local(NY, 9, 22, 8, 59))
    assert ok("RI", local(NY, 9, 22, 9))
    assert ok("RI", local(NY, 9, 22, 17, 59))
    assert not ok("RI", local(NY, 9, 22, 18))
    assert not ok("RI", local(NY, 9, 26, 9, 59))
    assert ok("RI", local(NY, 9, 26, 10))
    assert ok("RI", local(NY, 9, 26, 16, 59))
    assert not ok("RI", local(NY, 9, 26, 17))


def test_federal_default_rows_are_marked_unverified_and_caps_kept():
    assert not STATE_RULES["AK"].verified and STATE_RULES["AK"].weekday == (time(8), time(21))
    assert STATE_RULES["NY"].verified
    for state in ("FL", "OK", "MD"):
        assert STATE_RULES[state].cap == (3, timedelta(hours=24))
    assert len(STATE_RULES) == 51  # 50 states and D.C.


def test_us_federal_holidays():
    days = state_hours.federal_holidays(2026)
    assert days[date(2026, 9, 7)] == "Labor Day"
    assert days[date(2026, 11, 26)] == "Thanksgiving Day"
    assert days[date(2026, 1, 19)] == "Martin Luther King Jr. Day"
    assert days[date(2026, 5, 25)] == "Memorial Day"
    assert days[date(2026, 10, 12)] == "Columbus Day"
    assert days[date(2026, 7, 3)] == "Independence Day (observed)"  # July 4, 2026 is a Saturday
    assert days[date(2026, 7, 4)] == "Independence Day"
    # 2027: Juneteenth on a Saturday (observed Friday), Christmas on a Saturday, and New Year's 2028 too.
    days_2027 = state_hours.federal_holidays(2027)
    assert date(2027, 6, 18) in days_2027 and date(2027, 12, 24) in days_2027 and date(2027, 12, 31) in days_2027
    assert not state_hours.is_federal_holiday(date(2026, 9, 22))


# --- Which row(s) apply -------------------------------------------------------------------

def test_unknown_state_gets_the_strictest_row():
    assert rules_for(()) == [STRICTEST]
    assert rules_for(("PR",)) == [STRICTEST]  # not in the client's table
    assert rules_for(("NY", "ZZ")) == [STRICTEST]
    assert STRICTEST.weekday == (time(10), time(18))     # Kentucky's start, Rhode Island's end
    assert STRICTEST.saturday == (time(10), time(17))    # Rhode Island
    assert STRICTEST.sunday is None and STRICTEST.holidays_banned
    assert STRICTEST.cap == (3, timedelta(hours=24))


def test_zone_states_reads_both_states_and_unknown_has_none():
    assert state_hours.zone_states(CustomerZone(("America/New_York",), "zip", "", "NY", [], ("NY", "KY"))) == (
        "NY", "KY")
    assert state_hours.zone_states({"method": "zip", "state": "TX"}) == ("TX",)
    assert state_hours.zone_states(CustomerZone(CONTINENTAL_ZONES, "unknown", "")) == ()


def test_the_stricter_of_two_states_wins():
    rules = rules_for(("NY", "KY"))
    at = local(NY, 9, 22, 9, 30)
    assert ok("NY", at) and not state_hours.allowed(at, ("America/New_York",), rules)
    assert state_hours.next_allowed(at, ("America/New_York",), rules) == local(NY, 9, 22, 10)


# --- HOLD release times ---------------------------------------------------------------------

def test_hold_release_times():
    zones = ("America/New_York",)
    # Rhode Island, Saturday 20:00: Sunday is banned, so Monday 9:00.
    assert state_hours.next_allowed(local(NY, 9, 26, 20), zones, rules_for(("RI",))) == local(NY, 9, 28, 9)
    # Alabama, Sunday Sept 6: Monday is Labor Day, so Tuesday 8:00 Chicago.
    assert state_hours.next_allowed(local(CHI, 9, 6, 9), ("America/Chicago",), rules_for(("AL",))) == local(
        CHI, 9, 8, 8)
    # Texas, Sunday 9:00: noon the same day.
    assert state_hours.next_allowed(local(CHI, 9, 27, 9), ("America/Chicago",), rules_for(("TX",))) == local(
        CHI, 9, 27, 12)
    # Kentucky, 21:30: 10:00 the next morning.
    assert state_hours.next_allowed(local(NY, 9, 22, 21, 30), zones, rules_for(("KY",))) == local(NY, 9, 23, 10)
    # Already allowed: now.
    at = local(NY, 9, 22, 12)
    assert state_hours.next_allowed(at, zones, rules_for(("NY",))) == at


# --- Through the send check (engine.py rule 8) ------------------------------------------------

@pytest.fixture
async def dealers(mongo):
    await simulate.ensure_platform_dealers()


def _pin_zone(monkeypatch, zone: CustomerZone):
    async def fixed(_db, _customer_id, _phone):
        return zone

    monkeypatch.setattr(engine, "customer_zone", fixed)


async def _lead():
    return await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Stella State",
                                      comments="Looking at a used Honda CR-V")


async def _marketing(created, *, is_reply=False, purpose="marketing"):
    return await can_contact(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                             channel="sms", purpose=purpose, is_reply=is_reply)


async def test_a_kentucky_customer_is_held_until_ten_and_the_log_names_the_rules(mongo, dealers, monkeypatch):
    _pin_zone(monkeypatch, CustomerZone(("America/New_York",), "zip", "ZIP 40202 (test)", "KY"))
    set_clock(local(NY, 9, 22, 9, 30).astimezone(UTC))
    created = await _lead()
    decision = await _marketing(created)
    assert decision.outcome == "HOLD" and decision.until == local(NY, 9, 22, 10)
    assert "KY: Mon-Fri 10:00-21:00" in decision.reason
    row = await mongo[AI_COMPLIANCE_LOG_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert row["jurisdiction"]["states"] == ["KY"]
    assert row["jurisdiction"]["rules_version"] == state_hours.RULES_VERSION
    # PLAN_4 stream X1 item 7: transactional texts follow the state row too; a reply keeps its exemption.
    held = await _marketing(created, purpose="transactional")
    assert held.outcome == "HOLD" and held.until == local(NY, 9, 22, 10)
    assert (await _marketing(created, is_reply=True, purpose="reply")).outcome == "ALLOW"


async def test_a_sunday_text_to_an_alabama_customer_waits_for_monday(mongo, dealers, monkeypatch):
    _pin_zone(monkeypatch, CustomerZone(("America/Chicago",), "zip", "ZIP 35203 (test)", "AL"))
    set_clock(local(CHI, 9, 27, 12).astimezone(UTC))
    created = await _lead()
    decision = await _marketing(created)
    # Monday 8:00 Chicago is 9:00 New York, when dealer A opens.
    assert decision.outcome == "HOLD" and decision.until == local(NY, 9, 28, 9)


async def test_zip_state_and_area_code_state_are_both_applied(mongo, dealers):
    set_clock(local(NY, 9, 22, 9, 30).astimezone(UTC))
    created = await _lead()
    db = dealer_scoped_db(DEALER)
    await mongo[PLATFORM_DEALS_COLLECTION].insert_one(
        {"dealer_id": DEALER, "deal_number": "d-1", "customer_id": ObjectId(created["customer_id"]),
         "Zip": "10001", "State": "NY"})
    await mongo[PLATFORM_CUSTOMERS_COLLECTION].update_one(
        {"_id": ObjectId(created["customer_id"])}, {"$set": {"phones.0.value": "5025821234"}})
    zone = await customer_zone(db, created["customer_id"], "+15025821234")
    assert zone.state == "NY" and zone.states == ("NY", "KY")
    assert any("both states' hours apply" in n for n in zone.notes)
    decision = await can_contact(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                                 channel="sms", purpose="marketing", is_reply=False, to="+15025821234")
    assert decision.outcome == "HOLD" and decision.until == local(NY, 9, 22, 10)  # Kentucky's 10:00


async def test_a_state_cap_tighter_than_ours_holds(mongo, dealers, monkeypatch):
    tight = state_hours.StateRule("XX", (time(8), time(21)), (time(8), time(21)), (time(8), time(21)),
                                  cap=(1, timedelta(hours=8)))
    monkeypatch.setitem(STATE_RULES, "XX", tight)
    _pin_zone(monkeypatch, CustomerZone(("America/New_York",), "zip", "test", "XX"))
    start = local(NY, 9, 22, 10)
    set_clock(start.astimezone(UTC))
    created = await _lead()
    assert (await _marketing(created)).outcome == "ALLOW"
    second = await _marketing(created)
    assert second.outcome == "HOLD"
    assert abs((second.until - (start + timedelta(hours=8))).total_seconds()) < 5
    assert "the state's own cap" in second.reason


async def test_a_human_call_follows_the_live_call_row(mongo, dealers, monkeypatch):
    _pin_zone(monkeypatch, CustomerZone(("America/New_York",), "zip", "ZIP 40202 (test)", "KY"))
    set_clock(local(NY, 9, 22, 9, 30).astimezone(UTC))  # dealer open, 8:00-21:00 fine, Kentucky not yet
    created = await _lead()
    decision = await can_call(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"])
    assert decision.outcome == "HOLD" and decision.until == local(NY, 9, 22, 10)
