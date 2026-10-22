"""Vehicle image, not link (MASTER_PLAN_4 F3; decision 47 built in the client's order).

Client (conversation_6, scope §7 Workflow 3): "we want to send an image not the link unless the customer asks
for it cause we don't want to take the customer off the conversation we need to get them to the appointment
stage."

So, for a message about a specific vehicle:

1. **Image first.** That vehicle's own photo goes with it: MMS on SMS (Twilio `MediaUrl`), an inline image in
   email. Code picks it, never the model: Compose only says which of the vehicles it named the photo is for
   (`sms_media_vin` / `email_media_vin`), and `agent/media.py choose_photo` takes the URL from that vehicle's
   own inventory record.
2. **No link** unless the customer asks for one (Extract's `wants_link`, ≥ 0.8 like every other signal);
   guardrails/link_guard.py rejects any other URL.
3. **No usable photo** (none on the record, not https, unreachable, not an image, over 5 MB): no image, and
   still no link. The message goes out in words, as before.
4. Never a stand-in or another vehicle's photo (Omnichannel PDF §15) - `choose_photo` only ever returns the
   same VIN's own photo.

`MMS_ENABLED` (config.py, on by default per the client's answer; a dealer record's `ai_mms_enabled: false` turns
it off for that dealer): off, SMS carries no image. Email still gets its inline image.

The image check runs the way the provider will fetch the photo: an HTTPS HEAD that must answer 200 with an
image content type and a size within 5 MB (Twilio's MMS limit). With the fake channel driver nothing leaves the
machine, so the check stays offline (the URL's shape only) - unit tests never touch the network.
`use_image_checker` swaps in a test double.
"""

import logging
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx

from upsell_agent.agent.interior_photo import EXTERIOR, INTERIOR, asks_about_interior, photo_showing
from upsell_agent.agent.media import choose_photo, photo_candidates, valid_photo_url
from upsell_agent.config import Settings
from upsell_agent.integrations.mongodb import PLATFORM_USERS_COLLECTION, as_object_id, get_db
from upsell_agent.tools.inventory_tool import InventorySource, get_inventory_source, get_vehicle

logger = logging.getLogger(__name__)

# Twilio's MMS limit is 5 MB for the whole message; one photo per message keeps us inside it.
MAX_IMAGE_BYTES = 5 * 1024 * 1024
HEAD_TIMEOUT_S = 3.0
# A record's photos tried before giving up (one unreachable CDN link shouldn't cost the image).
MAX_PHOTOS_TRIED = 3
# Same bar as the other Extract signals (agent/visit_offer.py SIGNAL_CONFIDENCE).
LINK_CONFIDENCE = 0.8
# Cadence themes whose touch is "about the vehicle" (agent/cadence.py: Day 2 vehicle visual, Day 5 feature).
PHOTO_THEMES = frozenset({"vehicle_visual", "vehicle_value"})


# --- The image check -------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class ImageCheck:
    ok: bool
    reason: str
    size: int = 0  # bytes, when known (several photos in one MMS must stay within MAX_IMAGE_BYTES together)


class ImageChecker(Protocol):
    async def check(self, url: str) -> ImageCheck: ...


class HttpImageChecker:
    """https, HEAD 200, an image content type, at most 5 MB. A size the server doesn't state can't be shown to
    fit Twilio's limit, so it fails too."""

    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None, timeout_s: float = HEAD_TIMEOUT_S):
        self._transport = transport
        self._timeout_s = timeout_s

    async def check(self, url: str) -> ImageCheck:
        if urlparse(url).scheme != "https":
            return ImageCheck(False, "not https")
        try:
            async with httpx.AsyncClient(timeout=self._timeout_s, transport=self._transport,
                                         follow_redirects=True) as client:
                response = await client.head(url)
        except httpx.HTTPError as exc:
            return ImageCheck(False, f"unreachable ({type(exc).__name__})")
        if response.status_code != 200:
            return ImageCheck(False, f"HEAD answered {response.status_code}")
        kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
        if not kind.startswith("image/"):
            return ImageCheck(False, f"not an image ({kind or 'no content type'})")
        size = response.headers.get("content-length")
        if size is None or not size.strip().isdigit():
            return ImageCheck(False, "size not stated (can't show it's within 5 MB)")
        if int(size) > MAX_IMAGE_BYTES:
            return ImageCheck(False, f"too large ({int(size) / 1024 / 1024:.1f} MB, limit 5 MB)")
        return ImageCheck(True, f"{kind}, {int(size) / 1024:.0f} KB", int(size))


