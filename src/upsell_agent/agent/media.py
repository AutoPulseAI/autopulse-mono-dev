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
  Today nothing is ever attached, so every such draft is rejected and the
  reply falls back to wording without a photo.
"""

import re
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


def choose_photo(requested_vin: str | None, records: list[Any] | None) -> PhotoChoice:
    """The photo of vehicle `requested_vin` taken from `records` (the dealer's inventory records, as dicts with
    `vin` and `photo_urls`, or InventoryRecord objects). Never another vehicle's photo, never a made-up URL."""
    if not requested_vin:
        return PhotoChoice(None, "no vehicle was named, so there is nothing to show")
    rows = [r if isinstance(r, dict) else r.model_dump() | {"photo_urls": r.photo_urls} for r in records or []]
    record = next((r for r in rows if str(r.get("vin") or "").upper() == requested_vin.upper()), None)
    if record is None:
        return PhotoChoice(None, f"{requested_vin} is not in this dealer's inventory")
    for url in record.get("photo_urls") or []:
        if valid_photo_url(url):
            return PhotoChoice(url.strip(), "the vehicle's own photo")
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
