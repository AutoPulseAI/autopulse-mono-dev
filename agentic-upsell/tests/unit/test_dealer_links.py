"""Dealer Setup's credit application and trade-in links (client, 8 Oct 2026): read with the dealer's details,
shared only when the customer asks for them (agent/link_resolver.py), and every other link still blocked."""

from upsell_agent.agent.link_resolver import resolve_link
from upsell_agent.guardrails.link_guard import disallowed_links
from upsell_agent.integrations.dealer_profile import profile_from_record

CREDIT = "https://victorycarscentral.com/finance/apply-for-financing/"
TRADE = "https://victorycarscentral.com/value-your-trade/"
RECORD = {"_id": "d1", "type": "dealer", "dealer_account_information": {
    "store_name": "Victory Cars Central", "store_website": "https://victorycarscentral.com",
    "credit_finance_application_url": CREDIT, "trade_in_appraisal_url": TRADE}}


def _links(info):
    return {"credit_application": info["credit_application_link"], "trade_in": info["trade_in_link"]}


def _asked(target, sure=0.9):
    return {"wants_link": True, "wants_link_confidence": 0.9, "link_target": target, "link_target_confidence": sure}


def test_the_links_come_from_dealer_setup():
    info = profile_from_record("d1", RECORD).public_info()
    assert info["credit_application_link"] == CREDIT
    assert info["trade_in_link"] == TRADE
    empty = profile_from_record("d1", {"_id": "d1", "dealer_account_information": {}}).public_info()
    assert empty["credit_application_link"] is None and empty["trade_in_link"] is None


def test_asked_for_the_credit_application_or_trade_in_gets_that_page():
    info = profile_from_record("d1", RECORD).public_info()
    credit = resolve_link(_asked("credit_application"), inventory=[], website=info["website"],
                          dealer_links=_links(info))
    trade = resolve_link(_asked("trade_in"), inventory=[], website=info["website"], dealer_links=_links(info))
    assert credit.kind == "credit_application" and credit.urls == [CREDIT]
    assert trade.kind == "trade_in" and trade.urls == [TRADE]


def test_not_set_up_in_dealer_setup_means_no_link_and_the_team_is_told():
    plan = resolve_link(_asked("trade_in"), inventory=[], website="https://victorycarscentral.com",
                        dealer_links={"credit_application": None, "trade_in": None})
    assert plan.kind == "unavailable" and plan.urls == [] and "trade-in" in plan.promise


def test_the_guard_lets_the_plans_dealer_link_through_and_nothing_else():
    ok = {"sms_text": f"You can apply here: {CREDIT}"}
    assert disallowed_links(ok, allowed=[CREDIT]) == []
    assert disallowed_links({"sms_text": "Apply here: https://example.com/credit"}, allowed=[CREDIT])
    # Not asked for this turn: the dealer's own page is blocked like any other link.
    assert disallowed_links(ok, allowed=[])
