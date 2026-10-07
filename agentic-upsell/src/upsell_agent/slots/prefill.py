"""Fills slots from the platform's Customer 360 before the AI asks anything
(architecture §7 Load context, MASTER_PLAN_1 Stage 7).

Only facts the platform actually has become slots, marked `tool_verified`:
the customer's primary vehicle, when and where they bought it, their last
service visit and next appointment, their most recent open trade-in, and
their preferred channel. A slot the customer already told us about is never
overwritten by a platform record.
"""

from datetime import UTC, datetime
from typing import Any

from upsell_agent import clock
from upsell_agent.agent.qualification import FactSource
from upsell_agent.integrations.mongodb import DealerScopedDatabase
from upsell_agent.slots.schema import SCHEMA
from upsell_agent.slots.store import current_facts, save_fact
from upsell_agent.slots.validators import validate


def _when(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def facts_from_360(data: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """Slot path -> raw value, from one Customer 360 `data` object."""
    now = now or clock.now()
    found: dict[str, Any] = {}

    vehicles = data.get("vehicles") or []
    primary = next((v for v in vehicles if v.get("is_current_owner")), vehicles[0] if vehicles else None)
    if primary:
        for field in ("year", "make", "model"):
            if primary.get(field) is not None:
                found[f"vehicle.{field}"] = primary[field]
        deal = next((d for d in data.get("deals") or [] if d.get("vin") == primary.get("vin")), None)
        if deal and _when(deal.get("computed_date")):
            found["vehicle.purchase_date"] = _when(deal["computed_date"]).date().isoformat()
            found["vehicle.purchased_from"] = "this dealership"

    visits = [(_when(r.get("computed_date")), r) for r in data.get("repair_orders") or []]
    past_visits = [at for at, _ in visits if at and at <= now]
    if past_visits:
        found["service.last_visit"] = max(past_visits).date().isoformat()

    upcoming = [at for at in (_when(a.get("computed_date")) for a in data.get("appointments") or []) if at and at > now]
    if upcoming:
        found["appointment.next_date"] = min(upcoming).date().isoformat()

    trade = next((t for t in data.get("trade_ins") or [] if t.get("status", "open") == "open"), None)
    if trade:
        for field, path in (("year", "trade_in.year"), ("make", "trade_in.make"), ("model", "trade_in.model"),
                            ("miles", "trade_in.mileage"), ("condition", "trade_in.condition")):
            if trade.get(field) is not None:
                found[path] = trade[field]

    channel = ((data.get("customer") or {}).get("preferred_communication_mode") or "").lower()
    if channel in ("sms", "email"):
        found["contact.preferred_channel"] = channel
    return found


async def prefill_from_360(db: DealerScopedDatabase, *, customer_id: str, lead_id: str | None,
                           data: dict[str, Any] | None, turn_id: str | None = None) -> list[dict[str, Any]]:
    """Saves the 360 facts that aren't already known. Returns what was added."""
    if not data:
        return []
    known = {f["path"] for f in await current_facts(db, customer_id, lead_id)}
    added = []
    for path, raw in facts_from_360(data).items():
        if path in known:
            continue
        checked = validate(SCHEMA[path], raw)
        if not checked.ok:
            continue  # platform data that doesn't fit the slot is left out, not guessed at
        await save_fact(db, customer_id=customer_id, lead_id=lead_id, path=path, value=checked.value,
                        source=FactSource.TOOL_VERIFIED, turn_id=turn_id)
        added.append({"path": path, "value": checked.value})
    return added
