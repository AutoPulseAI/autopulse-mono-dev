"""Short links (Betsy, 22 Oct 2026: "When a link has to be sent (the vehicle page, the payment calculator), it is
shortened to a short autopulse link that opens the same page").

Every link in a message the AI sends becomes `<SHORT_LINK_BASE_URL>/l/<code>` just before it goes out, after the
guard has checked the full URL (guardrails/link_guard.py), so what the customer gets opens exactly the page that was
allowed. The code and its URL are kept in `ai_short_links` (one code per lead and URL); the CRM's app/l/[code]
redirects and counts the click. Anything that goes wrong leaves the full link in place - a link is never lost.
"""

import logging
import re
import secrets
import string
from typing import Any

from upsell_agent import clock

logger = logging.getLogger(__name__)

SHORT_LINKS_COLLECTION = "ai_short_links"
# On/Off in AI Studio (Compliance -> Photos & links).
ENABLED = True
CODE_LENGTH = 7
_ALPHABET = string.ascii_letters + string.digits
_URL = re.compile(r"https?://[^\s<>\"')\]]+")


def _code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(CODE_LENGTH))


async def short_url(db: Any, url: str, *, base: str, lead_id: str | None) -> str:
    """The short link for `url` on this lead (the same one each time)."""
    links = db.collection(SHORT_LINKS_COLLECTION)
    if found := await links.find_one({"url": url, "lead_id": lead_id}, projection={"code": 1}):
        return f"{base}/l/{found['code']}"
    for _ in range(5):
        code = _code()
        if not await links.find_one({"code": code}, projection={"_id": 1}):
            await links.insert_one({"code": code, "url": url, "lead_id": lead_id, "created_at": clock.now(),
                                    "clicks": 0})
            return f"{base}/l/{code}"
    return url


async def shorten_links(db: Any, text: str | None, *, base: str | None, lead_id: str | None) -> tuple[str | None, list[str]]:
    """`text` with each link replaced by its short link, and a note per link for the trace."""
    base = (base or "").rstrip("/")
    if not text or not base or not ENABLED:
        return text, []
    notes: list[str] = []
    out = text
    for url in dict.fromkeys(m.group(0).rstrip(".,;:!?") for m in _URL.finditer(text)):
        if url.startswith(f"{base}/l/"):
            continue
        try:
            short = await short_url(db, url, base=base, lead_id=lead_id)
        except Exception:  # noqa: BLE001 - the full link still goes
            logger.exception("could not shorten %s", url)
            continue
        if short != url:
            out = out.replace(url, short)
            notes.append(f"{url} -> {short}")
    return out, notes
