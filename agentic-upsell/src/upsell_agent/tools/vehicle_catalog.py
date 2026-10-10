"""What vehicle the customer means, in the dealer's own spelling (conversation_7, 10 Oct 2026).

Seen live: "I want to buy rdx acura" was searched as the model "rdx acura" (the make was only recognised as the
first word), matched nothing, and every later stock question - "what vehicles do you have", "do u have sonata in
stock?" - re-ran that same empty search, so the AI said there was no RDX, no Sonata and no stock at all, for a
dealer with thousands of cars and both models on the lot.

This module turns the customer's words into a make and model the platform's exact `^value$` match will find:

- **Catalog.** The dealer's own makes, models and body types, read once from the shared `vehicles` collection
  (read-only, dealer-scoped, cached CATALOG_TTL_S). /api/car computes facets but doesn't return them, so the
  catalog is read directly, like `PLATFORM_CLIENT=stub` already reads stock.
- **Resolve.** Word order doesn't matter ("rdx acura" = "Acura RDX"); spacing and dashes don't ("rav 4" = RAV4,
  "crv" = CR-V); a model gives its make (RDX -> Acura); a close misspelling of a model the dealer carries is
  corrected ("sonta" -> Sonata) above FUZZY_CUTOFF, and only for a vehicle phrase, never for a whole sentence.
  A model the dealer doesn't carry stays as said (the search then honestly finds none of it).

Nothing here searches stock or decides what to say: tools/stock_search.py does the search with what this returns.
"""

import difflib
import re
import time as monotonic_time
from dataclasses import dataclass, field
from typing import Any

from upsell_agent.integrations.mongodb import PLATFORM_VEHICLES_COLLECTION, dealer_scoped_db
from upsell_agent.tools.inventory_tool import BODY_WORDS, KNOWN_MAKES, TRIM_WORDS

CATALOG_TTL_S = 600.0
# How close a misspelling must be to a model the dealer carries to be corrected ("sonta" -> "sonata" is 0.91).
FUZZY_CUTOFF = 0.84
# Two-word makes as customers write them.
_MULTI_WORD_MAKES = {"mercedes benz": "Mercedes-Benz", "land rover": "Land Rover", "alfa romeo": "Alfa Romeo",
                     "aston martin": "Aston Martin", "rolls royce": "Rolls-Royce"}
_YEAR = re.compile(r"^(?:19[89]\d|20[0-4]\d)$")
_TOKEN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
# Words that are never part of a vehicle's name, dropped before matching a free-text message.
_STOPWORDS = {"i", "a", "an", "the", "do", "you", "u", "ya", "have", "got", "any", "in", "stock", "inventory",
              "want", "to", "buy", "looking", "for", "is", "there", "one", "ones", "car", "cars", "vehicle",
              "vehicles", "of", "on", "lot", "available", "please", "pls", "and", "or", "new", "used", "me", "my",
              "can", "show", "what", "which", "how", "much", "about", "some", "your", "we", "it", "that", "this",
              "still", "carry", "interested", "like", "would", "get", "see", "need"}

_cache: dict[str, tuple[float, "Catalog"]] = {}


def clear_cache() -> None:
    _cache.clear()


def _key(text: str) -> str:
    """"CR-V" / "cr v" / "crv" -> "crv"; "RAV4" / "rav 4" -> "rav4"."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


@dataclass
class Catalog:
    """The dealer's own spellings: model key -> (make, model, body type); make key -> make."""
    models: dict[str, tuple[str, str, str | None]] = field(default_factory=dict)
    makes: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_rows(cls, rows: list[dict[str, Any]]) -> "Catalog":
        catalog = cls()
        for row in rows:
            make, model = str(row.get("make") or "").strip(), str(row.get("model") or "").strip()
            if make:
                catalog.makes.setdefault(_key(make), make)
            if make and model:
                catalog.models.setdefault(_key(model), (make, model, row.get("body") or None))
        return catalog

    def make_for(self, word: str) -> str | None:
        key = _key(word)
        return self.makes.get(key) or KNOWN_MAKES.get(word.lower()) or KNOWN_MAKES.get(key)


async def dealer_catalog(dealer_id: str) -> Catalog:
    """The dealer's makes and models (cached CATALOG_TTL_S). An unreadable database gives an empty catalog: the
    words are then resolved with the built-in makes only, never a failed turn."""
    now = monotonic_time.monotonic()
    hit = _cache.get(dealer_id)
    if hit and now - hit[0] < CATALOG_TTL_S:
        return hit[1]
    try:
        vehicles = dealer_scoped_db(dealer_id).collection(PLATFORM_VEHICLES_COLLECTION, dealer_field="dealerId")
        rows = await vehicles.aggregate([
            {"$group": {"_id": {"make": "$make", "model": "$model"}, "body": {"$first": "$body"}}},
            {"$project": {"_id": 0, "make": "$_id.make", "model": "$_id.model", "body": 1}},
        ]).to_list(None)
    except Exception:  # noqa: BLE001 - a missing catalog only means less help with spelling
        return Catalog()
    catalog = Catalog.from_rows(rows)
    _cache[dealer_id] = (now, catalog)
    return catalog


