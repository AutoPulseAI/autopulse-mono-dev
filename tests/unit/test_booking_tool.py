"""MASTER_PLAN_3 B5, tools/booking_tool.py: available times (B0.10's rules),
matching the customer's pick, and the booking-wording rule (architecture §15
decision 60). Pure functions; find_active_booking/ensure_booking/move_booking/
cancel_booking (the platform I/O) are covered in tests/unit/test_turn_pipeline.py's
booking scenarios instead."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta

from upsell_agent.integrations.dealer_profile import profile_from_record
from upsell_agent.tools import booking_tool

DEALER = "66f0000000000000000000a1"
NY = "America/New_York"
HOURS = {
    **{day: {"active": True, "start": "9:00 AM", "end": "7:00 PM"}
       for day in ("monday", "tuesday", "wednesday", "thursday", "friday")},
    "saturday": {"active": True, "start": "9:00 AM", "end": "5:00 PM"},
    "sunday": {"active": False, "start": "", "end": ""},
}
# Tuesday 29 Sept 2026, noon New York.
TUESDAY_NOON = datetime(2026, 9, 29, 16, 0, tzinfo=UTC)


def _dealer(**info):
    return profile_from_record(DEALER, {"dealer_account_information": {"time_zone": NY, "weekly_availability": HOURS,
                                                                        **info}})


# --- candidate_slots / available_times (B0.10) --------------------------------------

def test_earliest_slot_is_at_least_two_hours_out():
    dealer = _dealer()
    slots = booking_tool.candidate_slots(dealer, TUESDAY_NOON)
    first = slots[0].astimezone(dealer.tz)
    assert first >= TUESDAY_NOON.astimezone(dealer.tz) + timedelta(hours=booking_tool.EARLIEST_HOURS_OUT)
    assert first.time().minute in (0, 30)


def test_slots_are_one_hour_and_the_last_starts_an_hour_before_closing():
    # Client, 5 Oct 2026: one-hour appointment slots.
    dealer = _dealer()
    slots = booking_tool.candidate_slots(dealer, TUESDAY_NOON)
    today = [s for s in slots if s.astimezone(dealer.tz).date() == TUESDAY_NOON.astimezone(dealer.tz).date()]
    assert all(s.minute == 0 for s in today)
    last = today[-1].astimezone(dealer.tz)
    assert last.time().isoformat("minutes") == "18:00"  # closes 19:00


def test_no_slots_on_a_closed_day():
    dealer = _dealer()
    slots = booking_tool.candidate_slots(dealer, TUESDAY_NOON, days_ahead=7)
    sundays = [s for s in slots if s.astimezone(dealer.tz).weekday() == 6]
    assert sundays == []


def _booked(target, count, *, appointment_type=None, minute="00"):
    row = {"bookingDate": target.astimezone(UTC), "bookingTime": target.strftime(f"%H:{minute}")}
    if appointment_type:
        row["appointment_type"] = appointment_type
    return [{**row, "lead_id": f"other-{i}"} for i in range(count)]


def test_a_sales_slot_takes_ten_bookings_then_is_full():
    # Client, 5 Oct 2026: a one-hour sales slot books up to 10 appointments.
    dealer = _dealer()
    target = booking_tool.candidate_slots(dealer, TUESDAY_NOON)[0]
    assert target in booking_tool.available_times(dealer, _booked(target, 9), TUESDAY_NOON)
    assert target not in booking_tool.available_times(dealer, _booked(target, 10), TUESDAY_NOON)


def test_a_booking_at_half_past_counts_in_its_hour():
    dealer = _dealer()
    target = booking_tool.candidate_slots(dealer, TUESDAY_NOON)[0]
    assert target not in booking_tool.available_times(dealer, _booked(target, 10, minute="30"), TUESDAY_NOON)


def test_service_bookings_never_fill_a_sales_slot():
    # Service appointments have their own one-per-hour slots in the CRM; the AI books sales visits only.
    dealer = _dealer()
    target = booking_tool.candidate_slots(dealer, TUESDAY_NOON)[0]
    existing = _booked(target, 10, appointment_type="service")
    assert target in booking_tool.available_times(dealer, existing, TUESDAY_NOON)


def test_a_dealer_s_own_sales_capacity_wins():
    dealer = replace(_dealer(), sales_per_slot=2)
    target = booking_tool.candidate_slots(dealer, TUESDAY_NOON)[0]
    assert target not in booking_tool.available_times(dealer, _booked(target, 2), TUESDAY_NOON)


def test_a_lead_s_own_existing_booking_does_not_block_itself():
    dealer = _dealer()
    slots = booking_tool.candidate_slots(dealer, TUESDAY_NOON)
    target = slots[0]
    existing = [{"lead_id": "lead-1", "bookingDate": target.astimezone(UTC), "bookingTime": target.strftime("%H:%M")}]
    available = booking_tool.available_times(dealer, existing, TUESDAY_NOON, exclude_lead_id="lead-1")
    assert target in available


def test_offer_times_takes_the_earliest_three():
    dealer = _dealer()
    available = booking_tool.available_times(dealer, [], TUESDAY_NOON)
    offered = booking_tool.offer_times(available)
    assert offered == available[:3] and len(offered) == 3


# --- format_offer (dealer time; zone only when the customer's differs) --------------

def test_display_is_plain_words_in_dealer_time():
    dealer = _dealer()
    slots = booking_tool.candidate_slots(dealer, TUESDAY_NOON)[:1]
    formatted = booking_tool.format_offer(slots, dealer)
    assert formatted[0]["display"].startswith("Tuesday at ") and "Eastern" not in formatted[0]["display"]


def test_zone_name_added_only_when_the_customer_s_differs():
    dealer = _dealer()
    slots = booking_tool.candidate_slots(dealer, TUESDAY_NOON)[:1]
    same = booking_tool.format_offer(slots, dealer, customer_zones=(NY,))
    assert "Eastern" not in same[0]["display"]
    different = booking_tool.format_offer(slots, dealer, customer_zones=("America/Los_Angeles",))
    assert different[0]["display"].endswith("Eastern")
    unknown = booking_tool.format_offer(slots, dealer, customer_zones=())
    assert "Eastern" not in unknown[0]["display"]


# --- match_pick (B5 item 2) -----------------------------------------------------------

def test_ordinal_words_match_the_offered_position():
    dealer = _dealer()
    offered = booking_tool.format_offer(booking_tool.candidate_slots(dealer, TUESDAY_NOON)[:3], dealer)
    assert booking_tool.match_pick("the second one", offered, dealer, TUESDAY_NOON).matched == offered[1]
    assert booking_tool.match_pick("option 3", offered, dealer, TUESDAY_NOON).matched == offered[2]


def test_a_named_day_and_time_matches_the_offered_slot():
    dealer = _dealer()
    saturday = next(s for s in booking_tool.candidate_slots(dealer, TUESDAY_NOON)
                    if s.astimezone(dealer.tz).weekday() == 5 and s.astimezone(dealer.tz).hour == 10
                    and s.astimezone(dealer.tz).minute == 0)
    offered = booking_tool.format_offer([saturday], dealer)
    result = booking_tool.match_pick("Saturday at 10 works for me", offered, dealer, TUESDAY_NOON)
    assert result.matched == offered[0]


def test_a_day_alone_with_one_offered_time_that_day_matches():
    dealer = _dealer()
    saturday = next(s for s in booking_tool.candidate_slots(dealer, TUESDAY_NOON)
                    if s.astimezone(dealer.tz).weekday() == 5)
    offered = booking_tool.format_offer([saturday], dealer)
    assert booking_tool.match_pick("Saturday works", offered, dealer, TUESDAY_NOON).matched == offered[0]


def test_a_time_that_was_not_offered_and_is_not_free_is_ambiguous():
    dealer = _dealer()
    offered = booking_tool.format_offer(booking_tool.candidate_slots(dealer, TUESDAY_NOON)[:1], dealer)
    result = booking_tool.match_pick("Sunday at 3", offered, dealer, TUESDAY_NOON, available=[])
    assert result.matched is None and result.ambiguous is True


def test_a_free_time_that_was_not_offered_still_matches_when_available():
    dealer = _dealer()
    slots = booking_tool.candidate_slots(dealer, TUESDAY_NOON)
    offered = booking_tool.format_offer(slots[:1], dealer)
    other = slots[5]
    local = other.astimezone(dealer.tz)
    clock_text = local.strftime("%I:%M %p").lstrip("0")
    result = booking_tool.match_pick(f"{local:%A} at {clock_text}", offered, dealer, TUESDAY_NOON, available=slots)
    assert result.matched is not None and result.matched["iso"] == other.astimezone(dealer.tz).isoformat()


def test_nothing_date_like_does_not_match():
    dealer = _dealer()
    offered = booking_tool.format_offer(booking_tool.candidate_slots(dealer, TUESDAY_NOON)[:2], dealer)
    result = booking_tool.match_pick("sounds good, thanks!", offered, dealer, TUESDAY_NOON)
    assert result.matched is None and result.ambiguous is False


# --- Booking wording (architecture §15 decision 60) ----------------------------------

def test_wording_matches_the_real_status():
    assert booking_tool.wording_for_status("pending") == "requested"
    assert booking_tool.wording_for_status("confirmed") == "confirmed"
    assert booking_tool.wording_for_status("cancelled") is None
    assert booking_tool.wording_for_status(None) is None


# --- A day the customer asks for ("not Wednesday, what about Monday?") ---------------------------------

def test_the_day_asked_for_ignores_a_day_turned_down():
    dealer = _dealer()
    request = booking_tool.preferred_day("Not Wednesday, what about Monday?", dealer, TUESDAY_NOON)
    assert request.day.isoformat() == "2026-10-05" and request.part is None
    assert booking_tool.preferred_day("Thursday doesn't work, Friday?", dealer, TUESDAY_NOON).day.isoformat() \
        == "2026-10-02"


def test_a_day_with_a_time_or_no_day_is_not_a_day_request():
    dealer = _dealer()
    assert booking_tool.preferred_day("Monday at 10am?", dealer, TUESDAY_NOON) is None
    assert booking_tool.preferred_day("sounds good", dealer, TUESDAY_NOON) is None


def test_a_part_of_the_day():
    dealer = _dealer()
    assert booking_tool.preferred_day("Monday afternoon?", dealer, TUESDAY_NOON).part_words == "afternoon"
    span, words = booking_tool.part_of_day("Friday after 5")
    assert span[0].hour == 17 and words == "after 5"


def test_times_on_the_day_asked_for_are_spread_across_it():
    dealer = _dealer()
    available = booking_tool.available_times(dealer, [], TUESDAY_NOON, days_ahead=14)
    request = booking_tool.preferred_day("what about Monday?", dealer, TUESDAY_NOON)
    times, day, on_day = booking_tool.times_on_day(available, request, dealer)
    local = [t.astimezone(dealer.tz) for t in times]
    assert on_day and day.isoformat() == "2026-10-05" and len(times) == 3
    assert {t.date().isoformat() for t in local} == {"2026-10-05"}
    assert local[0].hour == 9 and local[-1].hour == 18  # first, middle and last of the day


def test_a_closed_day_offers_the_next_open_one():
    dealer = _dealer()
    available = booking_tool.available_times(dealer, [], TUESDAY_NOON, days_ahead=14)
    request = booking_tool.preferred_day("Sunday afternoon?", dealer, TUESDAY_NOON)
    times, day, on_day = booking_tool.times_on_day(available, request, dealer)
    assert not on_day and day.isoformat() == "2026-10-05"  # closed Sunday -> Monday
    assert all(12 <= t.astimezone(dealer.tz).hour < 17 for t in times)  # still in the afternoon
