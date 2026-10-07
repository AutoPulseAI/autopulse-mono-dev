"""The customer's own time zone (MASTER_PLAN_3 B0.5, architecture §15
decisions 23 and 70).

In order:

1. **ZIP, else state**, from the customer's DealerVault rows (`deals`,
   `repairorders`, `serviceappointments` keep the DMS columns `Zip` / `State`
   under their exact names). The platform `Customer` and `Lead` records have
   no address. ZIP → zone from the `zipcodes` package.
2. **Else the phone's area code** (`phonenumbers`).
3. **Else every continental US zone at once**: only the hours legal in all
   of them are used.

A state that spans two zones (Texas, Florida, ...) keeps both, so again only
the hours legal in both count. A ZIP state and an area-code state that
differ are both kept for the same reason (the stricter wins, decision 25).

The result is a list of zones; the send check needs the time to be allowed
in every one of them.
"""

import re
from dataclasses import dataclass, field
from typing import Any

from upsell_agent.integrations.mongodb import (
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    PLATFORM_SERVICE_APPOINTMENTS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
)

CONTINENTAL_ZONES = ("America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
                     "America/Los_Angeles")

# Every zone a state's area can be in. Two-zone states list both (decision 70).
STATE_ZONES: dict[str, tuple[str, ...]] = {
    "AL": ("America/Chicago",), "AK": ("America/Anchorage",), "AZ": ("America/Phoenix",),
    "AR": ("America/Chicago",), "CA": ("America/Los_Angeles",), "CO": ("America/Denver",),
    "CT": ("America/New_York",), "DE": ("America/New_York",), "DC": ("America/New_York",),
    "FL": ("America/New_York", "America/Chicago"), "GA": ("America/New_York",), "HI": ("Pacific/Honolulu",),
    "ID": ("America/Denver", "America/Los_Angeles"), "IL": ("America/Chicago",),
    "IN": ("America/New_York", "America/Chicago"), "IA": ("America/Chicago",),
    "KS": ("America/Chicago", "America/Denver"), "KY": ("America/New_York", "America/Chicago"),
    "LA": ("America/Chicago",), "ME": ("America/New_York",), "MD": ("America/New_York",),
    "MA": ("America/New_York",), "MI": ("America/New_York", "America/Chicago"), "MN": ("America/Chicago",),
    "MS": ("America/Chicago",), "MO": ("America/Chicago",), "MT": ("America/Denver",),
    "NE": ("America/Chicago", "America/Denver"), "NV": ("America/Los_Angeles",), "NH": ("America/New_York",),
    "NJ": ("America/New_York",), "NM": ("America/Denver",), "NY": ("America/New_York",),
    "NC": ("America/New_York",), "ND": ("America/Chicago", "America/Denver"), "OH": ("America/New_York",),
    "OK": ("America/Chicago",), "OR": ("America/Los_Angeles", "America/Denver"), "PA": ("America/New_York",),
    "RI": ("America/New_York",), "SC": ("America/New_York",), "SD": ("America/Chicago", "America/Denver"),
    "TN": ("America/New_York", "America/Chicago"), "TX": ("America/Chicago", "America/Denver"),
    "UT": ("America/Denver",), "VT": ("America/New_York",), "VA": ("America/New_York",),
    "WA": ("America/Los_Angeles",), "WV": ("America/New_York",), "WI": ("America/Chicago",),
    "WY": ("America/Denver",), "PR": ("America/Puerto_Rico",),
}

_RECORD_COLLECTIONS = (PLATFORM_DEALS_COLLECTION, PLATFORM_REPAIR_ORDERS_COLLECTION,
                       PLATFORM_SERVICE_APPOINTMENTS_COLLECTION)
_ZIP_FIELDS = ("Zip", "CASS_STD_ZIP")
_STATE_FIELDS = ("State", "CASS_STD_STATE")


@dataclass(frozen=True)
class CustomerZone:
    zones: tuple[str, ...]
    # zip / state / area_code / unknown
    method: str
    detail: str
    state: str | None = None
    notes: list[str] = field(default_factory=list)
    # Every state whose hours apply (MASTER_PLAN_4 F1): the ZIP / DealerVault state and, when it
    # differs, the area-code state too (the stricter row wins). Empty: just `state`, if any.
    states: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {"zones": list(self.zones), "method": self.method, "detail": self.detail, "state": self.state,
                "notes": list(self.notes), "states": list(self.states or ((self.state,) if self.state else ()))}


