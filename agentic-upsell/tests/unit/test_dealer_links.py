"""Dealer Setup's credit application and trade-in links (client, 8 Oct 2026): read with the dealer's details and
allowed through the link guard, like the website; every other link is still blocked unless asked for."""

from upsell_agent.guardrails.link_guard import disallowed_links
from upsell_agent.integrations.dealer_profile import profile_from_record

RECORD = {"_id": "d1", "type": "dealer", "dealer_account_information": {
    "store_name": "Victory Cars Central", "store_website": "https://victorycarscentral.com",
    "credit_finance_application_url": "https://victorycarscentral.com/finance/apply-for-financing/",
    "trade_in_appraisal_url": "https://victorycarscentral.com/value-your-trade/"}}


def test_the_links_come_from_dealer_setup():
    info = profile_from_record("d1", RECORD).public_info()
    assert info["credit_application_link"] == "https://victorycarscentral.com/finance/apply-for-financing/"
    assert info["trade_in_link"] == "https://victorycarscentral.com/value-your-trade/"
    empty = profile_from_record("d1", {"_id": "d1", "dealer_account_information": {}}).public_info()
    assert empty["credit_application_link"] is None and empty["trade_in_link"] is None


def test_the_guard_lets_the_dealers_own_links_through_and_nothing_else():
    info = profile_from_record("d1", RECORD).public_info()
    allowed = [info["website"], info["credit_application_link"], info["trade_in_link"]]
    ok = {"sms_text": "You can apply here: https://victorycarscentral.com/finance/apply-for-financing/"}
    assert disallowed_links(ok, inventory=[], link_requested=False, allowed=allowed) == []
    other = {"sms_text": "Apply here: https://example.com/credit"}
    assert disallowed_links(other, inventory=[], link_requested=False, allowed=allowed)
