"""The dealer's stock, read-only (MASTER_PLAN_3 Part A, Phase 1).

Source of truth: the platform's existing `GET /api/car` (architecture §15,
Phase 0 item 2, Option A). It isn't changed by this service; its known
defects are worked around here:

- **Dealer scoping.** The route only filters by dealer when `dealer_id` is
  passed, so it always is, and any row whose `dealer.id` isn't this dealer is
  dropped anyway.
- **Year.** The route's `year` parameter never matches (a regex against a
  number), so an exact year is sent as `year_range=Y-Y`. `year` is never sent.
- **Regex input.** `make` / `model` / `car_type` / `body_type` become
  `^value$` regexes on the platform, split on commas. Values are sent with
  regex characters escaped and commas removed, so customer wording can't
  break or widen the query.
- **No in-stock filter.** None exists yet: every returned record counts as in
  stock (Phase 0 item 1, interim decision 27 Sept). A sold car can still be
  loaded until the platform records a sale (Part C's C5 manager outcome).

Everything comes from /api/car's response alone; nothing else is read. There
is no age limit on records (Phase 0 item 6, removed 27 Sept).

Prices are never loaded (Phase 0 item 3): the typed view has no price field.

`PLATFORM_CLIENT=stub` reads the local database with a port of the route's
query and response (the same switch as Customer 360), so dev runs without the
Next.js app; `python -m upsell_agent.devtools.compare_inventory` checks the
two agree for the dev dealers.

Results are cached for CACHE_TTL_S per dealer and query, so a burst of
campaign replies doesn't run the same search hundreds of times.
`get_vehicle` (re-checks before a send, Phase 5) is never cached.
"""

import re
import time as monotonic_time
from dataclasses import dataclass, field, replace
from typing import Any, Protocol

import httpx
from pydantic import BaseModel

from upsell_agent import clock
from upsell_agent.config import Settings
from upsell_agent.integrations.mongodb import PLATFORM_VEHICLES_COLLECTION, dealer_scoped_db

CACHE_TTL_S = 60.0
# Rows asked of /api/car per search. `matched` still reports the full count.
FETCH_LIMIT = 20
# Records given to the AI per turn (architecture decision 16: SMS names at
# most 2 of at most 3 loaded; email names at most 3).
MAX_LOADED = 3
# Kept short: Load context waits on it, and a slow platform must mean a
# turn without stock, not a late reply.
REQUEST_TIMEOUT_S = 2.0

# Makes customers name, as the feed spells them. Used to split "2021 Honda
# CR-V" into make and model; anything else is searched as a model.
KNOWN_MAKES = {
    "acura": "Acura", "audi": "Audi", "bmw": "BMW", "buick": "Buick", "cadillac": "Cadillac",
    "chevrolet": "Chevrolet", "chevy": "Chevrolet", "chrysler": "Chrysler", "dodge": "Dodge", "ford": "Ford",
    "genesis": "Genesis", "gmc": "GMC", "honda": "Honda", "hyundai": "Hyundai", "infiniti": "Infiniti",
    "jeep": "Jeep", "kia": "Kia", "lexus": "Lexus", "lincoln": "Lincoln", "mazda": "Mazda",
    "mercedes": "Mercedes-Benz", "mercedes-benz": "Mercedes-Benz", "mitsubishi": "Mitsubishi",
    "nissan": "Nissan", "ram": "Ram", "subaru": "Subaru", "tesla": "Tesla", "toyota": "Toyota",
    "volkswagen": "Volkswagen", "vw": "Volkswagen", "volvo": "Volvo",
}
# Body types said in place of a model ("a used SUV").
BODY_WORDS = {"suv": "SUV", "truck": "Truck", "pickup": "Truck", "sedan": "Sedan", "coupe": "Coupe",
              "minivan": "Minivan", "van": "Van", "hatchback": "Hatchback", "wagon": "Wagon",
              "convertible": "Convertible"}
# Trim names said after a model ("RAV4 XLE"). Only used to split them off;
# the record's own trim is what's checked (Phase 2 item 4).
TRIM_WORDS = {"le", "xle", "se", "xse", "limited", "platinum", "sport", "touring", "ex", "ex-l", "lx", "sr5", "trd",
              "adventure", "hybrid", "premium", "lariat", "xlt", "lt", "ltz", "sv", "sl", "sel", "range", "standard"}
