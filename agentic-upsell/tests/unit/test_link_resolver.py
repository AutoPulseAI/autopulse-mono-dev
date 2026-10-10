"""agent/link_resolver.py: which link a reply may carry (conversation_7)."""

from upsell_agent.agent.link_resolver import (
    NO_PAGE_LINE,
    OTHER_LINE,
    TARGET_CONFIDENCE,
    LinkPlan,
    fill_links,
    resolve_link,
)

RDX, MDX = "5J8TC2H34PL000001", "5FRYD3H56HB013419"
RDX_PAGE = "https://www.victorycarscentral.com/inventory/used-2023-acura-rdx/"
HOME = "https://www.victorycarscentral.com"
STOCK = [{"vin": RDX, "year": 2023, "make": "Acura", "model": "RDX", "page_url": RDX_PAGE},
         {"vin": MDX, "year": 2017, "make": "Acura", "model": "MDX", "page_url": None}]


def _asked(target="unclear", sure=0.5, vin=None):
    return {"wants_link": True, "wants_link_confidence": 0.9, "link_target": target,
            "link_target_confidence": sure, "link_target_vin": vin}


def test_no_link_request_no_link():
    assert resolve_link({"wants_link": False}, inventory=STOCK, website=HOME).kind == "none"
    assert resolve_link({"wants_link": True, "wants_link_confidence": 0.5}, inventory=STOCK, website=HOME).kind == "none"


def test_sure_about_a_vehicle_sends_its_page_only():
    plan = resolve_link(_asked("vehicle", 0.9, RDX), inventory=STOCK, website=HOME)
    assert plan.kind == "vehicle" and plan.urls == [RDX_PAGE]


def test_jean_send_me_a_link_to_look_gets_the_rdx_page_then_the_homepage():
    """conversation_7: "Can you send me a link to look please" on a 2023 RDX lead got only the homepage."""
    plan = resolve_link(_asked(), inventory=STOCK, website=HOME, lead_vin=RDX)
    assert plan.kind == "vehicle_and_website" and plan.urls == [RDX_PAGE, HOME] and plan.vin == RDX


def test_the_threshold_decides_one_link_or_both():
    below = resolve_link(_asked("vehicle", TARGET_CONFIDENCE - 0.01, RDX), inventory=STOCK, website=HOME)
    at = resolve_link(_asked("vehicle", TARGET_CONFIDENCE, RDX), inventory=STOCK, website=HOME)
    assert below.kind == "vehicle_and_website" and at.kind == "vehicle"


def test_not_sure_and_no_homepage_on_record_sends_the_vehicle_page():
    assert resolve_link(_asked(), inventory=STOCK, website=None, lead_vin=RDX).urls == [RDX_PAGE]


def test_a_vehicle_with_no_page_gets_the_honest_line_never_the_homepage():
    plan = resolve_link(_asked("vehicle", 0.9, MDX), inventory=STOCK, website=HOME)
    assert plan.kind == "unavailable" and plan.urls == [] and plan.honest_line == NO_PAGE_LINE
    assert MDX in plan.promise


def test_the_website_asked_for_plainly():
    assert resolve_link(_asked("website", 0.9), inventory=STOCK, website=HOME).urls == [HOME]
    plan = resolve_link(_asked("website", 0.9), inventory=STOCK, website=None)
    assert plan.kind == "unavailable" and plan.urls == []


def test_a_link_we_dont_hold_is_never_invented():
    plan = resolve_link(_asked("other", 0.9), inventory=STOCK, website=HOME, lead_vin=RDX)
    assert plan.kind == "unavailable" and plan.urls == [] and plan.honest_line == OTHER_LINE


def test_no_vehicle_to_point_at_asks_which():
    two = [{**STOCK[0]}, {**STOCK[1], "page_url": "https://x.test/mdx"}]
    assert resolve_link(_asked(), inventory=two, website=HOME).kind == "ask_which"


def test_a_vin_not_in_this_turns_stock_is_never_linked():
    plan = resolve_link(_asked("vehicle", 0.9, "NOTINSTOCK"), inventory=STOCK[:1] + STOCK[1:], website=HOME)
    assert "NOTINSTOCK" not in (plan.vin or "")


def test_fill_links_puts_the_real_urls_in_place_of_the_placeholders():
    plan = LinkPlan(kind="vehicle_and_website", vin=RDX, vehicle_url=RDX_PAGE, website_url=HOME)
    draft = {"sms_text": "Here's the RDX: [VEHICLE_LINK]. You can also browse at [WEBSITE_LINK].",
             "email_subject": "Your RDX", "email_body": "Hi,\n\nHere's the RDX: [VEHICLE_LINK]",
             "sms_vins": [], "email_vins": []}
    fill_links(draft, plan, sms_limit=320)
    assert draft["sms_text"] == f"Here's the RDX: {RDX_PAGE}. You can also browse at {HOME}."
    assert RDX_PAGE in draft["email_body"] and HOME in draft["email_body"] and "{{" not in draft["email_body"]
    assert draft["sms_vins"] == [RDX] and draft["email_vins"] == [RDX]


def test_fill_links_adds_the_page_when_the_draft_left_it_out():
    plan = LinkPlan(kind="vehicle", vin=RDX, vehicle_url=RDX_PAGE)
    draft = {"sms_text": "Sure thing!", "email_subject": "x", "email_body": "Hi,\n\nSure thing!"}
    fill_links(draft, plan, sms_limit=320)
    assert draft["sms_text"].endswith(RDX_PAGE)


def test_fill_links_removes_a_placeholder_with_no_url_and_records_the_promise():
    plan = LinkPlan(kind="unavailable", vin=MDX, honest_line=NO_PAGE_LINE, promise="The team will send it.")
    draft = {"sms_text": f"{NO_PAGE_LINE} [WEBSITE_LINK]", "email_subject": "x", "email_body": "Hi"}
    fill_links(draft, plan)
    assert "{{" not in draft["sms_text"] and draft["promises"] == ["The team will send it."]
