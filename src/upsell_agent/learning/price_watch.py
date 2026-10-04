"""Verified price drops (PLAN_4 stream L item 6; Omnichannel PDF Days 8-30 /
31-90 "verified price change/OEM offer", inventory guardrail "Only use
verified current price changes/OEM promotions"; blueprint "Alert on PRICE
CHANGES & price drops"; architecture §15 decisions 14 and 151).

The inventory feed keeps no price history, so this service keeps its own:
one `ai_price_snapshots` row per (dealer, VIN) with the price now, when it
was first seen at that price, and every change (`history`, newest last).
Prices are read the way the platform's `GET /api/car` maps them
(aidmvcs-be-dev/app/api/car/route.js: `price = parseFloat(internetreduced ||
0)`); a zero / missing price is "no price", never a drop.

Snapshots are taken
- whenever the AI reads inventory (tools/inventory_tool.py: a search, a
  single-vehicle re-check), and
- by the price sweep (worker cron, every few hours) over the vehicles of every
  dealer the AI works for. The sweep also marks VINs that left the feed as
  out of stock.

**A verified drop** is: the same VIN, still in stock (seen in the feed in the
last STALE_AFTER), now priced lower than the highest price recorded for it in
the last LOOKBACK, by at least MIN_DROP_USD and MIN_DROP_PCT, and at the
lowest price we've seen for it in that time (a price that went down and back
up part of the way isn't announced as a drop).

**Use** (decision 14's exception, nothing more): only a Day 8-90 follow-up
touch about the "verified price change" angle may state the new price, only
for that VIN, and only that value (and the old price / the difference). The
angle isn't picked at all without one (learning/optimizer.py). The drop is
checked again when the touch fires, the vehicle is re-read fresh for the
reply, and the guard accepts those numbers only when the draft names that
vehicle (guardrails/draft_guard.py). A direct price question is still "the
team will confirm".
"""

import logging
from datetime import datetime, timedelta
from typing import Any

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_PRICE_SNAPSHOTS_COLLECTION,
    PLATFORM_VEHICLES_COLLECTION,
    DealerScopedDatabase,
    dealer_scoped_db,
    get_db,
)
from upsell_agent.learning.touches import aware

logger = logging.getLogger(__name__)

LOOKBACK = timedelta(days=60)
STALE_AFTER = timedelta(hours=48)
MIN_DROP_USD = 250
MIN_DROP_PCT = 0.01
HISTORY_LIMIT = 30


def listing_price(listing: dict[str, Any]) -> int | None:
    """/api/car's `price` (route.js: parseFloat(internetreduced || 0)), in whole dollars. None: no price."""
    try:
        value = float(listing.get("price") or 0)
    except (TypeError, ValueError):
        return None
    return int(round(value)) if value > 0 else None


def vehicle_price(doc: dict[str, Any]) -> int | None:
    """The same price straight from a platform Vehicle document."""
    return listing_price({"price": doc.get("internetreduced")})


def _title(year: Any, make: Any, model: Any, trim: Any = None) -> str | None:
    words = [str(x) for x in (year, make, model, trim) if x not in (None, "", 0)]
    return " ".join(words) or None


def listing_title(listing: dict[str, Any]) -> str | None:
    build = listing.get("build") or {}
    return _title(build.get("year"), build.get("make"), build.get("model"), build.get("trim"))


def find_drop(snapshot: dict[str, Any] | None, now: datetime) -> dict[str, Any] | None:
    """The verified drop on this snapshot, or None (see the module docstring)."""
    if not snapshot or not snapshot.get("in_stock") or not snapshot.get("price"):
        return None
    seen = aware(snapshot.get("last_seen_at"))
    if seen is None or now - seen > STALE_AFTER:
        return None
    price = int(snapshot["price"])
    since = aware(snapshot.get("price_at")) or now
    earlier = [h for h in snapshot.get("history") or []
               if (at := aware(h.get("at"))) is not None and at < since and h.get("price")
               and now - (aware(h.get("until")) or at) <= LOOKBACK]
    if not earlier:
        return None
    previous = max(int(h["price"]) for h in earlier)
    lowest = min(int(h["price"]) for h in earlier)
    amount = previous - price
    if price > lowest or amount < max(MIN_DROP_USD, previous * MIN_DROP_PCT):
        return None
    return {"vin": snapshot["vin"], "price": price, "previous_price": previous, "amount": amount,
            "title": snapshot.get("title"), "dropped_at": since, "checked_at": seen}