_YEAR = re.compile(r"^(19[89]\d|20[0-4]\d)$")
_REGEX_CHARS = re.compile(r"[.*+?^${}()|\[\]\\]")


class InventoryCriteria(BaseModel):
    """What to search for. Every field optional.

    Phase 2 adds `body_types` (several at once, for a size tier), `exterior_color`,
    `price_max` (the budget: used to filter, never said) and `trim`. `trim` is
    never sent: /api/car has no trim parameter, so it's checked on our side
    against each record's own trim (tools/stock_search.py)."""

    make: str | None = None
    model: str | None = None
    condition: str | None = None  # "new" / "used"
    body_type: str | None = None
    body_types: list[str] | None = None  # a size tier: any of these ("something bigger")
    year_min: int | None = None
    year_max: int | None = None
    exterior_color: str | None = None  # sent as the dealer's own stored spelling
    price_max: int | None = None
    trim: str | None = None  # client-side only

    def is_empty(self) -> bool:
        return not (self.make or self.model or self.body_type or self.body_types)

    def to_params(self, dealer_id: str) -> dict[str, str]:
        """The /api/car query string. Always dealer-scoped; years only as `year_range`."""
        params = {"dealer_id": dealer_id}
        for key, value in (("make", self.make), ("model", self.model), ("car_type", self.condition),
                           ("body_type", self.body_type)):
            if value and (safe := safe_param(value)):
                params[key] = safe
        if self.body_types:
            # The route splits body_type on commas into `^value$` regexes: several at once.
            params["body_type"] = ",".join(s for b in self.body_types if (s := safe_param(b)))
        if self.year_min or self.year_max:
            params["year_range"] = f"{self.year_min or self.year_max}-{self.year_max or self.year_min}"
        if self.exterior_color and (colour := " ".join(self.exterior_color.replace(",", " ").split())):
            # A literal, case-sensitive match on the platform (not a regex): no escaping, commas removed.
            params["exterior_color"] = colour
        if self.price_max:
            params["price_range"] = f"0-{int(self.price_max)}"
        return params


def safe_param(value: str) -> str:
    """A value the platform turns into `^value$`: regex characters escaped,
    commas (its list separator) removed."""
    return _REGEX_CHARS.sub(lambda m: "\\" + m.group(0), " ".join(value.replace(",", " ").split()))


def split_trim(model: str) -> tuple[str, str | None]:
    """"RAV4 XLE Hybrid" -> ("RAV4", "XLE Hybrid"): trailing words that are
    known trim names. "Grand Cherokee" and "Model Y" stay whole."""
    words = model.split()
    cut = len(words)
    while cut > 1 and words[cut - 1].lower() in TRIM_WORDS:
        cut -= 1
    if cut > 1 and words[cut - 1].lower() == "long" and cut < len(words) and words[cut].lower() == "range":
        cut -= 1
    return " ".join(words[:cut]), (" ".join(words[cut:]) or None)


def criteria_from_profile(profile: dict[str, Any]) -> InventoryCriteria:
    """What this turn's (validated) profile says they want (MASTER_PLAN_3
    Phase 2 item 2): the vehicle ("2021 Toyota RAV4 XLE"), new or used, body
    type, colour and budget. Only filled (or stale) values count: a value
    still waiting to be confirmed doesn't narrow the search."""
    slots = {s["path"]: s for s in profile.get("slots", []) if s.get("state") in ("filled", "stale")}
    criteria = InventoryCriteria()
    wanted = (slots.get("interest.model") or {}).get("value")
    if isinstance(wanted, str) and wanted.strip():
        words = wanted.split()
        if words and _YEAR.match(words[0]):
            criteria.year_min = criteria.year_max = int(words.pop(0))
        if words and words[0].lower() in KNOWN_MAKES:
            criteria.make = KNOWN_MAKES[words.pop(0).lower()]
        rest = " ".join(words)
        if rest.lower() in BODY_WORDS:
            criteria.body_type = BODY_WORDS[rest.lower()]
        elif rest:
            criteria.model, criteria.trim = split_trim(rest)
    condition = (slots.get("interest.new_or_used") or {}).get("value")
    if condition in ("new", "used"):
        criteria.condition = condition
    body = (slots.get("interest.body_type") or {}).get("value")
    if isinstance(body, str) and body.lower() in BODY_WORDS and not criteria.body_type:
        criteria.body_type = BODY_WORDS[body.lower()]
    colour = (slots.get("interest.color") or {}).get("value")
    if isinstance(colour, str) and colour.strip():
        criteria.exterior_color = colour.strip()
    budget = (slots.get("interest.budget") or {}).get("value")
    if isinstance(budget, (int, float)) and not isinstance(budget, bool) and budget > 0:
        criteria.price_max = int(budget)
    return criteria