class OfflineImageChecker:
    """The fake channel driver sends nothing, so nothing will fetch the photo: only the URL's shape is checked
    (https, a host, not a placeholder - agent/media.py)."""

    async def check(self, url: str) -> ImageCheck:
        if not valid_photo_url(url):
            return ImageCheck(False, "not an https photo URL")
        return ImageCheck(True, "URL shape only: the fake channel driver sends nothing, so it isn't fetched")


_override: ImageChecker | None = None


def use_image_checker(checker: ImageChecker | None) -> None:
    """Tests: replace the checker (None restores the default)."""
    global _override
    _override = checker


def get_image_checker(settings: Settings) -> ImageChecker:
    if _override is not None:
        return _override
    return OfflineImageChecker() if settings.channel_driver == "fake" else HttpImageChecker()


# --- MMS_ENABLED per dealer --------------------------------------------------------------------------------------

async def mms_enabled(dealer_id: str, settings: Settings) -> tuple[bool, str]:
    """MMS_ENABLED, unless the dealer's own record says otherwise (`ai_mms_enabled`)."""
    try:
        dealer = await get_db()[PLATFORM_USERS_COLLECTION].find_one({"_id": as_object_id(dealer_id)},
                                                                   {"ai_mms_enabled": 1})
    except Exception:  # noqa: BLE001 - an unreadable dealer record keeps the service-wide setting
        dealer = None
    flag = (dealer or {}).get("ai_mms_enabled")
    if isinstance(flag, bool):
        return flag, f"MMS {'on' if flag else 'off'} for this dealer (dealer record)"
    return settings.mms_enabled, f"MMS {'on' if settings.mms_enabled else 'off'} (MMS_ENABLED)"


# --- Picking the photo for one message --------------------------------------------------------------------------

@dataclass
class MediaPick:
    vin: str | None
    urls: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


async def pick_vehicle_photo(dealer_id: str, vin: str | None, *, channel: str, settings: Settings,
                             source: InventorySource | None = None, records: list[Any] | None = None,
                             start: int = 0, checker: ImageChecker | None = None) -> MediaPick:
    """The photo to attach to a `channel` message about vehicle `vin`, or none with why. `records`: the
    vehicle's inventory record when the caller has it; otherwise it's read fresh. `start`: which of the
    vehicle's photos to try first (the countdown's day number, so each day shows a different one)."""
    pick = MediaPick(vin=vin)
    if not vin:
        pick.reasons.append("No vehicle in this message: no photo.")
        return pick
    if channel == "sms":
        on, why = await mms_enabled(dealer_id, settings)
        if not on:
            pick.reasons.append(f"{why}: the text goes without a photo, and still without a link.")
            return pick
    if records is None:
        try:
            record = await get_vehicle(dealer_id, vin, source or get_inventory_source(settings))
        except Exception as exc:  # noqa: BLE001 - a photo is never worth a failed send
            pick.reasons.append(f"Couldn't read {vin}'s record ({exc!r}): no photo.")
            return pick
        records = [record] if record else []
    candidates = photo_candidates(vin, records)
    skip = set(candidates[:start % len(candidates)]) if candidates else set()
    tried: list[str] = []
    checker = checker or get_image_checker(settings)
    while len(tried) < MAX_PHOTOS_TRIED:
        choice = choose_photo(vin, records, exclude={*skip, *tried})
        if not choice.available:
            if skip:  # wrap round to the photos before `start`
                skip = set()
                continue
            if not tried:
                pick.reasons.append(f"{vin}: {choice.reason}, so no photo (and no link).")
            break
        tried.append(choice.url)
        result = await checker.check(choice.url)
        if result.ok:
            pick.urls = [choice.url]
            pick.reasons.append(f"{vin}'s own photo attached ({result.reason}).")
            return pick
        pick.reasons.append(f"{vin}'s photo {choice.url} failed the image check: {result.reason}.")
    if tried:
        pick.reasons.append("No photo passed the image check: the message goes in words only, with no link.")
    return pick


# Betsy, 22 Oct 2026: "If a customer asks for photos of a vehicle we can send the images of the vehicle via mms.
# Instead of sending the vehicle link. Then we ask for the appointment."
_ASKS_FOR_PHOTOS = re.compile(r"\b(?:photos?|pictures?|pics?|images?|fotos?)\b", re.IGNORECASE)
# A video or a walk-around is something only staff can make (agent/cannot_supply.py) - not this.
_NOT_PHOTOS = re.compile(r"\b(?:videos?|walk[\s-]?around|facetime|video\s+call)\b", re.IGNORECASE)
# Photos in one picture message: within Twilio's 5 MB for the whole message (each photo is checked).
PHOTOS_ON_REQUEST = 3


