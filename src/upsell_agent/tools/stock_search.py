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
  colour → trim → year ±1 → the same body type from any make → new or used
  (the last one decided 28 Sept, our default, flagged for client feedback).
- **"Something bigger" (item 2).** Four size tiers (our default, flagged for
  client feedback). The search moves one tier up from the body type they were
  looking at; while that tier has nothing, it moves up again.
- The budget (`price_max`) filters the search and is never loosened; it is
  never said either (Phase 0 item 3: records carry no price).
"""

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
    have = (trim or "").lower().split()
    return bool(have) and all(word in have for word in wanted.lower().split())


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
        step, c = await _loosen(dealer_id, c, source, loosened)
    search.final_query = c.model_dump(exclude_none=True)
    search.cached = cached
    return search


async def _loosen(dealer_id: str, c: InventoryCriteria, source: InventorySource,
                  loosened: list[dict[str, str]]) -> tuple[str | None, InventoryCriteria]:
    """The next loosening step that applies, recorded; (None, c) when none is left."""
    if c.exterior_color:
        loosened.append({"step": "colour", "detail": f"no match in {c.exterior_color}; any colour"})
        return "colour", c.model_copy(update={"exterior_color": None})
    if c.trim:
        loosened.append({"step": "trim", "detail": f"no {c.trim}; any trim"})
        return "trim", c.model_copy(update={"trim": None})
    if (c.year_min or c.year_max) and not any(s["step"] == "year" for s in loosened):
        low, high = (c.year_min or c.year_max), (c.year_max or c.year_min)
        loosened.append({"step": "year", "detail": f"no {low}" + (f"-{high}" if high != low else "")
                                                   + f"; {low - 1}-{high + 1}"})
        return "year", c.model_copy(update={"year_min": low - 1, "year_max": high + 1})
    if c.body_types:
        tier = tier_of(c.body_types[0])
        if tier is not None and tier + 1 < len(SIZE_TIERS):
            loosened.append({"step": "size", "detail": f"nothing in {', '.join(c.body_types)}; "
                                                       f"up again: {', '.join(SIZE_TIERS[tier + 1])}"})
            return "size", c.model_copy(update={"body_types": list(SIZE_TIERS[tier + 1])})
    elif (c.make or c.model) and not any(s["step"] == "make" for s in loosened):
        named = " ".join(filter(None, [c.make, c.model]))
        body = await _body_of(dealer_id, c, source)
        if body is None:
            loosened.append({"step": "make", "detail": f"skipped: the body type of {named} isn't known from this "
                                                       "dealer's stock"})
        else:
            loosened.append({"step": "make", "detail": f"no {named}; any {body}, any make"})
            return "make", c.model_copy(update={"make": None, "model": None, "trim": None, "body_type": body})
    # Last (decided 28 Sept, our default): nothing in their condition, so the other one too.
    if c.condition:
        other = "used" if c.condition == "new" else "new"
        loosened.append({"step": "condition", "detail": f"nothing {c.condition}; {other} too"})
        return "condition", c.model_copy(update={"condition": None})
    return None, c
