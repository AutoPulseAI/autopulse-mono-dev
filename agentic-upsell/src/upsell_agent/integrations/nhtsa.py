"""NHTSA's free public APIs for safety recalls (MASTER_PLAN_4 D6, stream A4; SOLD-DELIVERED PDF §6).

The first external government data source this service calls. Two endpoints, both checked live on
4 Oct 2026 (the recorded responses are the unit-test fixtures in tests/unit/fixtures/nhtsa/):

- vPIC VIN decode: GET {vpic}/vehicles/DecodeVinValues/{vin}?format=json -> one flat `Results` row with
  `Make`, `Model`, `ModelYear` and `ErrorCode` ("0" = "VIN decoded clean"; anything else, e.g. "1" for a bad
  check digit, means the VIN can't be trusted and nothing is looked up for it).
- Recalls by vehicle: GET {api}/recalls/recallsByVehicle?make=&model=&modelYear= -> `results`, each with
  `NHTSACampaignNumber`, `Component`, `Summary`, `Consequence`, `Remedy`, `ReportReceivedDate` (DD/MM/YYYY).

NHTSA has no public VIN-level recall endpoint (`/recalls/recallsByVin` and similar answer 403; nhtsa.gov's own
VIN search is a website, not an API). So what this returns is a **model-level** match: every recall NHTSA lists
for that year/make/model, not proof that this VIN is affected or still unrepaired. The PDF's rule "never claim
a recall without VIN-specific authoritative support" is applied in agent/recalls.py: a model-level match only
raises a staff notice, never customer outreach.

Rate limiting: at least `min_interval_s` between calls from this process (NHTSA publishes no limit; one a
second is polite), and each year/make/model's recall list is cached for a day, since many owned vehicles share
a model. A network error, timeout or non-200 raises NhtsaError; the sweep records it and tries again later.
"""

import asyncio
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

TIMEOUT_S = 10.0
RECALLS_CACHE_TTL_S = 24 * 3600
SOURCE_RECALLS_BY_VEHICLE = "nhtsa_recalls_by_vehicle"
SOURCE_VPIC = "nhtsa_vpic"

_VIN = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")


class NhtsaError(RuntimeError):
    """NHTSA unreachable or answered with an error; try again on a later sweep."""


def normalize_vin(value: Any) -> str | None:
    """A 17-character VIN (no I, O or Q), upper-cased; None for anything else."""
    if not isinstance(value, str):
        return None
    vin = value.strip().upper()
    return vin if _VIN.match(vin) else None


@dataclass(frozen=True)
class DecodedVin:
    vin: str
    year: int | None
    make: str | None
    model: str | None
    trim: str | None
    error_code: str
    error_text: str

    @property
    def usable(self) -> bool:
        """Decoded clean, with a year, make and model to look recalls up by."""
        return self.error_code == "0" and bool(self.year and self.make and self.model)


@dataclass(frozen=True)
class Recall:
    """One recall NHTSA lists for a year/make/model."""
    recall_id: str  # NHTSA campaign number, e.g. "20V314000"
    component: str
    summary: str
    consequence: str
    remedy: str
    manufacturer: str
    report_received: datetime | None
    raw: dict[str, Any] = field(default_factory=dict, compare=False)


def _parse_report_date(value: Any) -> datetime | None:
    """ReportReceivedDate is DD/MM/YYYY ("28/05/2020")."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value.strip(), "%d/%m/%Y").replace(tzinfo=UTC)
    except ValueError:
        return None


def parse_decode(vin: str, body: dict[str, Any]) -> DecodedVin:
    rows = body.get("Results") or []
    row = rows[0] if rows else {}
    year_text = str(row.get("ModelYear") or "").strip()
    return DecodedVin(
        vin=vin,
        year=int(year_text) if year_text.isdigit() else None,
        make=(row.get("Make") or "").strip() or None,
        model=(row.get("Model") or "").strip() or None,
        trim=(row.get("Trim") or "").strip() or None,
        # ErrorCode can list several codes ("1,14"); only exactly "0" is clean.
        error_code=str(row.get("ErrorCode") or "").strip() or "unknown",
        error_text=str(row.get("ErrorText") or "").strip(),
    )


def parse_recalls(body: dict[str, Any]) -> list[Recall]:
    out: list[Recall] = []
    for row in body.get("results") or []:
        recall_id = (row.get("NHTSACampaignNumber") or "").strip()
        if not recall_id:
            continue
        out.append(Recall(
            recall_id=recall_id,
            component=(row.get("Component") or "").strip(),
            summary=(row.get("Summary") or "").strip(),
            consequence=(row.get("Consequence") or "").strip(),
            remedy=(row.get("Remedy") or "").strip(),
            manufacturer=(row.get("Manufacturer") or "").strip(),
            report_received=_parse_report_date(row.get("ReportReceivedDate")),
            raw=row,
        ))
    return out


class NhtsaClient:
    def __init__(self, *, api_base: str = "https://api.nhtsa.gov", vpic_base: str = "https://vpic.nhtsa.dot.gov/api",
                 min_interval_s: float = 1.0, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._api = api_base.rstrip("/")
        self._vpic = vpic_base.rstrip("/")
        self._min_interval_s = min_interval_s
        self._transport = transport
        self._lock = asyncio.Lock()
        self._last_call = 0.0
        self._cache: dict[tuple[str, str, int], tuple[float, list[Recall]]] = {}
        self.calls = 0  # for tests and the sweep's summary

    async def _get(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        async with self._lock:
            wait = self._min_interval_s - (time.monotonic() - self._last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call = time.monotonic()
            self.calls += 1
            try:
                async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport) as client:
                    response = await client.get(url, params=params)
            except httpx.HTTPError as exc:
                raise NhtsaError(f"NHTSA unreachable: {exc!r}") from exc
        if response.status_code != 200:
            raise NhtsaError(f"NHTSA answered {response.status_code} for {url}")
        try:
            return response.json()
        except ValueError as exc:
            raise NhtsaError(f"NHTSA sent a non-JSON answer for {url}") from exc

    async def decode_vin(self, vin: str) -> DecodedVin:
        body = await self._get(f"{self._vpic}/vehicles/DecodeVinValues/{vin}", {"format": "json"})
        return parse_decode(vin, body)

    async def recalls_by_vehicle(self, make: str, model: str, year: int) -> list[Recall]:
        key = (make.strip().upper(), model.strip().upper(), int(year))
        cached = self._cache.get(key)
        if cached and time.monotonic() - cached[0] < RECALLS_CACHE_TTL_S:
            return cached[1]
        body = await self._get(f"{self._api}/recalls/recallsByVehicle",
                               {"make": make, "model": model, "modelYear": str(year)})
        recalls = parse_recalls(body)
        self._cache[key] = (time.monotonic(), recalls)
        return recalls


_client: NhtsaClient | None = None


def get_nhtsa_client() -> NhtsaClient:
    """One client per process, so the rate limit and the cache are shared by every sweep."""
    global _client
    if _client is None:
        from upsell_agent.config import get_settings

        settings = get_settings()
        _client = NhtsaClient(api_base=settings.nhtsa_api_base, vpic_base=settings.nhtsa_vpic_base,
                              min_interval_s=settings.nhtsa_min_interval_s)
    return _client