def asks_for_photos(text: str | None) -> bool:
    return bool(text and _ASKS_FOR_PHOTOS.search(text) and not _NOT_PHOTOS.search(text))


async def pick_vehicle_photos(dealer_id: str, vin: str, *, channel: str, settings: Settings,
                              source: InventorySource | None = None, count: int = PHOTOS_ON_REQUEST,
                              checker: ImageChecker | None = None) -> MediaPick:
    """Up to `count` of the vehicle's own photos, each passing the image check, together within MAX_IMAGE_BYTES."""
    pick = MediaPick(vin=vin)
    if channel == "sms" and not (on := await mms_enabled(dealer_id, settings))[0]:
        pick.reasons.append(f"{on[1]}: no photos by text.")
        return pick
    try:
        record = await get_vehicle(dealer_id, vin, source or get_inventory_source(settings))
    except Exception as exc:  # noqa: BLE001 - a photo is never worth a failed send
        pick.reasons.append(f"Couldn't read {vin}'s record ({exc!r}): no photos.")
        return pick
    checker = checker or get_image_checker(settings)
    total = 0
    for url in photo_candidates(vin, [record] if record else [])[:count * 2]:
        if len(pick.urls) >= count:
            break
        result = await checker.check(url)
        size = result.size
        if not result.ok or total + size > MAX_IMAGE_BYTES:
            continue
        pick.urls.append(url)
        total += size
    pick.reasons.append(f"The customer asked for photos: {len(pick.urls)} of {vin}'s own photos attached.")
    return pick


async def _labeled_pick(dealer_id: str, vin: str, channel: str, views: frozenset[str], why: str, *,
                        settings: Settings, source: InventorySource | None, db: Any) -> MediaPick | None:
    """That vehicle's own photo showing one of `views`, checked like any other; None to fall back to the usual
    first-listed photo."""
    if channel == "sms" and not (await mms_enabled(dealer_id, settings))[0]:
        return None
    try:
        record = await get_vehicle(dealer_id, vin, source or get_inventory_source(settings))
    except Exception:  # noqa: BLE001 - a photo is never worth a failed send
        return None
    url = await photo_showing(photo_candidates(vin, [record] if record else []), views, settings, db)
    if not url:
        return None
    result = await get_image_checker(settings).check(url)
    if not result.ok:
        return None
    return MediaPick(vin=vin, urls=[url], reasons=[f"{why}: {vin}'s photo ({result.reason})."])


def media_vin(draft: dict[str, Any], channel: str) -> str | None:
    """The vehicle this version's photo is for: Compose's `<channel>_media_vin` when it is one of the vehicles
    that version names, else the first one it names. None when it names no vehicle (no photo)."""
    vins = list((draft.get("sms_vins") if channel == "sms" else draft.get("email_vins")) or [])
    chosen = draft.get("sms_media_vin" if channel == "sms" else "email_media_vin")
    if chosen and chosen in vins:
        return chosen
    return vins[0] if vins else None


def lead_vehicle_vin(lead: dict | None, lead_state: dict | None) -> str | None:
    """The vehicle this lead is about, for messages written in code (appointment steps) or touches about
    "the vehicle they asked about": the VIN on the lead itself (an inquiry about one vehicle), else the
    vehicle we last named to them. None: no photo - never a stand-in."""
    data = (lead or {}).get("data") or {}
    for value in ((lead or {}).get("vin"), data.get("vin"), (data.get("vehicle") or {}).get("vin")
                  if isinstance(data.get("vehicle"), dict) else None):
        if isinstance(value, str) and value.strip():
            return value.strip()
    conversation = (lead_state or {}).get("conversation") or {}
    if conversation.get("focus_vin"):
        return conversation["focus_vin"]  # the shown vehicle the customer referred to (PLAN_4 stream X3)
    shown = conversation.get("shown_vehicles") or []
    return shown[-1].get("vin") if shown and isinstance(shown[-1], dict) else None


_VIN_IN_TEXT = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b", re.IGNORECASE)


def vehicle_record(lead: dict | None, lead_state: dict | None, inventory: list[dict] | None,
                   text: str | None = None) -> dict | None:
    """The inventory record of the vehicle this lead is about, found the same way as its page (below)."""
    return _find_vehicle(lead, lead_state, inventory or [], text)


def vehicle_page_url(lead: dict | None, lead_state: dict | None, inventory: list[dict] | None,
                     text: str | None = None) -> str | None:
    """The vehicle's own page for a link the AI sends (client, 20 Oct 2026, Joel Clymer: "Here is a link" went out
    with none). In order: the lead's / the shown vehicle's VIN, a VIN the customer wrote, the one car in stock
    matching the lead's year, make and model. None: no link (never another vehicle's)."""
    found = _find_vehicle(lead, lead_state, [r for r in inventory or [] if str(r.get("page_url") or "").strip()], text)
    return str(found["page_url"]).strip() if found else None


