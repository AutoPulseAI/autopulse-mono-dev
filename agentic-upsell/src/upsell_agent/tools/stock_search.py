"""From shopping criteria to the stock a turn loads (MASTER_PLAN_3 Phase 2).

Builds on tools/inventory_tool.py's one-request `search_inventory` (which
keeps its dealer scoping, `year_range`, escaping and 60 s cache):

- **Colour casing (item 5).** /api/car matches `exterior_color` literally and
  case-sensitively. The customer's word is never sent as said: the dealer's
  own colour values are read from the stock that matches everything else,
  the word is matched against them ignoring case ("grey" = "gray"), and the
  stored spelling is what's sent. No stored match means no vehicle in that
  colour, so the step loosens without sending a query that can't match.
- **Trim (item 4.2).** /api/car has no trim parameter, so trim is checked here,
  against each returned record's own `trim` (every word the customer said
  must be in it). "Loosen trim" means stop checking.
- **Loosening (item 4).** No match loosens in a fixed order, each step only
  if that criterion was given, and each step is recorded:
  colour → trim → year ±1 → the same body type from any make (body type unknown: the same make, then
  any vehicle - conversation_7) → new or used
  (the last one decided 28 Sept, our default, flagged for client feedback).
- **"Something bigger" (item 2).** Four size tiers (our default, flagged for
  client feedback). The search moves one tier up from the body type they were
  looking at; while that tier has nothing, it moves up again.
- The budget (`price_max`) filters the search and is never loosened; it is
  never said either (Phase 0 item 3: records carry no price).
"""

import itertools
import re
from dataclasses import dataclass, field
from typing import Any

from upsell_agent import clock
from upsell_agent.tools.inventory_tool import (
    FETCH_LIMIT,
    MAX_LOADED,
    InventoryCriteria,
    InventoryRecord,
    InventorySource,
    search_inventory,
)

# Rows read when colour or trim is checked on our side, so a narrow match
# isn't missed among the newest FETCH_LIMIT.
WIDE_LIMIT = 50

# Phase 2 item 2, decided 27 Sept (our default): smallest to largest.
SIZE_TIERS: list[tuple[str, ...]] = [
    ("Coupe", "Convertible", "Hatchback"),
    ("Sedan", "Wagon"),
    ("SUV",),
    ("Minivan", "Van", "Truck"),
]
_COLOUR_ALIASES = {"grey": "gray"}


def tier_of(body_type: str | None) -> int | None:
    if not body_type:
        return None
    return next((i for i, tier in enumerate(SIZE_TIERS) if body_type.lower() in (b.lower() for b in tier)), None)


def _colour_key(value: str) -> str:
    word = " ".join(value.lower().split())
    return _COLOUR_ALIASES.get(word, word)


def match_colour(wanted: str, stored: list[str | None]) -> str | None:
    """The dealer's own spelling of the colour the customer said, or None."""
    key = _colour_key(wanted)
    return next((s for s in stored if s and _colour_key(s) == key), None)


def trim_matches(wanted: str, trim: str | None) -> bool:
    """Every word of the trim they said is in the record's trim ("XLE" matches "XLE Hybrid")."""
    # "Mach-E", "Mach E" and "MachE" are the same trim.
    have = (trim or "").lower().replace("-", " ").split()
    words = wanted.lower().replace("-", " ").split()
    tokens = {*have, *(a + b for a, b in itertools.pairwise(have))}
    # "540" is "540i", "330" is "330e": a number said without its letter.
    def found(word: str) -> bool:
        return word in tokens or (word[:1].isdigit() and any(t.startswith(word) and t[len(word):].isalpha()
                                                              for t in tokens))
    return bool(have) and (all(found(word) for word in words) or "".join(words) in tokens)