async def record_prices(db: DealerScopedDatabase, items: list[dict[str, Any]], *, at: datetime | None = None,
                        source: str = "inventory") -> dict[str, int]:
    """Snapshots for `items` ({vin, price, title?}). One read for all of them; only new VINs and changed prices
    are written one by one, the rest get their `last_seen_at` in one update."""
    now = at or clock.now()
    items = [i for i in items if i.get("vin") and i.get("price")]
    if not items:
        return {"new": 0, "changed": 0, "unchanged": 0}
    snapshots = db.collection(AI_PRICE_SNAPSHOTS_COLLECTION)
    existing = {s["vin"]: s for s in await snapshots.find({"vin": {"$in": [i["vin"] for i in items]}}).to_list(None)}
    counts = {"new": 0, "changed": 0, "unchanged": 0}
    unchanged: list[str] = []
    for item in items:
        vin, price = item["vin"], int(item["price"])
        old = existing.get(vin)
        if old and int(old.get("price") or 0) == price:
            unchanged.append(vin)
            continue
        # Each history entry is one price: when it was first seen (`at`) and last seen (`until`).
        history = [dict(h) for h in (old or {}).get("history") or []]
        if history:
            history[-1]["until"] = old.get("last_seen_at") or history[-1].get("at")
        history = [*history, {"price": price, "at": now, "source": source}][-HISTORY_LIMIT:]
        fields: dict[str, Any] = {"price": price, "price_at": now, "last_seen_at": now, "in_stock": True,
                                  "updated_at": now, "history": history,
                                  **({"title": item["title"]} if item.get("title") else {})}
        drop = find_drop({**(old or {}), **fields, "vin": vin}, now)
        fields["drop"] = {**drop, "verified_at": now} if drop else None
        update: dict[str, Any] = {"$set": fields}
        if old is None:
            update["$setOnInsert"] = {"vin": vin, "first_price": price, "first_seen_at": now}
            counts["new"] += 1
        else:
            counts["changed"] += 1
        await snapshots.update_one({"vin": vin}, update, upsert=True)
    if unchanged:
        await snapshots.update_many({"vin": {"$in": unchanged}}, {"$set": {"last_seen_at": now, "in_stock": True}})
        counts["unchanged"] = len(unchanged)
    return counts


async def record_listings(dealer_id: str, listings: list[dict[str, Any]], *, source: str = "inventory") -> None:
    """Called with /api/car's listings whenever the AI reads inventory. Never raises."""
    try:
        items = [{"vin": x.get("vin"), "price": listing_price(x), "title": listing_title(x)} for x in listings]
        await record_prices(dealer_scoped_db(dealer_id), items, source=source)
    except Exception as exc:  # noqa: BLE001 - a snapshot never stops a turn
        logger.debug("Price snapshot skipped for %s: %r", dealer_id, exc)


async def current_drop(db: DealerScopedDatabase, vin: str | None, now: datetime | None = None) -> dict[str, Any] | None:
    if not vin:
        return None
    snapshot = await db.collection(AI_PRICE_SNAPSHOTS_COLLECTION).find_one({"vin": vin})
    return find_drop(snapshot, now or clock.now())


def lead_vins(lead: dict | None, lead_state: dict | None) -> list[str]:
    """The vehicles this lead is about, most relevant first: the VIN on the lead, then those we showed them."""
    from upsell_agent.agent.vehicle_media import lead_vehicle_vin

    vins: list[str] = []
    if (vin := lead_vehicle_vin(lead, None)):
        vins.append(vin)
    shown = ((lead_state or {}).get("conversation") or {}).get("shown_vehicles") or []
    vins += [v["vin"] for v in reversed(shown) if isinstance(v, dict) and v.get("vin")]
    return list(dict.fromkeys(vins))


async def drop_for_lead(db: DealerScopedDatabase, lead: dict | None, lead_state: dict | None,
                        now: datetime | None = None) -> dict[str, Any] | None:
    """A verified price drop on a vehicle this lead is about, or None."""
    for vin in lead_vins(lead, lead_state):
        if drop := await current_drop(db, vin, now):
            return drop
    return None