class InventoryRecord(BaseModel):
    """One vehicle as the AI may know it (Phase 1 item 2). `source_id` is the
    VIN: every vehicle a reply mentions must trace back to one of these."""

    source_id: str
    vin: str
    year: int | None = None
    make: str | None = None
    model: str | None = None
    trim: str | None = None
    body_type: str | None = None
    condition: str | None = None
    exterior_color: str | None = None
    miles: int | None = None
    page_url: str | None = None


@dataclass
class SearchResult:
    query: dict[str, Any]
    params: dict[str, str]
    matched: int = 0  # what /api/car counted for the query
    fetched: int = 0
    records: list[InventoryRecord] = field(default_factory=list)  # newest first
    excluded: list[dict[str, str]] = field(default_factory=list)  # {vin, reason}
    checked_at: str = ""
    cached: bool = False

    def loaded(self, limit: int = MAX_LOADED) -> list[InventoryRecord]:
        """The records given to the AI this turn."""
        return self.records[:limit]


# --- Sources: the real route, or a port of it over the local database ---------

class InventorySource(Protocol):
    async def search(self, params: dict[str, str], limit: int) -> dict[str, Any]:
        """/api/car's response: {num_found, listings}."""


class LiveInventorySource:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self._url = f"{settings.autopulse_api_base_url.rstrip('/')}/api/car"
        self._transport = transport

    async def search(self, params: dict[str, str], limit: int) -> dict[str, Any]:
        # /api/car has no auth today (integrations/autopulse_api_client.py);
        # called as it is.
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S, transport=self._transport) as client:
            response = await client.get(self._url, params={**params, "limit": str(limit), "page": "1"})
        response.raise_for_status()
        return response.json()


def _pattern(value: str) -> list[re.Pattern]:
    return [re.compile(f"^{v.strip()}$", re.IGNORECASE) for v in value.split(",")]


def _range(value: str) -> dict[str, float]:
    low, high = (float(x) for x in value.split("-"))
    return {"$gte": low, "$lte": high}


def to_listing(doc: dict[str, Any]) -> dict[str, Any]:
    """The fields of route.js's listing this service reads, built the same way."""
    photos = doc.get("imagesSecure") or (doc["photourls"].split("|") if isinstance(doc.get("photourls"), str) else [])
    return {
        "id": doc.get("vin") or "", "vin": doc.get("vin") or "",
        "heading": f"{doc.get('year')} {doc.get('make')} {doc.get('model')} {doc.get('trim') or ''}",
        "miles": int(doc.get("mileage") or 0), "vdp_url": doc.get("inventoryUrl") or "",
        "exterior_color": doc.get("exteriorcolor") or "", "inventory_type": doc.get("condition") or "used",
        "media": {"photo_links": photos},
        "dealer": {"id": str(doc["dealerId"]) if doc.get("dealerId") else None},
        "build": {"year": int(doc.get("year") or 0), "make": doc.get("make") or "", "model": doc.get("model") or "",
                  "trim": doc.get("trim") or "", "body_type": doc.get("body") or ""},
    }