def _find_vehicle(lead: dict | None, lead_state: dict | None, records: list[dict], text: str | None) -> dict | None:
    by_vin = {str(r.get("vin") or "").upper(): r for r in records}
    for vin in (lead_vehicle_vin(lead, lead_state), *(_VIN_IN_TEXT.findall(text or ""))):
        if vin and (hit := by_vin.get(str(vin).upper())):
            return hit
    data = (lead or {}).get("data") or {}
    vehicle = data.get("vehicle") if isinstance(data.get("vehicle"), dict) else {}
    want = {k: str((lead or {}).get(k) or data.get(k) or vehicle.get(k) or "").strip().lower()
            for k in ("year", "make", "model")}
    if want["make"] and want["model"]:
        same = [r for r in records if str(r.get("make") or "").lower() == want["make"]
                and str(r.get("model") or "").lower() == want["model"]
                and (not want["year"] or str(r.get("year") or "") == want["year"])]
        if len(same) == 1:
            return same[0]
    return None


async def photo_for_draft(dealer_id: str, draft: dict[str, Any], channel: str, *, settings: Settings,
                          source: InventorySource | None = None, theme: str | None = None,
                          lead: dict | None = None, lead_state: dict | None = None,
                          stock_free: bool = False, customer_text: str | None = None, db: Any = None, first_reply: bool = False,
                          inventory: list[dict] | None = None) -> MediaPick:
    """The photo for one version of an AI-written message (first reply, a reply, a cadence touch). The vehicle
    is the one Compose named for that version. A Day 2 / Day 5 touch (PHOTO_THEMES) that names none still
    shows the vehicle the lead is about. `stock_free`: the vehicle sold since drafting and the stock-free
    version goes instead, so no photo either."""
    if stock_free:
        return MediaPick(vin=None, reasons=["The vehicle sold since this was written: no photo."])
    vin = media_vin(draft, channel)
    if not vin and (first_reply or asks_for_photos(customer_text)):
        # Client, 19 Oct 2026 (Betsy: "for the first response email we are sending the vehicle image, can we also do it
        # with the text?"); 22 Oct 2026: "our first outbound message ... should automatically include an image of the
        # vehicle. Not a link", and "if a customer asks for photos ... we send the images via MMS". The car the lead
        # is about: its VIN, else the one car in stock matching the lead's year, make and model.
        vin = lead_vehicle_vin(lead, lead_state) or (vehicle_record(lead, lead_state, inventory, customer_text)
                                                     or {}).get("vin")
    if asks_for_photos(customer_text) and vin and not asks_about_interior(customer_text):
        pick = await pick_vehicle_photos(dealer_id, vin, channel=channel, settings=settings, source=source,
                                         count=PHOTOS_ON_REQUEST)
        if pick.urls:
            return pick
    if asks_about_interior(customer_text) and (vin := vin or lead_vehicle_vin(lead, lead_state)):
        # Client, 12 Oct 2026: asked about the inside, the inside is what they see - from that vehicle's own photos.
        pick = await _labeled_pick(dealer_id, vin, channel, INTERIOR, "The customer asked about the inside",
                                   settings=settings, source=source, db=db)
        if pick is not None:
            return pick
    elif vin and db is not None:
        # Client, 12 Oct 2026 (Betsy, Francisco's lead: "a photo of the vehicle's trunk was provided"): the outside of
        # the car, front or side - not whatever photo the feed happens to list first.
        pick = await _labeled_pick(dealer_id, vin, channel, EXTERIOR, "A front or side view of the vehicle",
                                   settings=settings, source=source, db=db)
        if pick is not None:
            return pick
    if vin is None and theme in PHOTO_THEMES:
        vin = lead_vehicle_vin(lead, lead_state)
        if vin:
            pick = await pick_vehicle_photo(dealer_id, vin, channel=channel, settings=settings, source=source)
            pick.reasons.insert(0, f"A '{theme}' touch: the photo of the vehicle this lead is about ({vin}).")
            return pick
    return await pick_vehicle_photo(dealer_id, vin, channel=channel, settings=settings, source=source)


def wants_link(extraction: dict[str, Any] | None) -> bool:
    """The customer asked for the link this turn ("send me the link", "where can I see it online?")."""
    extraction = extraction or {}
    return bool(extraction.get("wants_link")) and float(extraction.get("wants_link_confidence") or 0.0) >= \
        LINK_CONFIDENCE
