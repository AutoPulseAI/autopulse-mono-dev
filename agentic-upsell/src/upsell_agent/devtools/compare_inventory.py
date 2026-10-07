"""Stub vs live inventory search (MASTER_PLAN_3 Phase 1 "done when").

For every dev dealer, run the same searches through the stub source (a port
of /api/car over the local database) and the running platform's /api/car,
and check they agree: the same match count, the same VINs, and the same
values in every field the inventory tool reads. Rows with the same
`createdAt` may come back in either order, so VINs are compared as sets.

The searches: every make/model in the dealer's dev stock, each with new and
used, an exact year (sent as `year_range`, the way the tool always sends
it), and one that must find nothing. Phase 2 adds each vehicle's colour as
stored and in lower case (the platform's colour match is case-sensitive, so
the lower-case one must find nothing on both), a budget cap (`price_range`),
and a size tier (several body types at once).

Needs `make ai-seed`, the platform running (`make dev-full`) and ENVIRONMENT=DEV.
Run:  python -m upsell_agent.devtools.compare_inventory
"""

import asyncio
import sys
from typing import Any

from upsell_agent.config import get_settings
from upsell_agent.devtools.dev_inventory import STOCK
from upsell_agent.devtools.simulate import DEV_DEALERS
from upsell_agent.tools.inventory_tool import (
    FETCH_LIMIT,
    InventoryCriteria,
    LiveInventorySource,
    StubInventorySource,
)

# The listing fields tools/inventory_tool.py reads.
FIELDS = [("vin",), ("miles",), ("vdp_url",), ("exterior_color",), ("inventory_type",), ("dealer", "id"),
          ("build", "year"), ("build", "make"), ("build", "model"), ("build", "trim"), ("build", "body_type")]


def searches(dealer_id: str) -> list[InventoryCriteria]:
    found: list[InventoryCriteria] = []
    for year, make, model, _trim, _body, _condition, colour, _miles, price in STOCK.get(dealer_id, []):
        for criteria in (InventoryCriteria(make=make, model=model), InventoryCriteria(model=model, condition="used"),
                         InventoryCriteria(model=model, condition="new"),
                         InventoryCriteria(model=model, year_min=year, year_max=year),
                         InventoryCriteria(model=model, exterior_color=colour),
                         InventoryCriteria(model=model, exterior_color=colour.lower()),
                         InventoryCriteria(model=model, price_max=price)):
            if criteria not in found:
                found.append(criteria)
    found.append(InventoryCriteria(body_types=["Minivan", "Van", "Truck"]))
    found.append(InventoryCriteria(model="No Such Model"))
    return found


def _get(listing: dict[str, Any], path: tuple[str, ...]) -> Any:
    value: Any = listing
    for key in path:
        value = (value or {}).get(key)
    return value


def compare(stub: dict[str, Any], live: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    if int(stub.get("num_found") or 0) != int(live.get("num_found") or 0):
        problems.append(f"num_found: stub {stub.get('num_found')}, live {live.get('num_found')}")
    s_rows = {x["vin"]: x for x in stub.get("listings") or []}
    l_rows = {x["vin"]: x for x in live.get("listings") or []}
    if set(s_rows) != set(l_rows):
        problems.append(f"VINs differ: stub-only {sorted(set(s_rows) - set(l_rows))}, "
                        f"live-only {sorted(set(l_rows) - set(s_rows))}")
    for vin in sorted(set(s_rows) & set(l_rows)):
        for path in FIELDS:
            a, b = _get(s_rows[vin], path), _get(l_rows[vin], path)
            if a != b:
                problems.append(f"{vin} {'.'.join(path)}: stub {a!r}, live {b!r}")
    return problems


async def compare_dealers(dealer_ids: list[str]) -> list[dict[str, Any]]:
    stub, live = StubInventorySource(), LiveInventorySource(get_settings())
    results = []
    for dealer_id in dealer_ids:
        for criteria in searches(dealer_id):
            params = criteria.to_params(dealer_id)
            label = f"{dealer_id[-4:]} {criteria.model_dump(exclude_none=True)}"
            try:
                s = await stub.search(params, FETCH_LIMIT)
                live_body = await live.search(params, FETCH_LIMIT)
            except Exception as exc:  # noqa: BLE001 - reported, not raised
                results.append({"search": label, "found": 0, "problems": [], "error": f"{label}: {exc!r}"})
                continue
            results.append({"search": label, "found": int(s.get("num_found") or 0),
                            "problems": compare(s, live_body), "error": None})
    return results


async def _cli() -> int:
    from upsell_agent.integrations.mongodb import close_mongo, init_mongo

    settings = get_settings()
    if not settings.is_dev:
        print("Only runs with ENVIRONMENT=DEV.")
        return 2
    await init_mongo(settings)
    try:
        results = await compare_dealers([d["_id"] for d in DEV_DEALERS[:2]])
    finally:
        await close_mongo()
    bad = [r for r in results if r["problems"] or r["error"]]
    for r in results:
        print(f"{'OK  ' if not (r['problems'] or r['error']) else 'DIFF'}  {r['search']}  ({r['found']} found)")
        for line in ([r["error"]] if r["error"] else r["problems"])[:5]:
            print(f"        {line}")
    print(f"\n{len(results) - len(bad)}/{len(results)} searches match between stub and live")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_cli()))
