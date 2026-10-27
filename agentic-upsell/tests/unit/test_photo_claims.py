"""Never say a photo is attached when none goes (Cathy Lanza, 27 Oct 2026: "Can you send me a picture of the car" ->
"Sure thing—here it is." with no photo; it had failed the image check at send time)."""

import pytest

from upsell_agent.agent.media import NO_PHOTO_LINE, drop_photo_claims

CATHY = ("Sure thing—here it is. The 2019 BMW X3 xDrive30i you asked about is here in Dark Graphite with 19,653 "
         "miles. Want to swing by today at 1:00 PM, 2:00 PM, or 3:00 PM to check it out?")


def test_cathy_gets_what_will_happen_instead():
    text, dropped = drop_photo_claims(CATHY, asked_for_photos=True)
    assert dropped and text.startswith(NO_PHOTO_LINE)
    assert "here it is" not in text and "Dark Graphite with 19,653 miles" in text and "2:00 PM" in text


@pytest.mark.parametrize("claim", ["I've attached a photo of the car.", "Here are some pictures.",
                                   "Photos are attached below.", "I'm sending you a photo now."])
def test_any_photo_claim_goes(claim):
    text, dropped = drop_photo_claims(f"{claim} Would 2:00 PM work?", asked_for_photos=False)
    assert dropped and text == "Would 2:00 PM work?"


def test_here_it_is_only_counts_after_a_photo_request():
    # "The car is here" / "here it is" about something else stays when they didn't ask for photos.
    text = "Here it is: 3914 Hempstead Tpke, Levittown. Would 2:00 PM work?"
    assert drop_photo_claims(text, asked_for_photos=False) == (text, False)


def test_a_reply_without_claims_is_unchanged():
    text = "The car is here in Dark Graphite. Would 2:00 PM work?"
    assert drop_photo_claims(text, asked_for_photos=True) == (text, False)
