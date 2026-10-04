"""MASTER_PLAN_4 F3: the vehicle's image, not the link (client, conversation_6: "we want to send an image not
the link unless the customer asks for it... we need to get them to the appointment stage").

- a message about a specific vehicle carries that vehicle's own photo, and no link;
- each failing image check (not https, unreachable, not 200, not an image, over 5 MB, size unknown) means no
  image - and still no link;
- "send me the link" gets that vehicle's own page_url, nothing else;
- the guard rejects any URL without `wants_link`, and a URL for a vehicle the reply doesn't name;
- Twilio gets `MediaUrl`, SendGrid an inline image, the fake driver records it;
- a retry never sends a second (or a different) picture;
- MMS_ENABLED off (or off for the dealer) means no image on SMS;
- the appointment countdown shows a different photo each day; no-show step 1 shows one too.

No test here touches the network: the HTTP image check runs against httpx.MockTransport, and everything else
uses the fake channel driver's offline check or a scripted checker.
"""

import json
from datetime import UTC, datetime
from urllib.parse import parse_qs

import httpx
import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings
from tests.unit.test_appointment import (  # noqa: F401 - fixture
    _booked_friday,
    _fire,
    _outbox,
    live_dealer,
)
from tests.unit.test_inventory_tool import DEALER, _stock, _vehicle
from tests.unit.test_live_drivers import DEALER_SMS, Provider, _sendgrid, _twilio, _twilio_ok
from tests.unit.test_live_drivers import dealer as live_driver_dealer  # noqa: F401 - fixture
from upsell_agent.agent import vehicle_media
from upsell_agent.agent.media import choose_photo, photo_candidates
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.agent.vehicle_media import (
    MAX_IMAGE_BYTES,
    HttpImageChecker,
    ImageCheck,
    lead_vehicle_vin,
    media_vin,
    pick_vehicle_photo,
    use_image_checker,
    wants_link,
)
from upsell_agent.channels.base import OutboundMessage
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender, SendRequest
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.guardrails.link_guard import disallowed_links
from upsell_agent.integrations.mongodb import (
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    as_object_id,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink

VIN = "VIN00000000000901"
PHOTOS = [f"https://img.example/{VIN}/{i}.jpg" for i in (1, 2, 3)]
PAGE = f"https://dealer.example/v/{VIN}"


def _rav4(vin=VIN, photos=None, **kw):
    return _vehicle(vin, make="Toyota", model="RAV4", trim="LE", color="White",
                    imagesSecure=photos if photos is not None else [f"https://img.example/{vin}.jpg"], **kw)


RECORD = {"vin": VIN, "photo_urls": PHOTOS, "page_url": PAGE}


class Scripted:
    """An image checker that answers from a table (default: every photo passes)."""

    def __init__(self, failing: dict[str, str] | None = None):
        self.failing = failing or {}
        self.checked: list[str] = []

    async def check(self, url: str) -> ImageCheck:
        self.checked.append(url)
        if url in self.failing:
            return ImageCheck(False, self.failing[url])
        return ImageCheck(True, "image/jpeg, 200 KB")


@pytest.fixture(autouse=True)
def default_checker():
    use_image_checker(None)
    yield
    use_image_checker(None)


# --- The image check (HTTP, mocked) ---------------------------------------------------------------------------

def _head(response: httpx.Response | Exception) -> HttpImageChecker:
    def handle(request: httpx.Request) -> httpx.Response:
        assert request.method == "HEAD"
        if isinstance(response, Exception):
            raise response
        return response
    return HttpImageChecker(transport=httpx.MockTransport(handle))


async def test_a_reachable_small_image_passes_the_check():
    checker = _head(httpx.Response(200, headers={"content-type": "image/jpeg", "content-length": "204800"}))
    assert (await checker.check(PHOTOS[0])).ok


@pytest.mark.parametrize("response,why", [
    (httpx.Response(404), "HEAD answered 404"),
    (httpx.Response(200, headers={"content-type": "text/html", "content-length": "100"}), "not an image"),
    (httpx.Response(200, headers={"content-type": "image/png", "content-length": str(MAX_IMAGE_BYTES + 1)}),
     "too large"),
    (httpx.Response(200, headers={"content-type": "image/png"}), "size not stated"),
    (httpx.ConnectError("no route"), "unreachable"),
])
async def test_each_failing_check_rejects_the_image(response, why):
    result = await _head(response).check(PHOTOS[0])
    assert not result.ok and why in result.reason


async def test_a_plain_http_photo_is_never_fetched():
    result = await _head(AssertionError("must not be fetched")).check("http://img.example/1.jpg")
    assert not result.ok and result.reason == "not https"


def test_the_fake_driver_never_uses_the_network_checker():
    assert isinstance(vehicle_media.get_image_checker(make_settings("DEV")), vehicle_media.OfflineImageChecker)


# --- Picking the photo ----------------------------------------------------------------------------------------

async def test_the_named_vehicles_own_photo_is_picked(mongo):
    pick = await pick_vehicle_photo(DEALER, VIN, channel="sms", settings=make_settings("DEV"), records=[RECORD],
                                    checker=Scripted())
    assert pick.urls == [PHOTOS[0]]


async def test_a_photo_failing_the_check_falls_to_the_same_vehicles_next_one(mongo):
    checker = Scripted({PHOTOS[0]: "HEAD answered 404"})
    pick = await pick_vehicle_photo(DEALER, VIN, channel="sms", settings=make_settings("DEV"), records=[RECORD],
                                    checker=checker)
    assert pick.urls == [PHOTOS[1]] and checker.checked == PHOTOS[:2]


async def test_no_photo_passing_means_no_image(mongo):
    checker = Scripted({u: "not an image" for u in PHOTOS})
    pick = await pick_vehicle_photo(DEALER, VIN, channel="email", settings=make_settings("DEV"), records=[RECORD],
                                    checker=checker)
    assert pick.urls == [] and "words only, with no link" in pick.reasons[-1]


async def test_never_another_vehicles_photo(mongo):
    other = {"vin": "OTHERVIN", "photo_urls": ["https://img.example/other.jpg"]}
    pick = await pick_vehicle_photo(DEALER, VIN, channel="sms", settings=make_settings("DEV"), records=[other],
                                    checker=Scripted())
    assert pick.urls == [] and "not in this dealer's inventory" in pick.reasons[0]


async def test_a_vehicle_with_no_photo_gets_none(mongo):
    pick = await pick_vehicle_photo(DEALER, VIN, channel="sms", settings=make_settings("DEV"),
                                    records=[{"vin": VIN, "photo_urls": []}], checker=Scripted())
    assert pick.urls == []


async def test_the_record_is_read_fresh_from_the_dealers_stock(mongo):
    await _stock(mongo, _rav4(photos=PHOTOS))
    pick = await pick_vehicle_photo(DEALER, VIN, channel="sms", settings=make_settings("DEV"))
    assert pick.urls == [PHOTOS[0]]


async def test_mms_off_means_no_image_on_sms_but_email_keeps_it(mongo):
    settings = make_settings("DEV").model_copy(update={"mms_enabled": False})
    sms = await pick_vehicle_photo(DEALER, VIN, channel="sms", settings=settings, records=[RECORD], checker=Scripted())
    email = await pick_vehicle_photo(DEALER, VIN, channel="email", settings=settings, records=[RECORD],
                                     checker=Scripted())
    assert sms.urls == [] and "MMS off" in sms.reasons[0]
    assert email.urls == [PHOTOS[0]]


async def test_mms_can_be_turned_off_for_one_dealer(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one({"_id": ObjectId(DEALER), "ai_mms_enabled": False})
    pick = await pick_vehicle_photo(DEALER, VIN, channel="sms", settings=make_settings("DEV"), records=[RECORD],
                                    checker=Scripted())
    assert pick.urls == [] and "dealer record" in pick.reasons[0]


async def test_a_later_start_picks_a_different_photo_and_wraps_round(mongo):
    picks = [(await pick_vehicle_photo(DEALER, VIN, channel="sms", settings=make_settings("DEV"), records=[RECORD],
                                       start=day, checker=Scripted())).urls[0] for day in (3, 2, 1)]
    assert picks == [PHOTOS[0], PHOTOS[2], PHOTOS[1]] and len(set(picks)) == 3


def test_choose_photo_skips_excluded_photos_but_stays_on_the_same_vehicle():
    assert choose_photo(VIN, [RECORD], exclude={PHOTOS[0]}).url == PHOTOS[1]
    assert not choose_photo(VIN, [RECORD], exclude=set(PHOTOS)).available
    assert photo_candidates(VIN, [RECORD]) == PHOTOS


def test_the_photo_is_for_a_vehicle_the_version_names():
    draft = {"sms_vins": ["A", "B"], "sms_media_vin": "B", "email_vins": ["A"], "email_media_vin": "Z"}
    assert media_vin(draft, "sms") == "B"
    assert media_vin(draft, "email") == "A"  # Z isn't named in the email: the first one named instead
    assert media_vin({"sms_vins": []}, "sms") is None


def test_the_leads_own_vehicle_then_the_last_one_shown():
    assert lead_vehicle_vin({"data": {"vehicle": {"vin": "LEADVIN"}}}, None) == "LEADVIN"
    state = {"conversation": {"shown_vehicles": [{"vin": "OLD"}, {"vin": "NEW"}]}}
    assert lead_vehicle_vin({}, state) == "NEW"
    assert lead_vehicle_vin({}, {}) is None


def test_wants_link_needs_the_same_confidence_as_every_other_signal():
    assert wants_link({"wants_link": True, "wants_link_confidence": 0.8})
    assert not wants_link({"wants_link": True, "wants_link_confidence": 0.79})
    assert not wants_link(None)


# --- The link guard -------------------------------------------------------------------------------------------

INVENTORY = [{"vin": VIN, "page_url": PAGE}, {"vin": "VIN2", "page_url": "https://dealer.example/v/VIN2"}]


def _draft(sms, vins=(VIN,)):
    return {"sms_text": sms, "email_subject": "Your RAV4", "email_body": "Hi,\n\nThe RAV4 is here.",
            "sms_vins": list(vins), "email_vins": list(vins)}


def test_any_url_without_a_link_request_is_rejected():
    found = disallowed_links(_draft(f"We have the RAV4: {PAGE}"), inventory=INVENTORY, link_requested=False)
    assert found and "didn't ask for one" in found[0]


def test_the_named_vehicles_page_passes_when_asked():
    assert disallowed_links(_draft(f"Here's the link: {PAGE}."), inventory=INVENTORY, link_requested=True) == []


def test_a_link_to_a_vehicle_the_reply_doesnt_name_is_rejected():
    found = disallowed_links(_draft("Here: https://dealer.example/v/VIN2"), inventory=INVENTORY, link_requested=True)
    assert found and "isn't the page of a vehicle it names" in found[0]


def test_a_made_up_link_is_rejected_even_when_asked():
    found = disallowed_links(_draft("See www.cheap-cars.example/rav4"), inventory=INVENTORY, link_requested=True)
    assert found


def test_the_dealers_own_website_is_still_an_answer():
    draft = _draft("Our website is https://sunrise.test", vins=())
    assert disallowed_links(draft, inventory=INVENTORY, link_requested=False, allowed=["https://sunrise.test"]) == []


# --- Drivers --------------------------------------------------------------------------------------------------

async def _send_with_photo(driver, channel):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel=channel, name="Maria Test", comments="hi")
    sender = Sender(driver, StubPlatformClient(), retry_base_s=0)
    return await sender.send(SendRequest(
        dealer_id=DEALER, lead_id=created["lead_id"], customer_id=created["customer_id"], turn_id="t-photo",
        channel=channel, text="Hi Maria,\n\nThe RAV4 is ready to see.", subject="Your RAV4",
        media_urls=[PHOTOS[0]]))


async def test_twilio_sends_the_photo_as_media_url(live_driver_dealer):  # noqa: F811
    provider = Provider(_twilio_ok("SM7"))
    outcome = await _send_with_photo(_twilio(provider), "sms")
    assert outcome.status == "sent" and outcome.media_urls == [PHOTOS[0]]
    form = parse_qs(provider.requests[0].content.decode())
    assert form["MediaUrl"] == [PHOTOS[0]] and form["From"] == [DEALER_SMS]


async def test_twilio_sends_no_media_url_without_a_photo(live_driver_dealer):  # noqa: F811
    provider = Provider(_twilio_ok())
    await _twilio(provider).send(OutboundMessage(dealer_id=DEALER, lead_id="l", customer_id="c", channel="sms",
                                                 to="+15551112222", text="Hi"))
    assert "MediaUrl" not in parse_qs(provider.requests[0].content.decode())


async def test_sendgrid_shows_the_photo_inline(live_driver_dealer):  # noqa: F811
    provider = Provider(httpx.Response(202, headers={"X-Message-Id": "sg-1"}))
    outcome = await _send_with_photo(_sendgrid(provider), "email")
    assert outcome.status == "sent"
    html = json.loads(provider.requests[0].content)["content"][1]["value"]
    assert f'<img src="{PHOTOS[0]}"' in html and html.index("Hi Maria") < html.index("<img")


async def test_the_fake_driver_records_the_photo(mongo):
    await _send_with_photo(FakeChannelDriver(), "sms")
    [row] = await mongo[DEV_OUTBOX_COLLECTION].find({}).to_list(None)
    assert row["media_urls"] == [PHOTOS[0]]


async def test_a_retry_never_sends_a_second_picture(mongo):
    driver = FakeChannelDriver()
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Maria Test", comments="hi")
    sender = Sender(driver, StubPlatformClient(), retry_base_s=0)
    request = SendRequest(dealer_id=DEALER, lead_id=created["lead_id"], customer_id=created["customer_id"],
                          turn_id="t-retry", channel="sms", text="The RAV4 is ready.", media_urls=[PHOTOS[0]])
    first = await sender.send(request)
    again = await sender.send(SendRequest(**{**request.__dict__, "media_urls": [PHOTOS[1]]}))
    assert first.status == "sent" and again.status == "duplicate" and driver.calls == 1
    assert await mongo[DEV_OUTBOX_COLLECTION].count_documents({}) == 1


async def test_a_resumed_send_uses_the_claimed_rows_own_photo(mongo):
    driver = FakeChannelDriver(fail_first=1)
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Maria Test", comments="hi")
    sender = Sender(driver, StubPlatformClient(), retry_base_s=0, max_attempts=1)
    request = SendRequest(dealer_id=DEALER, lead_id=created["lead_id"], customer_id=created["customer_id"],
                          turn_id="t-resume", channel="sms", text="The RAV4 is ready.", media_urls=[PHOTOS[0]])
    assert (await sender.send(request)).status == "failed"
    # A failed row isn't resumable, so make it so (as a held row would be) and re-run with another photo.
    await mongo[AI_MESSAGES_COLLECTION].update_one({"idempotency_key": request.idempotency_key},
                                                   {"$set": {"status": "held"}})
    resumed = await sender.send(SendRequest(**{**request.__dict__, "media_urls": [PHOTOS[2]]}))
    assert resumed.status == "sent"
    [row] = await mongo[DEV_OUTBOX_COLLECTION].find({}).to_list(None)
    assert row["media_urls"] == [PHOTOS[0]]


# --- Through real turns ---------------------------------------------------------------------------------------

def _deps(**settings) -> TurnDeps:
    return TurnDeps(settings=make_settings("DEV").model_copy(update=settings), sink=MemoryTraceSink(),
                    store_prompts=True, sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(deps):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Pat Picture",
                                         comments="Hi, I saw your ad")
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), deps)
    return created


