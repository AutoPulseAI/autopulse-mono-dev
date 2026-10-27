"""Betsy, 27 Oct 2026: on Monday the AI offered "Monday at 4 PM" instead of "today at 4 PM"."""

from datetime import datetime
from zoneinfo import ZoneInfo

from upsell_agent import clock
from upsell_agent.tools.booking_tool import day_word

NY = ZoneInfo("America/New_York")


def test_today_tomorrow_then_weekday(monkeypatch):
    # Monday 26 Oct 2026, 3 PM New York (19:00 UTC).
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 10, 26, 19, 0, tzinfo=ZoneInfo("UTC")))
    assert day_word(datetime(2026, 10, 26, 16, 0, tzinfo=NY)) == "today"
    assert day_word(datetime(2026, 10, 27, 10, 0, tzinfo=NY)) == "tomorrow"
    assert day_word(datetime(2026, 10, 28, 10, 0, tzinfo=NY)) == "Wednesday"


def test_dealer_day_not_utc_day(monkeypatch):
    # 9:30 PM Monday in New York is already Tuesday in UTC: Tuesday 10 AM is still "tomorrow".
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 10, 27, 1, 30, tzinfo=ZoneInfo("UTC")))
    assert day_word(datetime(2026, 10, 27, 10, 0, tzinfo=NY)) == "tomorrow"


def test_pick_next_day_is_said_from_the_reply(monkeypatch):
    """"Tomorrow at 10" offered on Monday, "10 works" on Tuesday morning: confirmed as today, the right date."""
    from types import SimpleNamespace

    from upsell_agent.tools.booking_tool import match_pick

    dealer = SimpleNamespace(tz=NY, timezone="America/New_York")
    offered = [{"iso": "2026-10-27T10:00:00-04:00", "date": "2026-10-27", "time": "10:00",
                "display": "tomorrow at 10:00 AM"}]
    tuesday_8am = datetime(2026, 10, 27, 12, 0, tzinfo=ZoneInfo("UTC"))
    pick = match_pick("10 works", offered, dealer, tuesday_8am)
    assert pick.matched["date"] == "2026-10-27"
    assert pick.matched["display"] == "today at 10:00 AM"