@dataclass
class StockSearch:
    query: dict[str, Any]  # the criteria as first built
    final_query: dict[str, Any]  # after loosening
    params: dict[str, str]  # the last /api/car request
    records: list[InventoryRecord] = field(default_factory=list)
    matched: int = 0
    excluded: list[dict[str, str]] = field(default_factory=list)
    loosened: list[dict[str, str]] = field(default_factory=list)  # {step, detail}, in order
    attempts: list[dict[str, Any]] = field(default_factory=list)  # {step, params, matched, found}
    colour: dict[str, str | None] | None = None  # {asked, stored}
    checked_at: str = ""
    cached: bool = False

    def loaded(self, limit: int = MAX_LOADED) -> list[InventoryRecord]:
        return self.records[:limit]


@dataclass
class _Try:
    records: list[InventoryRecord]
    matched: int
    params: dict[str, str]
    excluded: list[dict[str, str]]
    cached: bool
    stored_colour: str | None = None
    note: str = ""


async def _try(dealer_id: str, c: InventoryCriteria, source: InventorySource) -> _Try:
    """One step's search: the platform filters what it can; colour casing
    and trim are handled here."""
    wide = c.model_copy(update={"exterior_color": None, "trim": None})
    limit = WIDE_LIMIT if (c.exterior_color or c.trim) else FETCH_LIMIT
    base = await search_inventory(dealer_id, wide, source, limit)
    result = base
    stored = None
    if c.exterior_color:
        stored = match_colour(c.exterior_color, [r.exterior_color for r in base.records])
        if stored is None:
            return _Try([], 0, base.params, base.excluded, base.cached,
                        note=f"none of the matching stock is {c.exterior_color}; colour not sent")
        result = await search_inventory(dealer_id, wide.model_copy(update={"exterior_color": stored}), source, limit)
    records, matched = result.records, result.matched
    if c.trim:
        records = [r for r in records if trim_matches(c.trim, r.trim)]
        matched = len(records)
    return _Try(records, matched, result.params, result.excluded, base.cached and result.cached, stored)


async def _body_of(dealer_id: str, c: InventoryCriteria, source: InventorySource) -> str | None:
    """The body type of the vehicle they named, from this dealer's own stock."""
    if c.body_type:
        return c.body_type
    if not (c.make or c.model):
        return None
    probe = await search_inventory(dealer_id, InventoryCriteria(make=c.make, model=c.model), source, 1)
    return next((r.body_type for r in probe.records if r.body_type), None)


async def find_stock(dealer_id: str, criteria: InventoryCriteria, source: InventorySource, *,
                     bigger: bool = False) -> StockSearch:
    """The dealer's stock for `criteria`, loosened in the fixed order until
    something matches (or nothing is left to loosen). Raises if the platform
    can't be reached; the caller carries on without stock."""
    c = criteria.model_copy()
    loosened: list[dict[str, str]] = []
    if bigger:
        body = await _body_of(dealer_id, c, source)
        tier = tier_of(body)
        if tier is None:
            loosened.append({"step": "size", "detail": "asked for something bigger, but the current size isn't "
                                                       "known; searched as asked"})
        elif tier + 1 >= len(SIZE_TIERS):
            loosened.append({"step": "size", "detail": f"{body} is already the largest size; searched as asked"})
        else:
            c = c.model_copy(update={"make": None, "model": None, "trim": None, "body_type": None,
                                     "year_min": None, "year_max": None, "body_types": list(SIZE_TIERS[tier + 1])})
            loosened.append({"step": "size", "detail": f"bigger than {body}: {', '.join(SIZE_TIERS[tier + 1])}"})

    search = StockSearch(query=criteria.model_dump(exclude_none=True), final_query={}, params={},
                         loosened=loosened, checked_at=clock.now().isoformat())
    step: str | None = "exact"
    cached = True
    while step is not None:
        found = await _try(dealer_id, c, source)
        cached = cached and found.cached
        search.attempts.append({"step": step, "params": found.params, "matched": found.matched,
                                "found": len(found.records), **({"note": found.note} if found.note else {})})
        if c.exterior_color and search.colour is None:
            search.colour = {"asked": c.exterior_color, "stored": found.stored_colour}
        search.records, search.matched, search.params = found.records, found.matched, found.params
        search.excluded = found.excluded
        if found.records:
            break
        if step == "exact" and c.model and not c.trim and not c.exterior_color and not found.matched:
            # Client, 12 Oct 2026 (Betsy: "if the trim matches, offer a matched trim, since the customer referred to a
            # Mach-E"): a name that isn't a model in this feed may be a trim - the same vehicle, so still exact.
            as_trim = c.model_copy(update={"model": None, "trim": c.model})
            again = await _try(dealer_id, as_trim, source)
            search.attempts.append({"step": "model_as_trim", "params": again.params, "matched": again.matched,
                                    "found": len(again.records)})
            if again.records:
                c = as_trim
                search.records, search.matched, search.params = again.records, again.matched, again.params
                search.excluded = again.excluded
                break
        step, c = await _loosen(dealer_id, c, source, loosened)
    search.final_query = c.model_dump(exclude_none=True)
    search.cached = cached
    return search