async def _say(created, text, deps):
    message_id = str(ObjectId())
    await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=message_id, dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel="sms", message_id=message_id, text=text, received_at=datetime.now(UTC)), deps)


async def _last_sms(mongo, created):
    rows = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"], "channel": "sms"}).to_list(None)
    return max(rows, key=lambda r: r["created_at"])


async def test_a_reply_about_a_vehicle_sends_its_photo_and_no_link(mongo):
    await _stock(mongo, _rav4())
    deps = _deps()
    created = await _lead(deps)
    await _say(created, "Do you have a Toyota RAV4?", deps)
    sms = await _last_sms(mongo, created)
    assert "RAV4" in sms["text"] and "http" not in sms["text"] and "www." not in sms["text"]
    assert sms["media_urls"] == [f"https://img.example/{VIN}.jpg"]
    turn = (await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]})
            .sort("created_at", -1).to_list(1))[0]
    send = next(n for n in turn["nodes"] if n["node"] == "send")
    assert send["output"]["media_urls"] == sms["media_urls"]
    assert any("own photo attached" in r for r in send["reasoning"])


async def test_send_me_the_link_gets_that_vehicles_page_only(mongo):
    await _stock(mongo, _rav4())
    deps = _deps()
    created = await _lead(deps)
    await _say(created, "Do you have a Toyota RAV4? Can you send me the link?", deps)
    sms = await _last_sms(mongo, created)
    assert PAGE in sms["text"] and sms["media_urls"]  # the photo still goes with it
    turn = (await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]})
            .sort("created_at", -1).to_list(1))[0]
    guard = [n for n in turn["nodes"] if n["node"] == "guard"][-1]
    assert guard["output"]["checks"]["no_link_unless_asked"]


