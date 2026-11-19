"""Trade-in values from Vehicle Databases' Market Value API (Betsy, 19 Nov 2026: "sign us up for vehicle databases
for cadences and for trade values ... the dealer will be able to decide if autopulse will be able to provide values or
if we will provide the dealer's link. So in each account, the super admin (us) will need to be able to select or flip
a switch").

The switch lives on the dealer (CRM AI Settings, `dealer_account_information.trade_value_source`: "dealer_link", the
default, or "autopulse"); the CRM only asks for a value when it is "autopulse". Each answer is kept 30 days per
vehicle (VIN, else model year / make / model), mileage rounded to the nearest 1,000 and state - shared by every
dealership - so the same question is never paid for twice. Nothing here messages a customer.
"""

from datetime import datetime
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import AI_TRADE_VALUES_COLLECTION, get_db
from upsell_agent.integrations.vehicle_databases import (
    MARKET_VALUE_SOURCE,
    VehicleDatabasesClient,
    get_vehicle_databases_client,
    market_value_from_dict,
    valid_vin,
)

MILEAGE_BAND = 1000
_STATES = ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM "
           "NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY")
US_STATES = frozenset(_STATES.split(" "))


def _norm(value: Any) -> str:
    return " ".join(str(value or "").upper().replace("-", " ").split())


def cache_key(*, vin: str | None, year: int | None, make: str | None, model: str | None, mileage: int,
              state: str) -> str:
    subject = f"VIN:{vin.upper()}" if vin else f"YMM:{int(year)}|{_norm(make)}|{_norm(model)}"
    return f"{subject}|{mileage}|{state}"


def band(mileage: int) -> int:
    return max(0, round(mileage / MILEAGE_BAND) * MILEAGE_BAND)


async def estimate(*, mileage: int, state: str, vin: str | None = None, year: int | None = None,
                   make: str | None = None, model: str | None = None,
                   client: VehicleDatabasesClient | None = None, now: datetime | None = None) -> dict[str, Any]:
    """{"status": "ok", "values": ..., "cached": bool, ...} or {"status": "off" | "no_record" | "invalid", ...}.
    Raises VehicleDatabasesError when Vehicle Databases fails."""
    client = client or get_vehicle_databases_client()
    now = now or clock.now()
    state = str(state or "").strip().upper()
    vin = str(vin or "").strip().upper() or None
    if state not in US_STATES:
        return {"status": "invalid", "reason": "a two-letter US state is needed"}
    if mileage is None or int(mileage) < 0:
        return {"status": "invalid", "reason": "the mileage is needed"}
    if vin and not valid_vin(vin):
        return {"status": "invalid", "reason": "that is not a valid 17-character VIN"}
    if not vin and not (year and _norm(make) and _norm(model)):
        return {"status": "invalid", "reason": "a VIN, or the year, make and model, is needed"}
    miles = band(int(mileage))
    key = cache_key(vin=vin, year=year, make=make, model=model, mileage=miles, state=state)
    rows = get_db()[AI_TRADE_VALUES_COLLECTION]
    hit = await rows.find_one({"key": key})
    if hit:
        values = market_value_from_dict(hit.get("values"))
        if values is None:
            return {"status": "no_record", "cached": True, "mileage_used": miles, "state": state}
        return {"status": "ok", "cached": True, "fetched_at": hit.get("fetched_at"), "mileage_used": miles,
                "state": state, "source": MARKET_VALUE_SOURCE, "values": values.as_dict()}
    if not client.enabled:
        return {"status": "off", "reason": "Vehicle Databases is off (no API key yet)"}
    values = await client.market_value(mileage=miles, state=state, vin=vin, year=year, make=make, model=model)
    await rows.update_one({"key": key}, {"$set": {"key": key, "fetched_at": now, "source": MARKET_VALUE_SOURCE,
                                                  "values": values.as_dict() if values else None}}, upsert=True)
    if values is None:
        return {"status": "no_record", "cached": False, "mileage_used": miles, "state": state}
    return {"status": "ok", "cached": False, "fetched_at": now, "mileage_used": miles, "state": state,
            "source": MARKET_VALUE_SOURCE, "values": values.as_dict()}
