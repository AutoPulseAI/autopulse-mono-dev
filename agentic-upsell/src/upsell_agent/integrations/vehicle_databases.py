"""Vehicle Databases: OEM maintenance schedules by VIN (MASTER_PLAN_4 D5, stream A4; SOLD-DELIVERED PDF §5).

The client chose it on 21 Sep / 1 Oct 2026: "This company has the cadences we need for service intervals by
OEM" (docs/data/5/vechicle_api.md). The 15-day trial must NOT start until the end of the build, so this client
was written against the public docs only (https://vehicledatabases.com/docs/api-documentation/vehicle-maintenance/,
read 4 Oct 2026) and every test uses a mocked response. It is off unless VEHICLE_DATABASES_ENABLED=true and
VEHICLE_DATABASES_API_KEY is set.

From the docs (version 4.0, updated 2 Oct 2026):
- GET https://api.vehicledatabases.com/vehicle-maintenance/v4/{vin}, header `x-authkey: <key>`, 17-character
  VINs, US vehicles.
- 200: {"status": "success", "data": {"vin", "year", "make", "model", "trim",
  "maintenance": [{"mileage": {"miles": 15000, "km": 24100}, "service_items": ["Replace Cabin Air Filter", ...]}]}}
- Errors: 400 "Record(s) were not found for this vehicle", 401 invalid key, 403 or 429 rate limit exceeded,
  422 validation error, 5xx server error.

The schedule is mileage-only: there are no time intervals in it. A `months` value is read if a future
response carries one (`mileage.months` or `months` on the interval); nothing here makes one up.

Each call costs a credit, so a VIN's schedule is fetched once and stored on the vehicle (agent/maintenance.py
refreshes it rarely); calls are spaced at least `min_interval_s` apart ("Rate Limit Exceeded ... implement
appropriate retry mechanisms").
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

import httpx

TIMEOUT_S = 15.0
SOURCE = "vehicle_databases_maintenance_v4"


class VehicleDatabasesError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable


class VehicleDatabasesDisabled(VehicleDatabasesError):
    def __init__(self) -> None:
        super().__init__("Vehicle Databases is off (VEHICLE_DATABASES_ENABLED / VEHICLE_DATABASES_API_KEY)",
                         retryable=False)


@dataclass(frozen=True)
class ServiceInterval:
    miles: int
    items: tuple[str, ...]
    km: int | None = None
    months: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return {"miles": self.miles, "km": self.km, "months": self.months, "service_items": list(self.items)}


@dataclass(frozen=True)
class MaintenanceSchedule:
    vin: str
    year: int | None
    make: str | None
    model: str | None
    trim: str | None
    intervals: tuple[ServiceInterval, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict[str, Any]:
        return {"vin": self.vin, "year": self.year, "make": self.make, "model": self.model, "trim": self.trim,
                "intervals": [i.as_dict() for i in self.intervals]}


def _int(value: Any) -> int | None:
    try:
        return int(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return None


def parse_schedule(vin: str, body: dict[str, Any]) -> MaintenanceSchedule | None:
    """The 200 body as a schedule, sorted by mileage. None when the body holds no usable intervals."""
    if (body or {}).get("status") != "success":
        return None
    data = body.get("data") or {}
    intervals: list[ServiceInterval] = []
    for row in data.get("maintenance") or []:
        mileage = row.get("mileage") or {}
        miles = _int(mileage.get("miles"))
        items = tuple(str(i).strip() for i in row.get("service_items") or [] if str(i).strip())
        if miles is None or miles <= 0 or not items:
            continue
        intervals.append(ServiceInterval(miles=miles, items=items, km=_int(mileage.get("km")),
                                         months=_int(mileage.get("months") or row.get("months"))))
    if not intervals:
        return None
    intervals.sort(key=lambda i: i.miles)
    return MaintenanceSchedule(vin=str(data.get("vin") or vin), year=_int(data.get("year")),
                               make=data.get("make"), model=data.get("model"), trim=data.get("trim"),
                               intervals=tuple(intervals))


def schedule_from_dict(value: dict[str, Any] | None) -> MaintenanceSchedule | None:
    """A schedule stored on the vehicle (MaintenanceSchedule.as_dict) back as a schedule."""
    if not value or not value.get("intervals"):
        return None
    return MaintenanceSchedule(
        vin=value.get("vin") or "", year=value.get("year"), make=value.get("make"), model=value.get("model"),
        trim=value.get("trim"),
        intervals=tuple(ServiceInterval(miles=i["miles"], items=tuple(i.get("service_items") or ()), km=i.get("km"),
                                        months=i.get("months")) for i in value["intervals"]))


# --- Market value (trade-in) ------------------------------------------------------------------------------------
# Betsy, 19 Nov 2026: "sign us up for vehicle databases for cadences and for trade values"; per dealer the super admin
# picks AutoPulse values or the dealer's own link. From the public docs (market-value, read 19 Nov 2026):
# - GET /market-value/v2/{vin}?mileage=&state=  or  /market-value/v2/ymm/{year}/{make}/{model}?mileage=&state=
# - 200: {"status": "success", "data": {"basic": {year, make, model, trim, state, mileage},
#   "market_value": {"market_value_data": [{"trim": ..., "market value": [{"Condition": "Outstanding" | "Clean" |
#   "Average" | "Rough", "Trade-In": "$6,829", "Private Party": "$...", "Dealer Retail": "$..."}]}]}}}
# - errors as the maintenance API (400 no record, 401 key, 403 / 429 rate limit, 422 validation, 5xx).
MARKET_VALUE_SOURCE = "vehicle_databases_market_value_v2"
CONDITIONS = ("Outstanding", "Clean", "Average", "Rough")


def _dollars(value: Any) -> int | None:
    n = _int(str(value or "").replace("$", ""))
    return n if n is not None and n > 0 else None


@dataclass(frozen=True)
class TrimValue:
    trim: str | None
    # condition -> {"trade_in", "private_party", "dealer_retail"} in whole dollars
    by_condition: dict[str, dict[str, int | None]]

    def as_dict(self) -> dict[str, Any]:
        return {"trim": self.trim, "by_condition": self.by_condition}


@dataclass(frozen=True)
class MarketValue:
    year: int | None
    make: str | None
    model: str | None
    state: str | None
    mileage: int | None
    trims: tuple[TrimValue, ...]

    def as_dict(self) -> dict[str, Any]:
        return {"year": self.year, "make": self.make, "model": self.model, "state": self.state,
                "mileage": self.mileage, "trims": [t.as_dict() for t in self.trims]}


def parse_market_value(body: dict[str, Any]) -> MarketValue | None:
    """The 200 body as values per trim and condition. None when it holds no usable trade-in value."""
    if (body or {}).get("status") != "success":
        return None
    data = body.get("data") or {}
    basic = data.get("basic") or {}
    trims: list[TrimValue] = []
    for row in (data.get("market_value") or {}).get("market_value_data") or []:
        by: dict[str, dict[str, int | None]] = {}
        for cond in row.get("market value") or row.get("market_value") or []:
            name = str(cond.get("Condition") or "").strip().title()
            if name not in CONDITIONS:
                continue
            values = {"trade_in": _dollars(cond.get("Trade-In")), "private_party": _dollars(cond.get("Private Party")),
                      "dealer_retail": _dollars(cond.get("Dealer Retail"))}
            if any(values.values()):
                by[name] = values
        if by:
            trims.append(TrimValue(trim=row.get("trim"), by_condition=by))
    if not trims:
        return None
    return MarketValue(year=_int(basic.get("year")), make=basic.get("make"), model=basic.get("model"),
                       state=basic.get("state"), mileage=_int(basic.get("mileage")), trims=tuple(trims))


def market_value_from_dict(value: dict[str, Any] | None) -> MarketValue | None:
    if not value or not value.get("trims"):
        return None
    return MarketValue(year=value.get("year"), make=value.get("make"), model=value.get("model"),
                       state=value.get("state"), mileage=value.get("mileage"),
                       trims=tuple(TrimValue(trim=t.get("trim"), by_condition=t.get("by_condition") or {})
                                   for t in value["trims"]))


class VehicleDatabasesClient:
    def __init__(self, *, api_key: str, enabled: bool, api_base: str = "https://api.vehicledatabases.com",
                 min_interval_s: float = 1.0, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._key = api_key
        self._enabled = enabled
        self._base = api_base.rstrip("/")
        self._min_interval_s = min_interval_s
        self._transport = transport
        self._lock = asyncio.Lock()
        self._last_call = 0.0
        self.calls = 0

    @property
    def enabled(self) -> bool:
        return self._enabled and bool(self._key)

    async def maintenance_schedule(self, vin: str) -> MaintenanceSchedule | None:
        """The OEM schedule for this VIN; None when Vehicle Databases has no record for it (400)."""
        if not self.enabled:
            raise VehicleDatabasesDisabled()
        if not valid_vin(vin):
            # Same answer as Vehicle Databases' own 400 for an unknown VIN, without spending a credit.
            return None
        body = await self._get(f"/vehicle-maintenance/v4/{vin}")
        return parse_schedule(vin, body) if body is not None else None

    async def market_value(self, *, mileage: int, state: str, vin: str | None = None, year: int | None = None,
                           make: str | None = None, model: str | None = None) -> MarketValue | None:
        """Trade-in / private party / dealer retail values by condition, from a VIN or a year / make / model, for
        a mileage and a US state. None when Vehicle Databases has no record (400)."""
        if not self.enabled:
            raise VehicleDatabasesDisabled()
        query = {"mileage": str(int(mileage)), "state": state}
        if vin:
            if not valid_vin(vin):
                return None
            path = f"/market-value/v2/{vin}"
        elif year and make and model:
            path = "/market-value/v2/ymm/{}/{}/{}".format(int(year), quote(str(make).strip(), safe=""),
                                                          quote(str(model).strip(), safe=""))
        else:
            raise ValueError("a VIN or a year, make and model is needed")
        body = await self._get(path, query)
        return parse_market_value(body) if body is not None else None

    async def _get(self, path: str, params: dict[str, str] | None = None) -> dict[str, Any] | None:
        """One paid call, spaced min_interval_s from the last. The JSON body, None on 400 / 404 (no record)."""
        async with self._lock:
            wait = self._min_interval_s - (time.monotonic() - self._last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call = time.monotonic()
            self.calls += 1
            try:
                async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport) as client:
                    response = await client.get(f"{self._base}{path}", params=params,
                                                headers={"x-authkey": self._key})
            except httpx.HTTPError as exc:
                raise VehicleDatabasesError(f"Vehicle Databases unreachable: {exc!r}") from exc
        status = response.status_code
        if status == 200:
            try:
                return response.json()
            except ValueError as exc:
                raise VehicleDatabasesError("Vehicle Databases sent a non-JSON answer") from exc
        if status in (400, 404):
            return None
        if status in (401, 402, 422):
            raise VehicleDatabasesError(f"Vehicle Databases refused the request ({status})", retryable=False)
        # 403 / 429 rate limit, 5xx: try again later.
        raise VehicleDatabasesError(f"Vehicle Databases answered {status}")


_VIN_VALUES = {**{str(d): d for d in range(10)}, **dict(zip("ABCDEFGH", range(1, 9))),
               **dict(zip("JKLMNPR", (1, 2, 3, 4, 5, 7, 9))), **dict(zip("STUVWXYZ", range(2, 10)))}
_VIN_WEIGHTS = (8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2)


def valid_vin(vin: str | None) -> bool:
    """A real 17-character North American VIN: no I, O or Q, and the check digit (position 9) matches.
    Every Vehicle Databases call costs a credit, so a made-up or mistyped VIN (dev seed stock, a typo on a
    DMS import) is never sent."""
    vin = str(vin or "").strip().upper()
    if len(vin) != 17 or any(ch not in _VIN_VALUES for ch in vin):
        return False
    total = sum(_VIN_VALUES[ch] * w for ch, w in zip(vin, _VIN_WEIGHTS, strict=True))
    check = total % 11
    return vin[8] == ("X" if check == 10 else str(check))


_client: VehicleDatabasesClient | None = None


def get_vehicle_databases_client() -> VehicleDatabasesClient:
    global _client
    if _client is None:
        from upsell_agent.config import get_settings

        settings = get_settings()
        _client = VehicleDatabasesClient(api_key=settings.vehicle_databases_api_key,
                                         enabled=settings.vehicle_databases_enabled,
                                         api_base=settings.vehicle_databases_api_base,
                                         min_interval_s=settings.vehicle_databases_min_interval_s)
    return _client