async def _model_in_stock(dealer_id: str, c: InventoryCriteria, source: InventorySource) -> bool:
    """The model, as named, is in this dealer's stock in any colour, trim, year or price."""
    bare = c.model_copy(update={"exterior_color": None, "trim": None, "year_min": None, "year_max": None,
                                "price_max": None, "body_type": None})
    found = await _try(dealer_id, bare, source)
    return bool(found.records or found.matched)


# BMW's numbered models: "3", "540", "330i", "M340i", "228 xDrive" -> the feed's "N Series".
_BMW_NUMBER = re.compile(r"M?(?P<series>[1-8])(?P<rest>\d{2}[a-z]{0,2}(?:\s+(?:x|s)Drive)?)?", re.IGNORECASE)


async def _loosen(dealer_id: str, c: InventoryCriteria, source: InventorySource,
                  loosened: list[dict[str, str]]) -> tuple[str | None, InventoryCriteria]:
    """The next loosening step that applies, recorded; (None, c) when none is left."""
    bmw = _BMW_NUMBER.fullmatch((c.model or "").strip()) if (c.make or "BMW").upper() == "BMW" else None
    if bmw and not any(s["step"] == "model_name" for s in loosened):
        # Krishna, 26 Oct 2026 ("Not the two the 3" about a BMW 3 Series): a bare "3" is the feed's "3 Series".
        # Ehsanul, 26 Oct 2026: "540" is the feed's "5 Series" trim "540i xDrive". The same vehicle, so the match
        # stays exact; the number becomes the trim.
        named = f"{bmw.group('series')} Series"
        trim = " ".join(filter(None, [c.model.strip() if bmw.group("rest") else None, c.trim])) or None
        loosened.append({"step": "model_name", "detail": f"model {c.model!r} is BMW's {named!r}"})
        return "model_name", c.model_copy(update={"make": "BMW", "model": named, "trim": trim})
    if (c.model and len(c.model.split()) > 1 and not any(s["step"] == "model_name" for s in loosened)
            and not await _model_in_stock(dealer_id, c, source)):
        # Client, 12 Oct 2026 (Bibi, a Mustang Mach-E lead): the feed lists it as model "Mustang", trim "Mach-E".
        # Not a loosening - the same vehicle, named the way the feed names it - so the match stays exact.
        # Bibi, 26 Oct 2026 (Alexis, a blue 2022 BMW 3 Series): only when the full name isn't a model in this stock -
        # "3 Series" was split into model "3", which matched nothing, and the search widened to an X3.
        first, rest = c.model.split(None, 1)
        loosened.append({"step": "model_name", "detail": f"no model {c.model!r}; model {first!r} with {rest!r}"})
        return "model_name", c.model_copy(update={"model": first, "trim": " ".join(filter(None, [rest, c.trim]))})
    if c.exterior_color:
        loosened.append({"step": "colour", "detail": f"no match in {c.exterior_color}; any colour"})
        return "colour", c.model_copy(update={"exterior_color": None})
    if c.trim:
        loosened.append({"step": "trim", "detail": f"no {c.trim}; any trim"})
        return "trim", c.model_copy(update={"trim": None})
    if c.model and not any(s["step"] == "model_family" for s in loosened):
        # 26 Oct 2026: "Hyundai Sonata" missed the feed's "Sonata Hybrid" and widened to any Hyundai. A stock model
        # that starts with the name asked for is the same family.
        wide = c.model_copy(update={"model": None, "trim": None, "exterior_color": None, "year_min": None,
                                    "year_max": None, "price_max": None, "body_type": None})
        family = next((r.model for r in (await _try(dealer_id, wide, source)).records
                       if r.model and r.model.lower().startswith(c.model.lower() + " ")), None) if c.make else None
        if family:
            loosened.append({"step": "model_family", "detail": f"model {c.model!r} as the feed's {family!r}"})
            return "model_family", c.model_copy(update={"model": family})
    if (c.year_min or c.year_max) and not any(s["step"] == "year" for s in loosened):
        low, high = (c.year_min or c.year_max), (c.year_max or c.year_min)
        loosened.append({"step": "year", "detail": f"no {low}" + (f"-{high}" if high != low else "")
                                                   + f"; {low - 1}-{high + 1}"})
        return "year", c.model_copy(update={"year_min": low - 1, "year_max": high + 1})
    if c.model and c.body_type and not any(s["step"] == "body" for s in loosened) \
            and await _model_in_stock(dealer_id, c, source):
        # Eric Miller, 26 Oct 2026: "5 Series" with body "Sedan" - the feed says "4D Sedan", so the body filter hid
        # all four 5 Series. A named model already says the body.
        loosened.append({"step": "body", "detail": f"no {c.model} as {c.body_type!r}; the model in any body"})
        return "body", c.model_copy(update={"body_type": None})
    if c.model and (c.year_min or c.year_max) and not any(s["step"] == "any_year" for s in loosened) \
            and await _model_in_stock(dealer_id, c, source):
        # 26 Oct 2026: a 2021 5 Series, none 2020-2022, but 2019 and 2023 ones in stock - the search went to any sedan.
        # The same model in another year is closer than another model.
        loosened.append({"step": "any_year", "detail": f"no {c.model} near the year asked; any year"})
        return "any_year", c.model_copy(update={"year_min": None, "year_max": None})
    if c.body_types:
        tier = tier_of(c.body_types[0])
        if tier is not None and tier + 1 < len(SIZE_TIERS):
            loosened.append({"step": "size", "detail": f"nothing in {', '.join(c.body_types)}; "
                                                       f"up again: {', '.join(SIZE_TIERS[tier + 1])}"})
            return "size", c.model_copy(update={"body_types": list(SIZE_TIERS[tier + 1])})
    elif (c.make or c.model) and not any(s["step"] == "make" for s in loosened):
        named = " ".join(filter(None, [c.make, c.model]))
        body = await _body_of(dealer_id, c, source)
        if body is not None:
            loosened.append({"step": "make", "detail": f"no {named}; any {body}, any make"})
            return "make", c.model_copy(update={"make": None, "model": None, "trim": None, "body_type": body})
        # conversation_7: the body type of a vehicle the dealer doesn't have can't be read from its stock. Before,
        # this step was skipped and the search ended empty ("we don't have any vehicles"); now it widens to the
        # same make, then to the stock in general.
        if c.make and c.model and not any(s["step"] == "model" for s in loosened):
            loosened.append({"step": "model", "detail": f"no {named} (its body type isn't known from this dealer's "
                                                        f"stock); any {c.make}"})
            return "model", c.model_copy(update={"model": None, "trim": None})
        loosened.append({"step": "make", "detail": f"no {named} (body type unknown); other vehicles in stock"})
        return "make", c.model_copy(update={"make": None, "model": None, "trim": None})
    # Last (decided 28 Sept, our default): nothing in their condition, so the other one too.
    if c.condition:
        other = "used" if c.condition == "new" else "new"
        loosened.append({"step": "condition", "detail": f"nothing {c.condition}; {other} too"})
        return "condition", c.model_copy(update={"condition": None})
    return None, c