@dataclass
class ResolvedVehicle:
    make: str | None = None
    model: str | None = None
    trim: str | None = None
    year: int | None = None
    body_type: str | None = None
    how: str = ""  # for the trace: "catalog", "fuzzy 0.91", "as said", ...
    confidence: float = 0.0

    @property
    def found(self) -> bool:
        return bool(self.make or self.model or self.body_type)

    def describe(self) -> str:
        return " ".join(str(p) for p in (self.year, self.make, self.model, self.trim) if p) or (self.body_type or "")


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall((text or "").lower())


def _take_make(words: list[str], catalog: Catalog) -> tuple[str | None, list[str]]:
    joined = " ".join(words)
    for phrase, make in _MULTI_WORD_MAKES.items():
        if phrase in joined:
            rest = joined.replace(phrase, " ").split()
            return make, rest
    for i, word in enumerate(words):
        if make := catalog.make_for(word):
            return make, words[:i] + words[i + 1:]
    return None, words


def _match_model(words: list[str], catalog: Catalog, make: str | None,
                 fuzzy: bool) -> tuple[tuple[str, str, str | None] | None, list[str], str]:
    """The longest run of words that is a model the dealer carries (any position), else a close misspelling."""
    pool = {k: v for k, v in catalog.models.items() if not make or v[0].lower() == make.lower()}
    for size in (3, 2, 1):
        for start in range(len(words) - size + 1):
            key = _key("".join(words[start:start + size]))
            # "sonatas" / "RDXs": a plural of a model is that model.
            if (hit := pool.get(key) or (pool.get(key[:-1]) if len(key) > 3 and key.endswith("s") else None)):
                return hit, words[:start] + words[start + size:], "catalog"
    if fuzzy and pool:
        for i, word in enumerate(words):
            if len(word) < 3 or word in _STOPWORDS:
                continue
            close = difflib.get_close_matches(_key(word), list(pool), n=1, cutoff=FUZZY_CUTOFF)
            if close:
                ratio = difflib.SequenceMatcher(None, _key(word), close[0]).ratio()
                return pool[close[0]], words[:i] + words[i + 1:], f"fuzzy {ratio:.2f}"
    return None, words, ""


def resolve_vehicle(text: str | None, catalog: Catalog, *, phrase: bool = True) -> ResolvedVehicle:
    """What vehicle `text` names. `phrase`: the text is a vehicle phrase ("rdx acura", "2023 Sonta SEL") -
    misspellings may be corrected; False: a whole message ("do u have sonata in stock?") - exact names only, so an
    ordinary word is never "corrected" into a model."""
    words = [w for w in _tokens(text or "") if phrase or w not in _STOPWORDS]
    out = ResolvedVehicle()
    if not words:
        return out
    if (years := [w for w in words if _YEAR.match(w)]):
        out.year = int(years[0])
        words = [w for w in words if w != years[0]]
    out.make, words = _take_make(words, catalog)
    hit, rest, how = _match_model(words, catalog, out.make, fuzzy=phrase)
    if hit is None and out.make:  # a model the dealer only carries under another make spelling
        hit, rest, how = _match_model(words, catalog, None, fuzzy=False)
    if hit:
        out.make, out.model, out.body_type = hit
        out.how, out.confidence = how, (0.95 if how == "catalog" else 0.8)
        trim = [w for w in rest if w in TRIM_WORDS or (phrase and w not in _STOPWORDS)]
        out.trim = " ".join(w.upper() if len(w) <= 3 else w.capitalize() for w in trim) or None
        return out
    def body_word(w: str) -> str | None:  # "suvs" / "trucks": the plural too
        return BODY_WORDS.get(w) or (BODY_WORDS.get(w[:-1]) if w.endswith("s") else None)

    body = next((b for w in words if (b := body_word(w))), None)
    leftover = [w for w in words if not body_word(w) and w not in _STOPWORDS]
    if phrase and leftover:
        # A model the dealer doesn't carry: searched as said (cleaned), so the answer is an honest "none".
        out.model = " ".join(w.upper() if any(c.isdigit() for c in w) else w.capitalize() for w in leftover)
        out.how, out.confidence = "as said (not in this dealer's stock)", 0.5
    elif body:
        out.body_type, out.how, out.confidence = body, "body type", 0.9
    elif out.make:
        out.how, out.confidence = "make only", 0.9
    return out