async def test_a_failing_image_check_means_no_image_and_still_no_link(mongo):
    await _stock(mongo, _rav4())
    use_image_checker(Scripted({f"https://img.example/{VIN}.jpg": "HEAD answered 404"}))
    deps = _deps()
    created = await _lead(deps)
    await _say(created, "Do you have a Toyota RAV4?", deps)
    sms = await _last_sms(mongo, created)
    assert "RAV4" in sms["text"] and sms["media_urls"] == [] and "http" not in sms["text"]


async def test_mms_off_means_no_image_through_a_real_turn(mongo):
    await _stock(mongo, _rav4())
    deps = _deps(mms_enabled=False)
    created = await _lead(deps)
    await _say(created, "Do you have a Toyota RAV4?", deps)
    sms = await _last_sms(mongo, created)
    assert "RAV4" in sms["text"] and sms["media_urls"] == [] and "http" not in sms["text"]


async def test_the_debug_conversation_view_shows_the_photo(mongo):
    from upsell_agent.api.dev import conversation

    await _stock(mongo, _rav4())
    deps = _deps()
    created = await _lead(deps)
    await _say(created, "Do you have a Toyota RAV4?", deps)
    items = await conversation(created["lead_id"], DEALER)
    sent = [i for i in items if i.get("kind") == "message" and i["direction"] == "outbound"]
    assert sent[-1]["media_urls"] == [f"https://img.example/{VIN}.jpg"]