class StubInventorySource:
    """route.js's query for the parameters this service sends, over the local database."""

    async def search(self, params: dict[str, str], limit: int) -> dict[str, Any]:
        flt: dict[str, Any] = {}
        for param, fieldname in (("make", "make"), ("model", "model"), ("car_type", "condition"),
                                 ("body_type", "body")):
            if params.get(param):
                flt[fieldname] = {"$in": _pattern(params[param])}
        if params.get("vin"):
            vins = [v.strip() for v in params["vin"].split(",")]
            flt["vin"] = {"$in": vins} if len(vins) > 1 else vins[0]
        if params.get("exterior_color"):
            # route.js: `{ $in: value.split(',') }`, a literal, case-sensitive match.
            flt["exteriorcolor"] = {"$in": params["exterior_color"].split(",")}
        if params.get("price_range"):
            flt["internetreduced"] = _range(params["price_range"])
        if params.get("year_range"):
            flt["year"] = _range(params["year_range"])
        vehicles = dealer_scoped_db(params["dealer_id"]).collection(PLATFORM_VEHICLES_COLLECTION, dealer_field="dealerId")
        total = await vehicles.count_documents(flt)
        docs = await vehicles.find(flt).sort("createdAt", -1).to_list(limit)
        return {"num_found": total, "listings": [to_listing(d) for d in docs]}


def get_inventory_source(settings: Settings) -> InventorySource:
    return StubInventorySource() if settings.platform_client == "stub" else LiveInventorySource(settings)


# --- The typed view --------------------------------------------------------------

def to_record(listing: dict[str, Any]) -> InventoryRecord:
    build = listing.get("build") or {}
    return InventoryRecord(
        source_id=listing["vin"], vin=listing["vin"],
        year=build.get("year") or None, make=build.get("make") or None, model=build.get("model") or None,
        trim=build.get("trim") or None, body_type=build.get("body_type") or None,
        condition=(listing.get("inventory_type") or "").lower() or None,
        exterior_color=listing.get("exterior_color") or None,
        miles=listing.get("miles") or None,
        page_url=listing.get("vdp_url") or None,
    )


def _records(dealer_id: str, listings: list[dict[str, Any]]) -> tuple[list[InventoryRecord], list[dict[str, str]]]:
    """The typed records, and the rows dropped with why: no VIN, or another
    dealer's (/api/car doesn't enforce the dealer)."""
    excluded: list[dict[str, str]] = []
    records = []
    for listing in listings:
        if not listing.get("vin"):
            excluded.append({"vin": "", "reason": "no VIN"})
        elif ((listing.get("dealer") or {}).get("id") or dealer_id) != dealer_id:
            excluded.append({"vin": listing["vin"], "reason": "another dealer's vehicle"})
        else:
            records.append(to_record(listing))
    return records, excluded


# --- Public API ------------------------------------------------------------------

_cache: dict[tuple, tuple[float, SearchResult]] = {}


async def search_inventory(dealer_id: str, criteria: InventoryCriteria, source: InventorySource,
                           limit: int = FETCH_LIMIT) -> SearchResult:
    """The dealer's records matching `criteria`, newest first. Raises
    if the platform can't be reached; the caller carries on without stock."""
    if not dealer_id:
        raise ValueError("dealer_id is required for an inventory search")
    params = criteria.to_params(dealer_id)
    key = (dealer_id, limit, tuple(sorted(params.items())))
    cached = _cache.get(key)
    if cached and cached[0] > monotonic_time.monotonic():
        return replace(cached[1], cached=True)
    body = await source.search(params, limit)
    listings = body.get("listings") or []
    records, excluded = _records(dealer_id, listings)
    result = SearchResult(query=criteria.model_dump(exclude_none=True), params=params,
                          matched=int(body.get("num_found") or 0), fetched=len(listings), records=records,
                          excluded=excluded, checked_at=clock.now().isoformat())
    _cache[key] = (monotonic_time.monotonic() + CACHE_TTL_S, result)
    return result


async def get_vehicle(dealer_id: str, vin: str, source: InventorySource) -> InventoryRecord | None:
    """One vehicle, read now (never cached): None if the dealer has no such VIN."""
    if not dealer_id or not vin:
        raise ValueError("dealer_id and vin are required")
    vin = vin.replace(",", "").strip()
    body = await source.search({"dealer_id": dealer_id, "vin": vin}, 1)
    records, _ = _records(dealer_id, [x for x in body.get("listings") or [] if x.get("vin") == vin])
    return records[0] if records else None


def clear_cache() -> None:
    _cache.clear()
