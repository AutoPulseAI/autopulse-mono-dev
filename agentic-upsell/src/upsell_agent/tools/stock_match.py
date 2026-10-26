"""Hybrid stock matching: the dealer's whole stock scored against what the customer asked for.

The user, 26 Oct 2026: the step-by-step search (tools/stock_search.py) matches a model exactly, so a car the customer
names differently from the feed was missed - "540 xDrive" (feed: "5 Series" trim "540i xDrive"), "Sonata" ("Sonata
Hybrid"), "M240" (none in stock; the 228s were shown as the match). Rules added one complaint at a time can't keep up
with a dealer adding cars every day. This module adds a second search beside the first, never instead of it:

- **Index.** Each dealer's stock is read once every INDEX_TTL_S into memory, every car under every word a customer
  might use for it (make, model, model family, each trim word, a trim number without its letter: "540i" -> "540").
  A car the dealer adds is searchable within INDEX_TTL_S. No database read per message.
- **Score.** Only cars sharing a word with the request are scored (thousands of cars take milliseconds): the model
  or its family, the trim words, a close spelling (difflib), the year, colour and budget. STRONG means it is the car
  they named; below it, a near match.
- **Hybrid.** tools/stock_search.py keeps FROM_SEARCH of its cars; this adds FROM_MATCH more that aren't already
  there (AI Studio > Compliance > Safeguards, 3 and 2 to start). Compose picks from those five, says which is
  their car, asks which they mean when a few could be, or says it's checking with a manager when none is.

Off by default (ENABLED) until checked against real leads; then switched on in AI Studio.
"""

import difflib
import logging
import re
import time as monotonic_time
from dataclasses import dataclass, field
from typing import Any

from upsell_agent.integrations.mongodb import PLATFORM_VEHICLES_COLLECTION, dealer_scoped_db
from upsell_agent.tools.inventory_tool import InventoryCriteria, InventoryRecord, to_listing, to_record

logger = logging.getLogger(__name__)

ENABLED = False  # AI Studio > Compliance > Safeguards
FROM_SEARCH = 3  # cars kept from the step-by-step search
FROM_MATCH = 2  # cars added by this matcher
INDEX_TTL_S = 600.0
STRONG = 5.0  # at or above: the car the customer named (model or its family, and the trim number when they gave one)
NEAR = 2.5  # at or above: worth offering as a near match
SPELLING_CUTOFF = 0.84

_cache: dict[str, tuple[float, "Index"]] = {}


def clear_cache() -> None:
    _cache.clear()


def _norm(text: Any) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", str(text or "").lower().replace("-", " ")).strip()


def _words(text: Any) -> set[str]:
    """Each word, the words run together ("cr v" -> "crv"), and a number without its letters ("540i" -> "540")."""
    parts = _norm(text).split()
    out = set(parts) | {a + b for a, b in zip(parts, parts[1:], strict=False)}
    out |= {m.group(1) for p in parts if (m := re.fullmatch(r"m?(\d{2,3})[a-z]{0,2}", p))}
    # "2ss" / "1lt": the letters on their own ("2SS" asked, the feed says "SS").
    out |= {m.group(1) for p in parts if (m := re.fullmatch(r"\d([a-z]{2,3})", p))}
    return {w for w in out if w}


@dataclass
class Entry:
    record: InventoryRecord
    make: str
    model: str
    trim: str
    words: set[str]


@dataclass
class Index:
    entries: list[Entry] = field(default_factory=list)
    by_word: dict[str, set[int]] = field(default_factory=dict)

    @classmethod
    def from_records(cls, records: list[InventoryRecord]) -> "Index":
        index = cls()
        for r in records:
            make, model, trim = _norm(r.make), _norm(r.model), _norm(r.trim)
            words = _words(f"{r.make} {r.model} {r.trim}") | {model.split()[0]} if model else _words(f"{r.make} {r.trim}")
            index.entries.append(Entry(r, make, model, trim, words))
            for w in words:
                index.by_word.setdefault(w, set()).add(len(index.entries) - 1)
        return index


async def dealer_index(dealer_id: str) -> Index:
    """The dealer's stock, indexed (cached INDEX_TTL_S). An unreadable database gives an empty index: the
    step-by-step search still answers."""
    now = monotonic_time.monotonic()
    hit = _cache.get(dealer_id)
    if hit and now - hit[0] < INDEX_TTL_S:
        return hit[1]
    try:
        vehicles = dealer_scoped_db(dealer_id).collection(PLATFORM_VEHICLES_COLLECTION, dealer_field="dealerId")
        docs = await vehicles.find({"removedAt": None}).to_list(None)
        records = []
        for doc in docs:
            if doc.get("vin"):
                try:
                    records.append(to_record(to_listing(doc)))
                except Exception:  # noqa: BLE001 - one odd row never empties the index
                    continue
    except Exception:  # noqa: BLE001
        logger.exception("stock match: could not read the stock of dealer %s", dealer_id)
        return Index()
    index = Index.from_records(records)
    _cache[dealer_id] = (now, index)
    return index


