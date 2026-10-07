"""PLAN_4 stream X1 item 2: explicit opt-outs are caught in code, never left to the model (TCPA PDF §3, client
answer Q10: "stop with no other context always opts the customer out"). A short message whose meaning is
stopping contact is an opt-out; "stop calling" is calls, "stop texting" texts, "stop emailing" email, anything
general every channel. Objections and everyday uses of "stop" are not."""

import pytest

from upsell_agent.compliance.opt_out import ALL_CHANNELS, detect_opt_out

SMS, EMAIL, VOICE = ("sms",), ("email",), ("voice",)


@pytest.mark.parametrize(("text", "channels"), [
    # Bare carrier keywords stay keywords on the channel they came on (tested in test_compliance.py);
    # everything below is a short message around them.
    ("please stop", ALL_CHANNELS),
    ("Stop please", ALL_CHANNELS),
    ("STOP ALL", ALL_CHANNELS),
    ("STOP STOP", ALL_CHANNELS),
    ("stop it", ALL_CHANNELS),
    ("I said stop", ALL_CHANNELS),
    ("ok stop now", ALL_CHANNELS),
    ("STOP. Thanks", ALL_CHANNELS),
    ("unsubscribe please", ALL_CHANNELS),
    ("Unsubscribe me", ALL_CHANNELS),
    ("please unsubscribe", ALL_CHANNELS),
    ("opt me out", ALL_CHANNELS),
    ("I want to opt out", ALL_CHANNELS),
    ("Opt-out please", ALL_CHANNELS),
    ("cancel please", ALL_CHANNELS),
    ("quit it", ALL_CHANNELS),
    ("remove me", ALL_CHANNELS),
    ("Please remove me", ALL_CHANNELS),
    ("take me off", ALL_CHANNELS),
    ("take me off your list", ALL_CHANNELS),
    ("do not contact", ALL_CHANNELS),
    ("Do not contact me again", ALL_CHANNELS),
    ("stop sending me messages", ALL_CHANNELS),
    ("no mas mensajes", ALL_CHANNELS),
    ("No más mensajes por favor", ALL_CHANNELS),
    ("Stop calling", VOICE),
    ("stop calling me!", VOICE),
    ("quit calling me", VOICE),
    ("no more calls", VOICE),
    ("I don't want any more calls", VOICE),
    ("stop texting me", SMS),
    ("STOP TEXTING", SMS),
    ("stop sending texts", SMS),
    ("quit texting me", SMS),
    ("dont txt me", SMS),
    ("I don't want any more texts", SMS),
    ("no more text messages", SMS),
    ("stop emailing me", EMAIL),
    ("stop sending emails", EMAIL),
    ("I don't want any more emails", EMAIL),
    ("I'm not interested, stop texting me", SMS),
])
def test_explicit_opt_outs_are_caught(text, channels):
    found = detect_opt_out(text, "sms")
    assert found is not None, text
    assert found.channels == channels, (text, found)


@pytest.mark.parametrize("text", [
    "don't stop",
    "please don't stop texting me, I like the updates",
    "stop by tomorrow",
    "Can I stop by Saturday?",
    "can I stop in at 3",
    "I'll stop in after work",
    "the car won't stop pulling left",
    "my brakes squeal when I stop",
    "I don't want to stop by today",
    "I'm not interested",
    "not right now",
    "Call me tomorrow",
    "cancel my appointment",
    "can we cancel the 3pm and do 4?",
    "what time do you end today?",
    "at the end of the month",
    "I quit my job so money is tight",
    "Is the remote start an option?",
    "yes",
    "no",
    "remove the roof rack please",
    "I want to opt out of the extended warranty",
])
def test_everyday_messages_are_not_opt_outs(text):
    assert detect_opt_out(text, "sms") is None, text


@pytest.mark.parametrize("text", ["Stop!!! 🛑", "END.", "  stop ", "Quit", "CANCEL", "unsubscribe."])
def test_a_bare_keyword_with_emoji_or_punctuation_is_still_the_carrier_keyword(text):
    found = detect_opt_out(text, "sms")
    assert found is not None and found.kind == "keyword" and found.channels == SMS


async def test_please_stop_in_a_conversation_opts_out_of_everything_before_any_reply(mongo):
    from tests.unit.conftest import set_clock
    from tests.unit.test_compliance import DEALER, _deps, _inbound, _lead, ny
    from upsell_agent.channels import consent
    from upsell_agent.devtools import simulate
    from upsell_agent.events import handlers
    from upsell_agent.integrations.mongodb import DEV_OUTBOX_COLLECTION, dealer_scoped_db

    await simulate.ensure_platform_dealers()
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    result = await handlers.handle_inbound_message(_inbound(created, "Please stop 🙏"), _deps())
    assert result["status"] == "opted_out"
    db = dealer_scoped_db(DEALER)
    for channel in ALL_CHANNELS:
        assert await consent.is_opted_out(db, created["customer_id"], channel)
    [sent] = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    assert sent["text"] == "Understood, we won't contact you again."
