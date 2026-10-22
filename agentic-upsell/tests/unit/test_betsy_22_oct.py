"""Betsy, 22 Oct 2026 - inventory, links and cost (her email in the "filter" thread, and the WhatsApp note on cost).

- The first message to a new lead carries the vehicle's photo, not a link.
- "Can I see photos?" gets the vehicle's photos by MMS (never staff, never a link), then the appointment.
- A link only when asked (the car, its Carfax); every link goes out as a short AutoPulse link to the same page.
- Dealer cost / invoice never reach the AI: only the list price.
- The dealership's own links (trade estimate, prequalification, ... OEM incentives) go out when asked for.
"""

import pytest

from tests.unit.conftest import expand_short_links
from tests.unit.test_client_requirements import RAV4, _new_lead, _sent
from tests.unit.test_inventory_tool import DEALER, _stock, _vehicle
from upsell_agent.agent import cannot_supply, short_links
from upsell_agent.agent.link_resolver import resolve_link
from upsell_agent.agent.vehicle_media import PHOTOS_ON_REQUEST, ImageCheck, asks_for_photos, pick_vehicle_photos, \
    use_image_checker
from upsell_agent.integrations.mongodb import DEV_OUTBOX_COLLECTION, dealer_scoped_db
from upsell_agent.tools.inventory_tool import to_listing, to_record

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer")


async def _outbox(mongo, created, channel="sms"):
    return await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"], "channel": channel}).sort(
        "created_at", 1).to_list(None)


# --- The first message: an image, not a link ---------------------------------------------------------------------

async def test_the_first_text_carries_the_vehicle_photo_and_no_link(mongo):
    await _stock(mongo, _vehicle("VIN0000000000CR01"))
    created = await _new_lead(mongo, vehicle=RAV4, comments="Is it still available?")
    [first] = (await _outbox(mongo, created))[:1]
    assert first["media_urls"] == ["https://img.example/VIN0000000000CR01.jpg"]
    assert "http" not in first["text"]


async def test_a_lead_without_a_vin_gets_the_one_matching_cars_photo(mongo):
    await _stock(mongo, _vehicle("VIN0000000000CR01"))
    created = await _new_lead(mongo, vehicle={"year": 2022, "make": "Honda", "model": "CR-V"},
                              comments="Is it still available?")
    [first] = (await _outbox(mongo, created))[:1]
    assert first["media_urls"] == ["https://img.example/VIN0000000000CR01.jpg"]


# --- Photos when asked --------------------------------------------------------------------------------------------

@pytest.mark.parametrize("text,want", [
    ("Can you send me pictures?", True), ("more photos please", True), ("any pics of it?", True),
    ("can you send a video?", False), ("walk around video please", False), ("is it available?", False),
])
def test_asks_for_photos(text, want):
    assert asks_for_photos(text) is want


def test_more_photos_is_not_something_only_staff_can_do_but_a_video_is():
    assert cannot_supply.detect("Can you send me more photos?") != cannot_supply.CUSTOM_MEDIA
    assert cannot_supply.detect("Can you send me a video of it?") == cannot_supply.CUSTOM_MEDIA


class _Sized:
    def __init__(self, size):
        self.size = size

    async def check(self, url):
        return ImageCheck(True, "test", self.size)


async def test_photos_on_request_stay_within_twilios_5_mb(mongo):
    await _stock(mongo, _vehicle("VIN0000000000CR01", imagesSecure=[f"https://img.example/{i}.jpg" for i in range(6)]))
    from tests.unit.conftest import make_settings
    pick = await pick_vehicle_photos(DEALER, "VIN0000000000CR01", channel="sms", settings=make_settings("DEV"),
                                     checker=_Sized(1024 * 1024))
    assert len(pick.urls) == PHOTOS_ON_REQUEST
    pick = await pick_vehicle_photos(DEALER, "VIN0000000000CR01", channel="sms", settings=make_settings("DEV"),
                                     checker=_Sized(2 * 1024 * 1024))
    assert len(pick.urls) == 2  # a third 2 MB photo would pass 5 MB


async def test_asking_for_photos_sends_them_and_asks_for_the_visit(mongo):
    from tests.unit.test_client_requirements import _deps  # noqa: F401
    from tests.unit.test_human_contact import _say
    await _stock(mongo, _vehicle("VIN0000000000CR01", imagesSecure=[f"https://img.example/p{i}.jpg" for i in range(5)]))
    created = await _new_lead(mongo, vehicle=RAV4)
    use_image_checker(_Sized(100_000))
    try:
        await _say(created, "Can you send me some pictures of it?")
    finally:
        use_image_checker(None)
    last = (await _outbox(mongo, created))[-1]
    assert len(last["media_urls"]) == PHOTOS_ON_REQUEST
    assert "http" not in last["text"] and "?" in last["text"]
    state = await mongo["ai_lead_state"].find_one({"lead_id": created["lead_id"]})
    assert (state.get("staff_notice") or {}).get("kind") != "cannot_supply"


