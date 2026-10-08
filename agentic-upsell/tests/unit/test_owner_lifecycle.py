"""Client, 8 Oct 2026 meeting: the owner life cycle for every DealerVault sale (agent/owner_touches.py,
scheduler/owner_lifecycle.py) - birthday, anniversary, review & referral, first 90 days, lease end, payoff, tips."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from tests.unit.conftest import set_clock
from tests.unit.test_sold_lifecycles import (  # noqa: F401 - the live_dealer fixture
    DEALER,
    _aware,
    _deps,
    _new_lead,
    _outbox,
    _staff,
    live_dealer,
)
from upsell_agent import clock
from upsell_agent.agent import owner_touches
from upsell_agent.integrations.mongodb import (
    AI_OWNER_LIFECYCLE_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    as_object_id,
    dealer_scoped_db,
)
from upsell_agent.scheduler import followups, owner_lifecycle

NY = ZoneInfo("America/New_York")
flow = pytest.mark.usefixtures("during_opening_hours", "ny_customer", "live_dealer")


def _mdy(day: date) -> str:
    return f"{day.month}/{day.day}/{day.year}"


# --- Pure ------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize(("deal_type", "sale_type", "financed", "term", "expected"), [
    ("Lease", "New", "", "36", "lease"),
    ("Retail", "Used", "22000", "72", "finance"),
    ("Cash", "New", "", "", "cash"),
    ("Retail", "New", "0", "", "unknown"),
])
def test_deal_type(deal_type, sale_type, financed, term, expected):
    assert owner_touches.classify(deal_type, sale_type, financed, term) == expected


def test_lease_end_and_payoff_dates_from_the_contract():
    lease = owner_touches.read_deal({"Deal Number": "1", "Deal Type": "Lease", "Term": "36",
                                     "First Pay Date": "2/15/2024", "Delivery Date": "1/15/2024"})
    assert lease.contract_end == date(2027, 1, 15)
    touches = {t: due.date() for t, _, due in owner_touches.vehicle_touch_dates(lease, NY)}
    assert touches["lease_end"] == date(2027, 1, 15) - timedelta(days=90)
    assert "payoff" not in touches
    loan = owner_touches.read_deal({"Deal Number": "2", "Deal Type": "Retail", "Term": "60",
                                    "Amount Financed": "$30,000", "Delivery Date": "3/1/2022",
                                    "Contract Date": "3/1/2022"})
    assert {t for t, _, _ in owner_touches.vehicle_touch_dates(loan, NY)} >= {"payoff", "review_referral",
                                                                              "first_30", "first_90", "tip"}
    assert loan.contract_end == date(2027, 3, 1)


def test_the_first_touches_after_delivery_in_order():
    deal = owner_touches.read_deal({"Deal Number": "3", "Deal Type": "Cash", "Delivery Date": "10/1/2026"})
    first = [(t, due.date()) for t, _, due in owner_touches.vehicle_touch_dates(deal, NY)][:4]
    assert first == [("review_referral", date(2026, 10, 15)), ("first_30", date(2026, 10, 31)),
                     ("first_90", date(2026, 12, 25)), ("tip", date(2027, 1, 14))]


def test_a_late_touch_is_skipped_never_sent_late():
    deal = owner_touches.read_deal({"Deal Number": "4", "Deal Type": "Cash", "Delivery Date": "1/1/2026"})
    now = datetime(2026, 10, 9, 12, tzinfo=NY)
    touch, _key, due = owner_touches.next_vehicle_touch(deal, sent=set(), now=now, tz=NY)
    assert touch == "tip" and due + owner_touches.LATE_GRACE >= now
    skip = owner_touches.next_vehicle_touch(deal, sent=set(), now=datetime(2026, 12, 20, tzinfo=NY), tz=NY,
                                            skip=frozenset({"tip"}))
    assert skip[0] == "anniversary"


@pytest.mark.parametrize("touch", owner_touches.ALL_TOUCHES)
def test_every_message_says_it_is_the_ai_and_never_a_birth_year(touch):
    text = owner_touches.render(touch, first_name="Maria", dealership="Sunrise Motors",
                                vehicle={"year": "2024", "make": "Toyota", "model": "RAV4"}, year=3,
                                items=["Replace front brake pads"])
    assert "the AI assistant" in text["sms_text"] and "the AI assistant" in text["email_body"]
    assert not owner_touches.BIRTH_YEAR.search(text["sms_text"])


@pytest.mark.parametrize(("text", "bad"), [
    ("Happy 45th birthday!", True), ("You were born in 1980", True), ("turning 50 this year", True),
    ("You're 40 years old", True), ("Happy birthday, Maria!", False), ("3 years with your RAV4", False),
])
def test_birth_year_guard(text, bad):
    assert bool(owner_touches.BIRTH_YEAR.search(text)) is bad


def test_unwound_deals_are_not_owners():
    assert not owner_touches.is_delivered({"Delivery Date": "1/1/2026", "Deal Status": "Unwound"})
    assert owner_touches.is_delivered({"Delivery Date": "1/1/2026", "Deal Status": "Finalized"})
    assert not owner_touches.is_delivered({"Deal Status": "Finalized"})


# --- Flows -----------------------------------------------------------------------------------------------------------

async def _deal(mongo, created, **fields):
    today = clock.now().astimezone(NY).date()
    row = {"dealer_id": DEALER, "deal_number": fields.pop("deal_number", "D100"),
           "customer_id": as_object_id(created["customer_id"]), "Deal Type": "Cash", "Year": "2024",
           "Make": "TOYOTA", "Model": "RAV4", "vin": "1HGCM82633A004352",
           "Delivery Date": _mdy(today - timedelta(days=10)), **fields}
    await mongo[PLATFORM_DEALS_COLLECTION].insert_one(row)
    return row


async def _pending(mongo, created):
    return await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"customer_id": created["customer_id"], "kind": "owner_touch", "status": "pending"}).to_list(None)


async def _fire_next(mongo, created, touch):
    [doc] = [d for d in await _pending(mongo, created) if d["touch"] == touch]
    set_clock(_aware(doc["due_at"]) + timedelta(minutes=1))
    await followups.fire_due(_deps())
    return await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"_id": doc["_id"]})


@flow
async def test_a_dealervault_owner_gets_review_then_first_30_on_their_old_lead(mongo):
    created = await _new_lead()
    await _staff(created, "Closed Lost")  # an old sales lead: the customer bought later, in the DMS
    await _deal(mongo, created)
    summary = await owner_lifecycle.sweep()
    assert summary["planned"] == 1 and summary["no_lead"] == 0
    [doc] = await _pending(mongo, created)
    assert doc["touch"] == "review_referral" and doc["lead_id"] == created["lead_id"]
    done = await _fire_next(mongo, created, "review_referral")
    assert done["status"] == "sent"
    text = (await _outbox(mongo, created))[-1]["text"]
    assert "review" in text and "who's next" in text and "the AI assistant" in text
    [nxt] = await _pending(mongo, created)
    assert nxt["touch"] == "first_30"
    row = await mongo[AI_OWNER_LIFECYCLE_COLLECTION].find_one({"deal_number": "D100"})
    assert row["sent"] == ["review_referral"]
    # The sweep again plans nothing new.
    assert (await owner_lifecycle.sweep())["planned"] == 0


@flow
async def test_an_active_sales_conversation_defers_an_owner_touch(mongo):
    created = await _new_lead()  # a live sales lead
    await _deal(mongo, created)
    await owner_lifecycle.sweep()
    done = await _fire_next(mongo, created, "review_referral")
    assert done["status"] == "pending" and "active sales conversation" in done["reason"]


@flow
async def test_no_lead_in_the_crm_is_counted_not_messaged(mongo):
    created = {"customer_id": "66f0000000000000000000aa"}
    await _deal(mongo, created, deal_number="D200")
    summary = await owner_lifecycle.sweep()
    assert summary["no_lead"] == 1 and summary["planned"] == 0


@flow
async def test_birthday_for_a_dealervault_customer_never_says_the_year(mongo):
    created = await _new_lead()
    await _staff(created, "Closed Lost")
    await _deal(mongo, created, **{"Birth Date": "7/14/1985"})
    assert (await owner_lifecycle.sweep())["birthdays"] == 1
    done = await _fire_next(mongo, created, "birthday")
    assert done["status"] == "sent"
    text = (await _outbox(mongo, created))[-1]["text"]
    assert text.startswith("Happy Birthday") and "1985" not in text and "the AI assistant" in text
    [nxt] = [d for d in await _pending(mongo, created) if d["touch"] == "birthday"]
    assert _aware(nxt["due_at"]).year == _aware(done["due_at"]).year + 1


@flow
async def test_a_lease_customer_hears_before_the_lease_ends(mongo):
    created = await _new_lead()
    await _staff(created, "Closed Lost")
    today = clock.now().astimezone(NY).date()
    start = owner_touches.add_months(today, -34)
    await _deal(mongo, created, deal_number="L1", **{"Deal Type": "Lease", "Term": "36",
                                                     "Delivery Date": _mdy(start), "Contract Date": _mdy(start)})
    await owner_lifecycle.sweep()
    db = dealer_scoped_db(DEALER)
    pending = {d["touch"] for d in await _pending(mongo, created)}
    assert "lease_end" in pending or "tip" in pending
    views = await owner_lifecycle.view(db, created["customer_id"])
    assert views[0]["deal_type"] == "lease" and views[0]["contract_end"]


def test_recommendations_are_quoted_word_for_word():
    ro = {"Recommendations": "Replace front brake pads^Rotate tires|NONE^|Replace cabin air filter^N/A"}
    assert owner_touches.recommendations(ro) == ["Replace front brake pads", "Rotate tires", "Replace cabin air filter"]
    parsed = {"service_operations": [{"recommendations": ["Replace wiper blades", ""]}, {"recommendations": ["n/a"]}]}
    assert owner_touches.recommendations(parsed) == ["Replace wiper blades"]
    assert owner_touches.recommendations({"Recommendations": "|^"}) == []
    with pytest.raises(ValueError):
        owner_touches.render("declined_service", first_name=None, dealership=None, vehicle=None, items=[])


async def _ro(mongo, created, number="RO1", days_ago=3, **fields):
    today = clock.now().astimezone(NY).date()
    row = {"dealer_id": DEALER, "ro_number": number, "customer_id": as_object_id(created["customer_id"]),
           "vin": "1HGCM82633A004352", "Model": "RAV4", "Close Date": _mdy(today - timedelta(days=days_ago)),
           "Open Date": _mdy(today - timedelta(days=days_ago)),
           "Recommendations": "Replace front brake pads^Rotate tires", **fields}
    await mongo[PLATFORM_REPAIR_ORDERS_COLLECTION].insert_one(row)
    return row


@flow
async def test_declined_service_is_followed_up_once_with_the_technicians_words(mongo):
    created = await _new_lead()
    await _staff(created, "Closed Lost")
    await _ro(mongo, created)
    summary = await owner_lifecycle.sweep()
    assert summary["declined_services"] == 1
    done = await _fire_next(mongo, created, "declined_service")
    assert done["status"] == "sent"
    text = (await _outbox(mongo, created))[-1]["text"]
    assert "Replace front brake pads; Rotate tires" in text and "RAV4" not in text.split(":")[0]
    assert [d for d in await _pending(mongo, created) if d["touch"] == "declined_service"] == []
    assert (await owner_lifecycle.sweep())["declined_services"] == 0


@flow
async def test_no_follow_up_when_they_came_back_since(mongo):
    created = await _new_lead()
    await _staff(created, "Closed Lost")
    await _ro(mongo, created)
    await owner_lifecycle.sweep()
    await _ro(mongo, created, number="RO2", days_ago=1, Recommendations="")
    done = await _fire_next(mongo, created, "declined_service")
    assert done["status"] == "cancelled" and "service visit since" in done["reason"]
