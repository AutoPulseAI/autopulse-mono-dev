"""One-time bulk fill of the OEM maintenance library (the user, 23 Nov 2026: pay as you go; fetch every model our
dealers' customers drive once, keep it, then only new models are asked for).

Reads every DealerVault deal and repair order (cross-dealer, or --dealer), groups the vehicles by model year / make /
model - the DMS's own VIN decode ("VIN Explosion Year / Make / Model") when it has one, else its Year / Make / Model,
since the DMS "Model" text varies ("OUTLANDER (2.5L)", "OUTLANDER (2.5L") - and asks Vehicle Databases once per model
not in the library yet, most common models first, with one real VIN of that model. Each schedule is filed under the
model's keys and under the VIN build (agent/maintenance.vin_pattern_key) of every vehicle of that model, so the daily
check finds it without a call.

Without --apply it only counts: models, models already in the library, calls this run would make. --apply needs
--max-calls (every call is paid) and stops at the first refused or rate-limited call.

    PYTHONPATH=src python -m upsell_agent.devtools.maintenance_bulk [--dealer <id>] [--since-year 2015]
        [--max-calls 100] [--retry-missing] [--refresh] [--apply]
"""

import argparse
import asyncio
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.agent.maintenance import (
    LIBRARY_NO_RECORD,
    LIBRARY_OK,
    library_key,
    log_call,
    save_to_library,
    vin_pattern_key,
)
from upsell_agent.config import get_settings
from upsell_agent.integrations.mongodb import (
    AI_MAINTENANCE_LIBRARY_COLLECTION,
    AI_VEHICLE_DATABASES_CALLS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    close_mongo,
    get_db,
    init_mongo,
)
from upsell_agent.integrations.vehicle_databases import (
    VehicleDatabasesError,
    get_vehicle_databases_client,
    valid_vin,
)

FIELDS = {"_id": 0, "dealer_id": 1, "vin": 1, "VIN": 1, "Year": 1, "Make": 1, "Model": 1,
          "VIN Explosion Year": 1, "VIN Explosion Make": 1, "VIN Explosion Model": 1}


@dataclass
class Model:
    key: str
    rows: int = 0
    vins: Counter = field(default_factory=Counter)
    other_keys: set[str] = field(default_factory=set)  # the DMS's own Year / Make / Model spellings

    def keys(self) -> list[str]:
        builds = {vin_pattern_key(v) for v in self.vins} - {None}
        return list(dict.fromkeys([self.key, *sorted(self.other_keys), *sorted(builds)]))


