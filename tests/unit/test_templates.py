"""Reply templates (MASTER_PLAN_1 Stage 4): every lead type has both channel
versions, SMS fits two segments even with the longest allowed name, and no
template can break the never-invent rule."""

import re

import pytest

from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.templates import (
    FIRST_NAME_MAX_CHARS,
    FIRST_REPLY,
    SMS_MAX_CHARS,
    first_name,
    render_first_reply,
)


@pytest.mark.parametrize("lead_type", list(LeadType))
def test_every_lead_type_has_both_channel_versions(lead_type):
    draft = render_first_reply(lead_type, "Maria Lopez")
    assert draft["sms_text"].startswith("Hi Maria,")
    assert draft["email_body"].startswith("Hi Maria,")
    assert draft["email_subject"]
    assert draft["template"] == lead_type.value


@pytest.mark.parametrize("lead_type", list(LeadType))
def test_sms_fits_two_segments_with_the_longest_name(lead_type):
    longest = "A" * FIRST_NAME_MAX_CHARS
    assert len(render_first_reply(lead_type, longest)["sms_text"]) <= SMS_MAX_CHARS


@pytest.mark.parametrize("lead_type", list(LeadType))
def test_templates_contain_no_numbers_or_prices(lead_type):
    template = FIRST_REPLY[lead_type]
    for text in (template.sms, template.email_subject, template.email_body):
        assert not re.search(r"\d|\$|guarantee|approved", text, re.IGNORECASE)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("maria lopez", "Maria"), ("  JAMES  ", "James"), (None, "there"), ("", "there"), ("123", "there"),
     ("O'Neil Smith", "O'neil"), ("x" * 80, "X" + "x" * (FIRST_NAME_MAX_CHARS - 1))],
)
def test_first_name(raw, expected):
    assert first_name(raw) == expected


def test_unknown_lead_type_uses_the_general_template():
    assert render_first_reply(None, "Pat")["template"] == "general"
