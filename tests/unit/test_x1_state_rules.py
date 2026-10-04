"""PLAN_4 stream X1 item 10: state holidays (RI, LA, AL), the IN / ME automated-device rows and New Jersey's ban on
unsolicited sales texts to cell phones, as configurable rules in the versioned table (counsel to confirm)."""

from datetime import UTC, date

import pytest
from bson import ObjectId

from tests.unit.conftest import set_clock
from tests.unit.test_state_hours import CHI, NY, local
from upsell_agent import clock
from upsell_agent.compliance import engine, state_hours
from upsell_agent.compliance.customer_zone import CustomerZone
from upsell_agent.compliance.engine import can_contact
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import AI_MESSAGES_COLLECTION, PLATFORM_LEADS_COLLECTION

DEALER = simulate.DEV_DEALERS[0]["_id"]


def allowed(state: str, at, *, automated: bool = False) -> bool:
    return state_hours.allowed(at, (str(at.tzinfo),), state_hours.rules_for((state,), automated=automated))


@pytest.mark.parametrize(("state", "tz", "day", "name"), [
    ("RI", NY, date(2026, 8, 10), "Victory Day"),
    ("LA", CHI, date(2026, 2, 17), "Mardi Gras"),
    ("LA", CHI, date(2026, 4, 3), "Good Friday"),
    ("LA", CHI, date(2027, 11, 1), "All Saints' Day"),
    ("AL", CHI, date(2026, 2, 17), "Mardi Gras"),
    ("AL", CHI, date(2026, 4, 27), "Confederate Memorial Day"),
    ("AL", CHI, date(2026, 6, 1), "Jefferson Davis' Birthday"),
])
def test_state_holidays_ban_contact(state, tz, day, name):
    at = local(tz, day.month, day.day, 12, year=day.year)
    assert state_hours.state_holidays(state, day.year)[day] == name
    assert not allowed(state, at)
    assert allowed("NY", at.astimezone(NY))  # a federal-default state carries on


def test_easter_based_holidays_move_each_year():
    assert state_hours._easter(2026) == date(2026, 4, 5) and state_hours._easter(2027) == date(2027, 3, 28)


def test_indiana_automated_texts_stop_at_20_while_a_person_may_call_until_21():
    at = local(NY, 9, 22, 20, 30)
    assert allowed("IN", at) and not allowed("IN", at, automated=True)


def test_maine_automated_texts_are_weekdays_9_to_17_one_per_8_hours():
    rule = state_hours.rules_for(("ME",), automated=True)[0]
    assert rule.saturday is None and rule.sunday is None and rule.weekday == (state_hours.time(9), state_hours.time(17))
    assert rule.cap == (1, state_hours.timedelta(hours=8))
    assert allowed("ME", local(NY, 9, 26, 12))  # a person's Saturday call: federal default


def test_the_automated_rows_can_be_switched_off(monkeypatch):
    monkeypatch.setenv("TCPA_AUTOMATED_DEVICE_ROWS", "false")
    assert allowed("IN", local(NY, 9, 22, 20, 30), automated=True)


@pytest.fixture
async def dealers(mongo):
    await simulate.ensure_platform_dealers()


def _pin(monkeypatch, state, tz="America/New_York"):
    async def fixed(_db, _customer_id, _phone):
        return CustomerZone((tz,), "zip", f"test {state}", state)
    monkeypatch.setattr(engine, "customer_zone", fixed)


async def _lead(mongo, source):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Sam State", comments="Hi")
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(created["lead_id"])},
                                                      {"$set": {"source": source, "lead_source": source}})
    return created


async def _marketing(created, **kw):
    return await can_contact(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                             channel="sms", purpose="marketing", is_reply=False, record=False, **kw)


async def test_a_maine_customer_gets_no_ai_text_on_saturday(mongo, dealers, monkeypatch):
    _pin(monkeypatch, "ME")
    set_clock(local(NY, 9, 26, 12).astimezone(UTC))  # Saturday; the dealer is open
    created = await _lead(mongo, "website")
    decision = await _marketing(created)
    assert decision.outcome == "HOLD" and decision.until == local(NY, 9, 28, 9)


async def test_new_jersey_blocks_an_unsolicited_sales_text(mongo, dealers, monkeypatch):
    _pin(monkeypatch, "NJ")
    set_clock(local(NY, 9, 22, 12).astimezone(UTC))
    imported = await _lead(mongo, "dealervault")
    # The customer once wrote back, which gives an outbound lead 91 days of AI follow-ups elsewhere ...
    await mongo[AI_MESSAGES_COLLECTION].insert_one({"dealer_id": DEALER, "lead_id": imported["lead_id"],
                                                    "direction": "inbound", "text": "who is this",
                                                    "created_at": clock.now()})
    decision = await _marketing(imported)
    assert decision.outcome == "BLOCK" and decision.rule == "unsolicited_sales_ban"
    # ... but a follow-up on a New Jersey customer's own inquiry is solicited.
    inquiry = await _lead(mongo, "website")
    assert (await _marketing(inquiry)).outcome == "ALLOW"
    monkeypatch.setenv("TCPA_NJ_CELL_SALES_BAN", "false")
    assert (await _marketing(imported)).outcome == "ALLOW"
