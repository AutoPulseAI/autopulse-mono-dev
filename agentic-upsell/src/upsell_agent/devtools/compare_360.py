"""Stub vs live Customer 360 (MASTER_PLAN_1 Stage 6 "done when").

For every seeded customer, fetch Customer 360 through the stub client (built
in Python from the local database) and the live client (the running
platform's /api/customers/<id>/360), and check they agree:

- the same top-level keys;
- the same records in every list (by _id), with the same fields and values;
- the same vehicles (VIN, year, make, model, current owner);
- the same customer origin badge and value snapshot.

Computed dates are compared with a one-day tolerance: the platform parses
DealerTrack's "M/D/YYYY" strings in its server's local time zone, the stub
in UTC; the source strings themselves must match exactly.

Needs the platform running (`make dev-full`) and ENVIRONMENT=DEV.
Run:  python -m upsell_agent.devtools.compare_360
"""

import asyncio
import sys
from datetime import datetime, timedelta
from typing import Any

import httpx
from bson import ObjectId

from upsell_agent.config import get_settings
from upsell_agent.devtools.simulate import DEV_DEALERS
from upsell_agent.integrations.mongodb import (
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    PLATFORM_SERVICE_APPOINTMENTS_COLLECTION,
    PLATFORM_TRADE_INS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import LivePlatformClient, StubPlatformClient

LIST_KEYS = ["leads", "deals", "repair_orders", "appointments", "all_appointments", "trade_ins"]
VEHICLE_FIELDS = ["vin", "year", "make", "model", "vehicle_id", "current_owner_customer_id", "is_current_owner"]
# Dates the two sides compute in different time zones.
TZ_TOLERANT = {"computed_date", "last_activity_at", "at"}
IGNORED = {"__v"}


def _as_time(value: Any) -> datetime | None:
    if isinstance(value, str) and len(value) >= 19 and value[4] == "-" and "T" in value:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _same(a: Any, b: Any, key: str = "") -> bool:
    ta, tb = _as_time(a), _as_time(b)
    if ta and tb:
        tolerance = timedelta(days=1) if key in TZ_TOLERANT else timedelta(seconds=1)
        return abs(ta - tb) <= tolerance
    if isinstance(a, dict) and isinstance(b, dict):
        return set(a) - IGNORED == set(b) - IGNORED and all(_same(a[k], b[k], k) for k in set(a) - IGNORED)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same(x, y, key) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return float(a) == float(b)
    return a == b


def compare(stub: dict | None, live: dict | None) -> list[str]:
    if stub is None or live is None:
        return [] if stub is live else [(f"stub is {'missing' if stub is None else 'present'}, "
                                         f"live is {'missing' if live is None else 'present'}")]
    problems: list[str] = []
    if set(stub) != set(live):
        problems.append(f"top-level keys differ: stub-only {sorted(set(stub) - set(live))}, "
                        f"live-only {sorted(set(live) - set(stub))}")

    for key in LIST_KEYS:
        s_rows = {r.get("_id"): r for r in stub.get(key) or []}
        l_rows = {r.get("_id"): r for r in live.get(key) or []}
        if set(s_rows) != set(l_rows):
            problems.append(f"{key}: stub has {len(s_rows)} record(s), live has {len(l_rows)}")
            continue
        for rid, s_row in s_rows.items():
            l_row = l_rows[rid]
            if set(s_row) - IGNORED != set(l_row) - IGNORED:
                problems.append(f"{key} {rid}: fields differ: stub-only {sorted(set(s_row) - set(l_row) - IGNORED)}, "
                                f"live-only {sorted(set(l_row) - set(s_row) - IGNORED)}")
                continue
            for field in set(s_row) - IGNORED:
                if not _same(s_row[field], l_row[field], field):
                    problems.append(f"{key} {rid}.{field}: stub {s_row[field]!r} != live {l_row[field]!r}")

    s_vehicles = {v["vin"]: v for v in stub.get("vehicles") or []}
    l_vehicles = {v["vin"]: v for v in live.get("vehicles") or []}
    if set(s_vehicles) != set(l_vehicles):
        problems.append(f"vehicles: stub VINs {sorted(s_vehicles)} != live VINs {sorted(l_vehicles)}")
    else:
        for vin, s_vehicle in s_vehicles.items():
            for field in VEHICLE_FIELDS:
                if not _same(s_vehicle.get(field), l_vehicles[vin].get(field)):
                    problems.append(f"vehicle {vin}.{field}: stub {s_vehicle.get(field)!r} "
                                    f"!= live {l_vehicles[vin].get(field)!r}")

    for field in ("_id", "origin_badge", "name"):
        if (stub.get("customer") or {}).get(field) != (live.get("customer") or {}).get(field):
            problems.append(f"customer.{field}: stub {(stub.get('customer') or {}).get(field)!r} "
                            f"!= live {(live.get('customer') or {}).get(field)!r}")
    if not _same(stub.get("value_snapshot"), live.get("value_snapshot")):
        problems.append(f"value_snapshot: stub {stub.get('value_snapshot')} != live {live.get('value_snapshot')}")
    s_feed = sorted((e["type"], (e.get("record") or {}).get("_id")) for e in stub.get("overview") or [])
    l_feed = sorted((e["type"], (e.get("record") or {}).get("_id")) for e in live.get("overview") or [])
    if s_feed != l_feed:
        problems.append("overview: different entries")
    return problems


HISTORY_COLLECTIONS = (PLATFORM_DEALS_COLLECTION, PLATFORM_REPAIR_ORDERS_COLLECTION,
                       PLATFORM_SERVICE_APPOINTMENTS_COLLECTION, PLATFORM_TRADE_INS_COLLECTION)
# Seeded customers with DMS history are what the comparison is about. The
# simulator also creates plain customers (every scenario and burst lead does),
# so without this a long-lived dev database compared thousands of them.
MAX_PER_DEALER = 50


async def _customers_with_history(dealer_id: str) -> list[dict]:
    db = dealer_scoped_db(dealer_id)
    ids: set[str] = set()
    for name in HISTORY_COLLECTIONS:
        async for row in db.collection(name).find({"customer_id": {"$ne": None}}, projection={"customer_id": 1}):
            ids.add(str(row["customer_id"]))
    oids = [ObjectId(i) for i in ids if ObjectId.is_valid(i)]
    customers = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find(
        {"dev_seed": True, "_id": {"$in": oids}}).to_list(None)
    customers.sort(key=lambda c: c["_id"], reverse=True)
    return customers[:MAX_PER_DEALER]


async def compare_dealers(dealer_ids: list[str]) -> list[dict[str, Any]]:
    """One result per seeded customer with DMS history (the most recent 50 per
    dealer): {dealer_id, customer_id, name, problems, error}."""
    settings = get_settings()
    stub, live = StubPlatformClient(), LivePlatformClient(settings)
    results = []
    for dealer_id in dealer_ids:
        customers = await _customers_with_history(dealer_id)
        for customer in customers:
            cid = str(customer["_id"])
            result = {"dealer_id": dealer_id, "customer_id": cid, "name": customer.get("name"), "problems": [],
                      "error": None}
            try:
                live_360 = await live.get_customer_360(dealer_id, cid)
            except httpx.HTTPError as exc:
                result["error"] = (f"platform not reachable at {settings.autopulse_api_base_url} ({exc!r}); "
                                   "start it with `make dev-full`")
                results.append(result)
                continue
            result["problems"] = compare(await stub.get_customer_360(dealer_id, cid), live_360)
            results.append(result)
    return results


async def _cli() -> int:
    from upsell_agent.integrations.mongodb import close_mongo, init_mongo

    settings = get_settings()
    if not settings.is_dev:
        print("compare_360 only runs with ENVIRONMENT=DEV.")
        return 2
    await init_mongo(settings)
    try:
        results = await compare_dealers([d["_id"] for d in DEV_DEALERS])
    finally:
        await close_mongo()
    failed = 0
    for r in results:
        if r["error"] or r["problems"]:
            failed += 1
            print(f"FAIL  {r['name']} ({r['customer_id']})")
            for line in ([r["error"]] if r["error"] else r["problems"])[:10]:
                print(f"        {line}")
        else:
            print(f"PASS  {r['name']} ({r['customer_id']})")
    print(f"\n{len(results) - failed}/{len(results)} customers match between stub and live")
    return 1 if failed or not results else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_cli()))
