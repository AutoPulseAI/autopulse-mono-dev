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
        async with self._lock:
            wait = self._min_interval_s - (time.monotonic() - self._last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call = time.monotonic()
            self.calls += 1
            try:
                async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport) as client:
                    response = await client.get(f"{self._base}/vehicle-maintenance/v4/{vin}",
                                                headers={"x-authkey": self._key})
            except httpx.HTTPError as exc:
                raise VehicleDatabasesError(f"Vehicle Databases unreachable: {exc!r}") from exc
        status = response.status_code
        if status == 200:
            try:
                return parse_schedule(vin, response.json())
            except ValueError as exc:
                raise VehicleDatabasesError("Vehicle Databases sent a non-JSON answer") from exc
        if status in (400, 404):
            return None
        if status in (401, 402, 422):
            raise VehicleDatabasesError(f"Vehicle Databases refused the request ({status})", retryable=False)
        # 403 / 429 rate limit, 5xx: try again on a later sweep.
        raise VehicleDatabasesError(f"Vehicle Databases answered {status}")


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