def zone_for_zip(zip_code: Any) -> tuple[str | None, str | None]:
    """(time zone, state) for a US ZIP, or (None, None)."""
    digits = re.sub(r"\D", "", str(zip_code or ""))[:5]
    if len(digits) != 5:
        return None, None
    import zipcodes  # local: loads its table on first use

    try:
        matches = zipcodes.matching(digits)
    except (TypeError, ValueError):
        return None, None
    if not matches:
        return None, None
    return matches[0].get("timezone") or None, matches[0].get("state") or None


def zones_for_phone(phone: Any) -> tuple[tuple[str, ...], str | None]:
    """(zones, state) from a US phone's area code; ((), None) when unknown."""
    digits = re.sub(r"\D", "", str(phone or ""))
    if len(digits) == 10:
        digits = "1" + digits
    if len(digits) != 11 or not digits.startswith("1"):
        return (), None
    import phonenumbers
    from phonenumbers import geocoder, timezone

    try:
        number = phonenumbers.parse("+" + digits)
    except phonenumbers.NumberParseException:
        return (), None
    zones = tuple(z for z in timezone.time_zones_for_number(number) if z.startswith(("America/", "Pacific/")))
    region = geocoder.description_for_number(number, "en") or ""
    state = _STATE_NAMES.get(region.split(",")[-1].strip().lower())
    return zones, state


def _first(record: dict, names: tuple[str, ...]) -> str | None:
    for name in names:
        value = record.get(name)
        if isinstance(value, list):
            value = next((v for v in value if v), None)
        if value and str(value).strip():
            return str(value).strip()
    return None


async def _dms_address(db: DealerScopedDatabase, customer_id: str | None) -> tuple[str | None, str | None]:
    """The newest ZIP and state on the customer's DealerVault rows."""
    if not customer_id:
        return None, None
    cid = {"$in": [customer_id, as_object_id(customer_id)]}
    zip_code = state = None
    for name in _RECORD_COLLECTIONS:
        rows = await db.collection(name).find({"customer_id": cid}).sort("_id", -1).to_list(20)
        for row in rows:
            zip_code = zip_code or _first(row, _ZIP_FIELDS)
            state = state or _first(row, _STATE_FIELDS)
        if zip_code:
            break
    return zip_code, (state or "").upper()[:2] or None


async def customer_zone(db: DealerScopedDatabase, customer_id: str | None, phone: str | None) -> CustomerZone:
    zip_code, dms_state = await _dms_address(db, customer_id)
    phone_zones, phone_state = zones_for_phone(phone)
    notes: list[str] = []

    zones: tuple[str, ...] = ()
    method = detail = ""
    state = dms_state
    if zip_code:
        zone, zip_state = zone_for_zip(zip_code)
        if zone:
            zones, method, detail, state = (zone,), "zip", f"ZIP {zip_code[:5]}", zip_state or dms_state
    if not zones and dms_state in STATE_ZONES:
        zones, method, detail = STATE_ZONES[dms_state], "state", f"state {dms_state}"
    if not zones and phone_zones:
        zones, method, detail, state = phone_zones, "area_code", f"area code of {phone}", phone_state
    if not zones:
        return CustomerZone(CONTINENTAL_ZONES, "unknown",
                            "no ZIP, state or US area code: only hours legal in every continental US zone")

    # The ZIP state and the area-code state differ: keep both (the stricter wins).
    states: tuple[str, ...] = (state,) if state else ()
    if method in ("zip", "state") and phone_state and state and phone_state != state and phone_zones:
        # MASTER_PLAN_4 F1 item 2: both states' rows apply, even when they share a time zone.
        states = (state, phone_state)
        extra = tuple(z for z in phone_zones if z not in zones)
        zones = zones + extra
        notes.append(f"area code is in {phone_state}, not {state}: both states' hours apply")
    if len(zones) > 1 and method == "state":
        notes.append(f"{state} spans {len(zones)} time zones: only hours legal in all of them")
    return CustomerZone(zones, method, detail, state, notes, states)


_STATE_NAMES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO",
    "connecticut": "CT", "delaware": "DE", "district of columbia": "DC", "washington d.c.": "DC",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN",
    "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO",
    "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH",
    "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA",
    "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY", "puerto rico": "PR",
    # geocoder often gives a two-letter code after a city ("New York, NY")
    **{code.lower(): code for code in STATE_ZONES},
}
