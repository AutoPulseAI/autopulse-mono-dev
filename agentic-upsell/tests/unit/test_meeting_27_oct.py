"""Betsy and Bibi, 27 Oct 2026 meeting (BUILD-PLAN-27-OCT.md): no promise of options nothing will send (item 7), and a
booked customer who isn't sure keeps the appointment, marked tentative (item 6)."""

import pytest

from upsell_agent.agent import appointment
from upsell_agent.agent.nodes.guard import unbacked_options_promise


@pytest.mark.parametrize(("text", "flagged"), [
    ("No pressure - if tomorrow ends up tough, I can line up options that fit.", True),
    ("I'll put together a few options for you.", True),
    ("Let me find you some alternatives.", True),
    ("We have the 2022 Highlander XLE and the 2021 Pilot EX-L in stock. Which one would you like to see?", False),
    ("You're all set for tomorrow at 1 PM.", False),
])
def test_a_promise_of_options_later_is_stopped(text, flagged):
    assert bool(unbacked_options_promise({"action": "acknowledge"}, {"sms_text": text})) is flagged


def test_a_handoff_may_say_a_manager_will_find_options():
    assert not unbacked_options_promise({"action": "handoff"}, {"sms_text": "I can find you some options."})


@pytest.mark.parametrize(("text", "maybe"), [
    ("I can't confirm because I might not make it due to the distance and health conditions but I would like to keep "
     "tomorrow in mind", True),
    ("maybe", True), ("I'll try to make it", True), ("not sure if I can", True),
    ("I need to cancel", False), ("I won't make it", False), ("yes", False), ("can I come at 3 instead?", False),
])
def test_maybe_is_not_no(text, maybe):
    assert appointment.is_maybe(text) is maybe