async def reverify(db: DealerScopedDatabase, drop: dict[str, Any], source: Any) -> dict[str, Any] | None:
    """Right before the touch is written: read the vehicle fresh from the feed, snapshot it, and check the drop
    still holds at the same price. None: it doesn't (sold, repriced, or the feed can't be read)."""
    try:
        body = await source.search({"dealer_id": db.dealer_id, "vin": drop["vin"]}, 1)
    except Exception as exc:  # noqa: BLE001 - can't verify means no price
        logger.warning("Price re-check failed for %s/%s: %r", db.dealer_id, drop.get("vin"), exc)
        return None
    listing = next((x for x in body.get("listings") or [] if x.get("vin") == drop["vin"]), None)
    if listing is None or ((listing.get("dealer") or {}).get("id") or db.dealer_id) != db.dealer_id:
        await db.collection(AI_PRICE_SNAPSHOTS_COLLECTION).update_one(
            {"vin": drop["vin"]}, {"$set": {"in_stock": False, "drop": None}})
        return None
    await record_prices(db, [{"vin": drop["vin"], "price": listing_price(listing), "title": listing_title(listing)}],
                        source="touch_recheck")
    fresh = await current_drop(db, drop["vin"])
    return fresh if fresh and fresh["price"] == drop["price"] else None


def touch_instruction(drop: dict[str, Any]) -> str:
    """Compose's instruction for a touch announcing a verified drop (the only time a price is stated)."""
    what = drop.get("title") or "the vehicle they were looking at"
    return (f"Verified price drop: the {what} (VIN {drop['vin']}) is now ${drop['price']:,} - it was "
            f"${drop['previous_price']:,}. Tell them plainly in one sentence, name that vehicle (list its VIN in "
            "sms_vins and email_vins) and ask whether they'd like to come see it. State only that new price (and "
            "the old one, if you mention it) - no other price, payment, rate, discount or offer. If that vehicle "
            "isn't in the inventory you were given, don't mention any price: ask whether they'd like to hear "
            "when something that fits them comes in.")


def for_touch(drop: dict[str, Any]) -> dict[str, Any]:
    """What a planned touch stores about its drop (plain JSON: no datetimes)."""
    return {"vin": drop["vin"], "price": drop["price"], "previous_price": drop["previous_price"],
            "amount": drop["amount"], "title": drop.get("title")}


async def sweep(now: datetime | None = None, *, limit_per_dealer: int = 5000) -> dict[str, Any]:
    """The periodic snapshot (worker cron): every vehicle of every dealer the AI works for, priced the way
    /api/car prices it. VINs gone from the feed are marked out of stock. Cross-dealer by design (like the
    Day 91 sweep); each dealer's rows are written through its own scope."""
    now = now or clock.now()
    raw = get_db()
    dealers = [d for d in await raw[AI_LEAD_STATE_COLLECTION].distinct("dealer_id") if d]
    summary: dict[str, Any] = {"dealers": 0, "vehicles": 0, "new": 0, "changed": 0, "gone": 0, "drops": 0}
    for dealer_id in dealers:
        either: list[Any] = [dealer_id, *([ObjectId(dealer_id)] if ObjectId.is_valid(dealer_id) else [])]
        docs = await raw[PLATFORM_VEHICLES_COLLECTION].find(
            {"dealerId": {"$in": either}},
            projection={"vin": 1, "internetreduced": 1, "year": 1, "make": 1, "model": 1, "trim": 1},
        ).to_list(limit_per_dealer)
        if not docs:
            continue
        db = dealer_scoped_db(dealer_id)
        items = [{"vin": d.get("vin"), "price": vehicle_price(d),
                  "title": _title(d.get("year"), d.get("make"), d.get("model"), d.get("trim"))} for d in docs]
        counts = await record_prices(db, items, at=now, source="sweep")
        seen = [d["vin"] for d in docs if d.get("vin")]
        gone = await db.collection(AI_PRICE_SNAPSHOTS_COLLECTION).update_many(
            {"vin": {"$nin": seen}, "in_stock": True}, {"$set": {"in_stock": False, "drop": None, "gone_at": now}})
        summary["dealers"] += 1
        summary["vehicles"] += len(docs)
        summary["new"] += counts["new"]
        summary["changed"] += counts["changed"]
        summary["gone"] += gone.modified_count
        summary["drops"] += await db.collection(AI_PRICE_SNAPSHOTS_COLLECTION).count_documents(
            {"in_stock": True, "drop": {"$ne": None}})
    return summary


async def drops(db: DealerScopedDatabase, now: datetime | None = None, limit: int = 50) -> list[dict[str, Any]]:
    """The dealer's current verified drops, for the report."""
    now = now or clock.now()
    rows = await db.collection(AI_PRICE_SNAPSHOTS_COLLECTION).find(
        {"in_stock": True, "drop": {"$ne": None}}).to_list(500)
    found = [d for r in rows if (d := find_drop(r, now))]
    found.sort(key=lambda d: d["dropped_at"], reverse=True)
    return found[:limit]
