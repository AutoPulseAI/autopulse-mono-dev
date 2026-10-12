"""The right photo of a vehicle: the interior when the customer asks about the inside, otherwise a front or side
view of the outside (client, 12 Oct 2026 - Betsy on Francisco's lead: "a photo of the vehicle's trunk was
provided"), and the interior photo when the customer asks about the inside (client, 12 Oct 2026 - Betsy on Mariah Guillaume:
"when the customer asked about the interior color, the interior image could have been sent").

A dealer's feed lists a vehicle's photos as bare URLs with no label, so which one shows the inside is read from the
picture itself: the model looks at that vehicle's own photos, one at a time, until it finds the interior. Each
answer is kept per photo URL (`ai_photo_labels`), so a photo is only ever looked at once. Only that vehicle's own
photos are considered, never another vehicle's (agent/media.py's rule). No interior photo found, or no model
available: None, and the normal photo goes as before.
"""

import logging
import re
from typing import Any

from upsell_agent import clock
from upsell_agent.config import Settings

logger = logging.getLogger(__name__)

PHOTO_LABELS_COLLECTION = "ai_photo_labels"
# Photos looked at per question: interiors usually follow the outside shots, so this reaches them on a normal
# listing without looking at every photo of a 40-photo one.
MAX_LOOKED_AT = 12
MODEL = "gpt-5-mini"

INTERIOR_ASK = re.compile(
    r"\b(interior|inside|seats?|seating|upholstery|leather|cloth|cabin|dash(board)?|steering wheel|console|"
    r"headliner|third row|3rd row|back ?seat|rear seat|trunk|cargo)\b", re.IGNORECASE)


def asks_about_interior(text: str | None) -> bool:
    return bool(INTERIOR_ASK.search(text or ""))


VIEWS = ("front", "side", "rear", "cargo", "interior", "other")
EXTERIOR = frozenset({"front", "side"})
INTERIOR = frozenset({"interior"})


async def _label(url: str, settings: Settings) -> str | None:
    """Which view one photo shows (VIEWS), from the model; None when it can't be read."""
    # The fake channel driver (tests, local dev) sends nothing, so no photo is ever fetched: no model call either.
    if not settings or not settings.openai_api_key or getattr(settings, "channel_driver", "fake") == "fake":
        return None
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": [
                {"type": "text", "text": "Which view of the car does this photo show? Answer with one word: front "
                                         "(outside, front or front corner), side (outside, side), rear (outside, "
                                         "back), cargo (open trunk or cargo area), interior (seats, dashboard, "
                                         "cabin) or other."},
                {"type": "image_url", "image_url": {"url": url, "detail": "low"}}]}])
    except Exception as exc:  # noqa: BLE001 - a photo is never worth a failed reply
        logger.info("photo label failed for %s: %r", url, exc)
        return None
    answer = (response.choices[0].message.content or "").strip().lower()
    return next((word for word in VIEWS if word in answer), None)


async def photo_showing(urls: list[str], views: frozenset[str], settings: Settings, db: Any) -> str | None:
    """The first of `urls` (one vehicle's own photos, in the listing's order) showing one of `views`."""
    if not urls:
        return None
    labels = db.collection(PHOTO_LABELS_COLLECTION) if db is not None else None
    known: dict[str, str] = {}
    if labels is not None:
        for row in await labels.find({"url": {"$in": urls[:MAX_LOOKED_AT]}}).to_list(None):
            if row.get("view") in VIEWS:
                known[row["url"]] = row["view"]
    for url in urls[:MAX_LOOKED_AT]:
        view = known.get(url)
        if view is None:
            view = await _label(url, settings)
            if view is None:
                return None  # no model (offline, tests) or it failed: don't guess
            if labels is not None:
                await labels.update_one({"url": url}, {"$set": {"url": url, "view": view, "at": clock.now()}},
                                        upsert=True)
        if view in views:
            return url
    return None


async def interior_photo(urls: list[str], settings: Settings, db: Any) -> str | None:
    """The first of `urls` that shows the inside."""
    return await photo_showing(urls, INTERIOR, settings, db)
