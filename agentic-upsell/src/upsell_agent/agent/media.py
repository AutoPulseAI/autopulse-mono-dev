"""Vehicle photos: never an unrelated or made-up one (MASTER_PLAN_3 C6,
Omnichannel PDF §15 "Photo unavailable: never fabricate/unrelated photo; use
a non-photo message"; architecture §15 decisions 175-176).

Photo SENDING (MMS / inline email image) is MASTER_PLAN_4 F3. What C6 puts in
place first is the rule it must obey, so F3 can't ship without it:

- `choose_photo` is the only way a photo URL is picked. It returns a URL only
  from the record of the SAME vehicle that was asked for (same VIN, from the
  dealer's own inventory), and only when the URL looks like a real photo:
  https, a host, not a placeholder. Anything else gives `url=None` and a
  reason, and the message goes out as plain text.
- `unattached_photo_claim` is the text-side guard (guardrails/draft_guard.py):
  a draft may not say a photo is attached / below / "here's a pic", and may
  not contain an image link, unless a photo is actually attached to it.
  Compose is told never to talk about the photo (MASTER_PLAN_4 F3): the
  image is attached in code after the guard, and only when it passes the
  image check, so the words must read right with or without it.

F3's sending side (the image check, MMS_ENABLED, attaching it to a send)
is agent/vehicle_media.py.
"""

import re
from collections.abc import Collection
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

# A listing feed's stand-in for "no photo" is not a photo.
_PLACEHOLDER = re.compile(r"placeholder|no[-_ ]?image|no[-_ ]?photo|coming[-_ ]?soon|default[-_ ]?(?:car|image)|"
                          r"stock[-_ ]?photo|sample", re.IGNORECASE)

PHOTO_UNAVAILABLE_NOTE = "no photo of that vehicle is on file"


@dataclass(frozen=True)
class PhotoChoice:
    url: str | None
    reason: str

    @property
    def available(self) -> bool:
        return self.url is not None


def valid_photo_url(url: Any) -> bool:
    if not isinstance(url, str):
        return False
    parsed = urlparse(url.strip())
    return parsed.scheme == "https" and bool(parsed.netloc) and not _PLACEHOLDER.search(url)


def _record_for(requested_vin: str, records: list[Any] | None) -> dict[str, Any] | None:
    rows = [r if isinstance(r, dict) else r.model_dump() | {"photo_urls": r.photo_urls} for r in records or []]
    return next((r for r in rows if str(r.get("vin") or "").upper() == requested_vin.upper()), None)


def photo_candidates(requested_vin: str | None, records: list[Any] | None) -> list[str]:
    """Every usable photo URL of vehicle `requested_vin`, in the listing's own order (MASTER_PLAN_4 F3: the
    appointment countdown shows a different one each day). Same rules as `choose_photo`."""
    record = _record_for(requested_vin, records) if requested_vin else None
    urls = [u.strip() for u in (record or {}).get("photo_urls") or [] if valid_photo_url(u)]
    return list(dict.fromkeys(urls))


def choose_photo(requested_vin: str | None, records: list[Any] | None, *,
                 exclude: Collection[str] = ()) -> PhotoChoice:
    """The photo of vehicle `requested_vin` taken from `records` (the dealer's inventory records, as dicts with
    `vin` and `photo_urls`, or InventoryRecord objects). Never another vehicle's photo, never a made-up URL.
    `exclude` (MASTER_PLAN_4 F3): photos of this vehicle already tried or already sent; the next one is
    chosen, still of the same vehicle."""
    if not requested_vin:
        return PhotoChoice(None, "no vehicle was named, so there is nothing to show")
    if _record_for(requested_vin, records) is None:
        return PhotoChoice(None, f"{requested_vin} is not in this dealer's inventory")
    for url in photo_candidates(requested_vin, records):
        if url not in exclude:
            return PhotoChoice(url, "the vehicle's own photo")
    return PhotoChoice(None, PHOTO_UNAVAILABLE_NOTE)


_CLAIM = re.compile(
    r"\b(?:attached|attaching|i(?:'ve| have) (?:attached|included)|"
    r"(?:photos?|pics?|pictures?|images?)\s+(?:is|are)?\s*(?:below|attached|included)|"
    r"here(?:'s| is| are)\s+(?:a |the |some )?(?:photos?|pics?|pictures?|images?)|"
    r"(?:sending|sent)\s+(?:you\s+)?(?:a |the |some )?(?:photos?|pics?|pictures?|images?))\b", re.IGNORECASE)
_IMAGE_LINK = re.compile(r"https?://\S+?\.(?:jpe?g|png|gif|webp)\b", re.IGNORECASE)


def unattached_photo_claim(text: str, *, media_attached: bool = False) -> list[str]:
    """Why `text` talks about a photo that isn't attached; empty when it is fine."""
    if media_attached:
        return []
    found = []
    if m := _CLAIM.search(text or ""):
        found.append(f"says a photo is attached ({m.group(0)!r}) but none is")
    if _IMAGE_LINK.search(text or ""):
        found.append("contains an image link that isn't a photo we attached")
    return found