# --- Appointment countdown and no-show step 1 -------------------------------------------------------------------

flow = pytest.mark.usefixtures("during_opening_hours", "ny_customer", "live_dealer")


async def _lead_about(mongo, created, vin=VIN):
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": as_object_id(created["lead_id"])},
                                                     {"$set": {"data.vin": vin}})


@flow
async def test_each_countdown_day_shows_a_different_photo_of_the_vehicle(mongo):
    created, _ = await _booked_friday(mongo)
    await _stock(mongo, _rav4(photos=PHOTOS))
    await _lead_about(mongo, created)
    await _fire(mongo, created, "details")  # stream R: the 15-minute details message (no photo) goes first
    before = len(await _outbox(mongo, created))
    await _fire(mongo, created, "countdown")
    await _fire(mongo, created, "countdown")
    sms = [m for m in (await _outbox(mongo, created))[before:] if m["channel"] == "sms"]
    assert [m["text"] for m in sms] == ["Counting down to our meeting at Sunrise Motors!"] * 2
    photos = [m["media_urls"] for m in sms]
    assert all(len(p) == 1 and p[0] in PHOTOS for p in photos) and photos[0] != photos[1]
    email = [m for m in (await _outbox(mongo, created))[before:] if m["channel"] == "email"]
    assert all(m["media_urls"] for m in email)