# --- Links: when asked, and short ---------------------------------------------------------------------------------

async def test_a_link_goes_out_short_and_opens_the_same_page(mongo):
    db = dealer_scoped_db(DEALER)
    text, notes = await short_links.shorten_links(db, "Here it is: https://dealer.example/v/X1.", base="https://autopulse.ai",
                                                  lead_id="L1")
    assert text.startswith("Here it is: https://autopulse.ai/l/") and text.endswith(".") and notes
    assert await expand_short_links(mongo, text) == "Here it is: https://dealer.example/v/X1."
    again, _ = await short_links.shorten_links(db, "https://dealer.example/v/X1", base="https://autopulse.ai",
                                               lead_id="L1")
    assert again == text.removeprefix("Here it is: ").rstrip(".")  # one code per lead and page
    unchanged, _ = await short_links.shorten_links(db, "https://dealer.example/v/X1", base="", lead_id="L1")
    assert unchanged == "https://dealer.example/v/X1"  # no base set: the full link


@pytest.mark.parametrize("target", ["prequalification", "hours_map", "service_scheduler", "new_car_specials",
                                    "used_car_specials", "service_specials", "parts_specials", "oem_incentives"])
def test_each_dealer_link_goes_out_when_asked(target):
    extraction = {"wants_link": True, "wants_link_confidence": 0.95, "link_target": target,
                  "link_target_confidence": 0.95}
    plan = resolve_link(extraction, inventory=[], website=None, dealer_links={target: f"https://d.example/{target}"})
    assert plan.kind == target and plan.dealer_url == f"https://d.example/{target}"
    missing = resolve_link(extraction, inventory=[], website=None, dealer_links={})
    assert missing.kind == "unavailable" and missing.honest_line and not missing.dealer_url


def test_no_link_unless_asked():
    plan = resolve_link({"wants_link": False}, inventory=[], website="https://d.example",
                        dealer_links={"prequalification": "https://d.example/pq"})
    assert plan.kind == "none"


# --- Cost never reaches the AI ------------------------------------------------------------------------------------

def test_dealer_cost_invoice_and_wholesale_never_reach_the_ai():
    feed_row = _vehicle("VIN0000000000CR01", cost=21000, totalCost=21500, invoice=22000, wholesale=20000,
                        dealercost=20500)
    record = to_record(to_listing(feed_row)).model_dump()
    assert record["price"] == 27995  # the list price
    seen = repr(record)
    for secret in ("21000", "21500", "22000", "20000", "20500"):
        assert secret not in seen


# --- Everything above is AutoPulse's to change in AI Studio (23 Oct 2026) ------------------------------------------

async def test_ai_studio_controls_the_new_rules(mongo, monkeypatch):
    from upsell_agent import ai_studio
    from upsell_agent.agent import link_resolver, vehicle_media
    from upsell_agent.agent.nodes import decide
    from upsell_agent.compliance import opt_out
    built = ai_studio._built_in()
    links = dict(built[("compliance", "photos_and_links")])
    rules = dict(built[("compliance", "conversation_rules")])
    oo = dict(built[("compliance", "opt_out")])
    assert links["photos_when_asked"] == 3 and links["short_links"] is True and links["share_prequalification"] is True
    assert rules["busy_rule"] is True and "at work" in rules["busy_phrases"]
    assert oo["inquiry_only"] is True and "never contact me again" in oo["stop_everything_phrases"]
    ai_studio.load({("compliance", "photos_and_links"): {**links, "photos_when_asked": 1, "short_links": False,
                                                         "share_prequalification": False},
                    ("compliance", "conversation_rules"): {**rules, "busy_rule": False},
                    ("compliance", "opt_out"): {**oo, "inquiry_only": False,
                                                "stop_everything_phrases": ["go away forever"]}})
    try:
        assert vehicle_media.PHOTOS_ON_REQUEST == 1 and short_links.ENABLED is False
        assert link_resolver.SHAREABLE["prequalification"] is False
        assert decide.BUSY_NOW.search("I'm busy, talk later") is None
        stop = opt_out.detect_opt_out("don't text me about this car", "sms")
        assert opt_out.stops_everything(stop, "don't text me about this car")  # inquiry-only off
        plan = resolve_link({"wants_link": True, "wants_link_confidence": 0.95, "link_target": "prequalification",
                             "link_target_confidence": 0.95}, inventory=[], website=None,
                            dealer_links={"prequalification": "https://d.example/pq"})
        assert plan.kind == "unavailable" and not plan.dealer_url
    finally:
        ai_studio.load({})
    assert vehicle_media.PHOTOS_ON_REQUEST == 3 and short_links.ENABLED is True and decide.BUSY_RULE is True
    assert opt_out.INQUIRY_ONLY is True and link_resolver.SHAREABLE["prequalification"] is True