_NOT_TRIM = {"sedan", "coupe", "suv", "hatchback", "wagon", "convertible", "truck", "van", "pickup", "crew", "cab",
             "awd", "fwd", "rwd", "4wd", "2wd", "4x4", "4matic", "quattro", "4dr", "2dr", "auto", "automatic", "door"}


def score(entry: Entry, c: InventoryCriteria, said: set[str]) -> tuple[float, bool]:
    """How close this car is to what was asked: STRONG and up is the car they named; NEAR and up a near match."""
    if c.make and entry.make and _norm(c.make) != entry.make:
        return 0.0, False
    points = 0.0
    model = _norm(c.model)
    model_words = _words(c.model)
    joined = (_norm(c.make) + model).replace(" ", "") if c.make else ""
    if model:
        if model == entry.model or (joined and joined == entry.model.replace(" ", "")):
            points += 4.0  # "mazda 3" = "mazda3" too
        elif entry.model.startswith(model + " ") or model.startswith(entry.model + " "):
            points += 3.5  # the same family: "sonata" / "sonata hybrid", "mustang mach e" / "mustang"
        elif model_words & entry.words:
            points += 3.0  # named by a trim or a number: "540" -> "5 series 540i xdrive"
        elif max(difflib.SequenceMatcher(None, model, entry.model).ratio(),
                 difflib.SequenceMatcher(None, model, entry.model.split()[0] if entry.model else "").ratio()
                 ) >= SPELLING_CUTOFF:
            points += 3.0  # a close spelling of the model
        else:
            return 0.0, False  # another model: never their car, never a near match
        number = next((w for w in model_words if w.isdigit() and len(w) >= 3), None)
        if number:
            # A BMW's (or Mercedes') number is the car: 540 is not 530 (Muhamad Nasir, 26 Oct 2026: M240 isn't 228).
            points += 1.5 if number in entry.words else -2.5
    exact_ok = True  # the real-lead check, 27 Oct 2026: 57 gone cars had another year or trim called "theirs"
    if c.trim:
        wanted = _words(c.trim)
        # Body, drivetrain and engine words in a lead's trim ("Sedan", "4dr", "AWD", "2.5L 4cyl 6A") aren't the trim.
        named = {w for w in wanted if w not in _NOT_TRIM and not re.fullmatch(r"\d+(?:\.\d+)?l|\d+cyl|\d+a|\d+dr", w)}
        share = len(named & entry.words) / max(1, len(named)) if named else 1.0
        points += 1.5 * share + (0.5 if _norm(c.trim) == entry.trim else 0.0)  # the exact trim wins a tie
        exact_ok = share == 1.0
    year = entry.record.year
    if year and (c.year_min or c.year_max):
        low, high = c.year_min or c.year_max, c.year_max or c.year_min
        points += 1.0 if low <= year <= high else 0.4 if low - 1 <= year <= high + 1 else 0.0
        exact_ok = exact_ok and low <= year <= high
    if c.exterior_color and _norm(c.exterior_color) in _norm(entry.record.exterior_color):
        points += 0.5
    if c.price_max and entry.record.price:
        points += 0.5 if entry.record.price <= c.price_max else -1.0
    points += 0.2 * len(said & entry.words)  # the customer's own words, beyond the parsed request
    return points, exact_ok


def best(index: Index, c: InventoryCriteria, text: str | None, *, k: int,
         exclude: set[str] | None = None) -> list[tuple[float, InventoryRecord]]:
    """The k best-scoring cars at NEAR or above that aren't in `exclude`, best first."""
    if k <= 0 or not index.entries:
        return []
    said = _words(text)
    wanted = _words(f"{c.make or ''} {c.model or ''} {c.trim or ''}") | said
    candidates: set[int] = set()
    for w in wanted:
        candidates |= index.by_word.get(w, set())
    if c.model and not candidates:
        candidates = set(range(len(index.entries)))  # a misspelling shares no word: score them all (still fast)
    exclude = exclude or set()
    scored = [(*score(index.entries[i], c, said), index.entries[i].record) for i in candidates
              if index.entries[i].record.vin not in exclude]
    scored = [(p, ok, r) for p, ok, r in scored if p >= NEAR]
    scored.sort(key=lambda x: -x[0])  # ranked by the real score
    # Another year or trim than they named can be offered, never called their car (real-lead check, 27 Oct 2026):
    # its label stays below STRONG, its rank doesn't change.
    return [(p if ok else min(p, STRONG - 0.1), r) for p, ok, r in scored[:k]]


async def candidates(dealer_id: str, c: InventoryCriteria, text: str | None, *, k: int,
                     exclude: set[str] | None = None) -> list[tuple[float, InventoryRecord]]:
    return best(await dealer_index(dealer_id), c, text, k=k, exclude=exclude)


def label(points: float) -> str:
    return "exact" if points >= STRONG else "close"