@flow
async def test_the_no_show_message_shows_the_vehicle(mongo):
    created, _ = await _booked_friday(mongo)
    await _stock(mongo, _rav4(photos=PHOTOS))
    await _lead_about(mongo, created)
    await _fire(mongo, created, "no_show_check")
    sms = [m for m in await _outbox(mongo, created) if m["channel"] == "sms"][-1]
    assert "looking for you in the showroom" in sms["text"] and sms["media_urls"] == [PHOTOS[0]]


@flow
async def test_an_appointment_with_no_vehicle_on_record_stays_text_only(mongo):
    created, _ = await _booked_friday(mongo)
    before = len(await _outbox(mongo, created))
    await _fire(mongo, created, "countdown")
    assert all(m["media_urls"] == [] for m in (await _outbox(mongo, created))[before:])


@flow
async def test_a_vehicle_gone_from_stock_means_no_photo_never_a_stand_in(mongo):
    created, _ = await _booked_friday(mongo)
    await _stock(mongo, _rav4("VIN00000000000999"))  # another vehicle is in stock, theirs isn't
    await _lead_about(mongo, created)
    before = len(await _outbox(mongo, created))
    await _fire(mongo, created, "countdown")
    assert all(m["media_urls"] == [] for m in (await _outbox(mongo, created))[before:])