def model_of(row: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    """(VIN, decoded key, DMS-text key) for one deal / repair order row."""
    vin = str(row.get("vin") or row.get("VIN") or "").strip().upper()
    raw = library_key(row.get("Year"), row.get("Make"), row.get("Model"))
    decoded = library_key(row.get("VIN Explosion Year"), row.get("VIN Explosion Make"), row.get("VIN Explosion Model"))
    return (vin if valid_vin(vin) else None), decoded or raw, raw


def group(rows: list[dict[str, Any]], since_year: int | None) -> dict[str, Model]:
    models: dict[str, Model] = {}
    for row in rows:
        vin, key, raw = model_of(row)
        if not key or not vin or (since_year and int(key[:4]) < since_year):
            continue
        m = models.setdefault(key, Model(key))
        m.rows += 1
        m.vins[vin] += 1
        if raw and raw != key:
            m.other_keys.add(raw)
    return models


async def _run(args: argparse.Namespace) -> int:
    await init_mongo(get_settings())
    try:
        db = get_db()
        ids = [*(args.dealer or []), *(ObjectId(d) for d in args.dealer or [] if ObjectId.is_valid(d))]
        query = {"dealer_id": {"$in": ids}} if ids else {}
        rows = [*await db[PLATFORM_DEALS_COLLECTION].find(query, FIELDS).to_list(None),
                *await db[PLATFORM_REPAIR_ORDERS_COLLECTION].find(query, FIELDS).to_list(None)]
        models = group(rows, args.since_year)
        have = {r["key"]: r.get("status") or (LIBRARY_OK if r.get("schedule") else None)
                async for r in db[AI_MAINTENANCE_LIBRARY_COLLECTION].find({}, {"key": 1, "status": 1, "schedule": 1})}
        tried = set(await db[AI_VEHICLE_DATABASES_CALLS_COLLECTION].distinct(
            "key", {"by": "bulk", "result": LIBRARY_NO_RECORD}))

        def done(m: Model) -> bool:
            if args.refresh:
                return False
            if have.get(m.key) == LIBRARY_OK:
                return True
            return m.key in tried and not args.retry_missing

        todo = sorted((m for m in models.values() if not done(m)), key=lambda m: -m.rows)
        print(f"deal / repair order rows read: {len(rows)}; with a valid VIN and a model: "
              f"{sum(m.rows for m in models.values())}")
        print(f"models: {len(models)}; in the library already: {len(models) - len(todo)}; to fetch: {len(todo)}")
        print(f"this run: {min(len(todo), args.max_calls or 0) if args.apply else len(todo)} paid call(s)"
              + ("" if args.apply else " if run with --apply (one per model)"))
        # Credits are few (500 a month on Starter): how many of the vehicles still without a schedule the first N calls
        # cover, most common models first.
        cars = sum(len(m.vins) for m in todo)
        for n in (50, 100, 250, 500, 1000):
            if n < len(todo) and cars:
                print(f"  first {n} calls cover {sum(len(m.vins) for m in todo[:n]) * 100 // cars}% of those vehicles")
        print("most common models to fetch (model | records | vehicles):")
        for m in todo[:25]:
            print(f"  {m.key} | {m.rows} | {len(m.vins)}")
        if not args.apply:
            print("\nDry run: nothing was called or written. Add --apply --max-calls N to fetch.")
            return 0
        if not args.max_calls:
            print("--apply needs --max-calls (every call is paid).")
            return 2
        client = get_vehicle_databases_client()
        if not client.enabled:
            print("Vehicle Databases is off: set VEHICLE_DATABASES_ENABLED=true and VEHICLE_DATABASES_API_KEY.")
            return 2
        made = ok = none = 0
        for m in todo[: args.max_calls]:
            vin = m.vins.most_common(1)[0][0]
            now = clock.now()
            made += 1
            try:
                schedule = await client.maintenance_schedule(vin)
            except VehicleDatabasesError as exc:
                await log_call(now, by="bulk", vin=vin, key=m.key, result="error", error=str(exc))
                print(f"STOPPED at {m.key} ({vin}): {exc}")
                break
            if schedule:
                ok += 1
                own = library_key(schedule.year, schedule.make, schedule.model)
                await save_to_library(list(dict.fromkeys([*m.keys(), *([own] if own else [])])), schedule, now,
                                      from_vin=vin)
            else:
                none += 1
                await save_to_library([k for k in [vin_pattern_key(vin)] if k], None, now, from_vin=vin)
            await log_call(now, by="bulk", vin=vin, key=m.key, result=LIBRARY_OK if schedule else LIBRARY_NO_RECORD)
            print(f"  {m.key} ({vin}): {'schedule saved' if schedule else 'no record'}")
        print(f"\npaid calls: {made}; schedules saved: {ok}; no record: {none}; models still to fetch: "
              f"{len(todo) - made}")
        return 0
    finally:
        await close_mongo()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dealer", action="append", help="only this dealer's records (repeatable)")
    parser.add_argument("--since-year", type=int, help="only model years from this one on")
    parser.add_argument("--max-calls", type=int, default=0, help="most paid calls this run (required with --apply)")
    parser.add_argument("--retry-missing", action="store_true", help="ask again for models that had no record")
    parser.add_argument("--refresh", action="store_true", help="fetch models already in the library again")
    parser.add_argument("--apply", action="store_true", help="make the calls and save (default: count only)")
    raise SystemExit(asyncio.run(_run(parser.parse_args())))


if __name__ == "__main__":
    main()
