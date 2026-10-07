"""A vehicle's safety recalls and maintenance status (MASTER_PLAN_4 D5/D6, stream A4), for the CRM screens.

  GET  /v1/vehicles/{vin}/service-status?dealer_id=...         recalls + maintenance + recent events
  GET  /v1/vehicles/{vin}/recalls?dealer_id=...                 the recalls only
  GET  /v1/vehicles/{vin}/maintenance?dealer_id=...             the maintenance status only
  POST /v1/vehicles/{vin}/recalls/{recall_id}/confirm           staff checked the VIN: {dealer_id, by?, note?}
  POST /v1/vehicles/{vin}/recalls/{recall_id}/close             {dealer_id, reason: completed|not_applicable, ...}
  POST /v1/vehicles/{vin}/mileage                               verified reading: {dealer_id, miles, observed_at?, by?}
  POST /v1/vehicles/{vin}/service                               service done: {dealer_id, at?, miles?, outside?, ...}

Shared-secret auth like the other /v1 routes. JSON shapes: docs/plans/PLAN_4/stream_A4.md.
"""

from datetime import UTC, datetime
from typing import Any, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from upsell_agent.agent import maintenance, recalls
from upsell_agent.api.auth import require_internal_auth
from upsell_agent.integrations.mongodb import (
    AI_SERVICE_EVENTS_COLLECTION,
    AI_SERVICE_VEHICLES_COLLECTION,
    AI_VEHICLE_RECALLS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.nhtsa import normalize_vin

router = APIRouter(prefix="/v1/vehicles", tags=["service-vehicles"], dependencies=[Depends(require_internal_auth)])


def _json(value: Any) -> Any:
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=UTC)).isoformat()
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: _json(v) for k, v in value.items() if k not in ("_id", "dealer_id")}
    if isinstance(value, list):
        return [_json(v) for v in value]
    return value


def _vin(vin: str) -> str:
    found = normalize_vin(vin)
    if not found:
        raise HTTPException(status_code=422, detail="not a 17-character VIN")
    return found


def recall_view(row: dict[str, Any]) -> dict[str, Any]:
    keys = ("recall_id", "description", "component", "consequence", "remedy", "manufacturer", "report_received_at",
            "detected_at", "status", "match_level", "source", "last_checked_at", "vin_confirmation", "outreach",
            "closed_at", "closed_reason", "closed_source")
    out = {k: row.get(k) for k in keys}
    out["customer_outreach_allowed"] = row.get("status") == recalls.OPEN and row.get("match_level") == recalls.MATCH_VIN
    return _json(out)


async def _vehicle(dealer_id: str, vin: str) -> dict[str, Any]:
    vehicle = await dealer_scoped_db(dealer_id).collection(AI_SERVICE_VEHICLES_COLLECTION).find_one({"vin": vin})
    if vehicle is None:
        raise HTTPException(status_code=404, detail="this vehicle isn't watched (not a SOLD - DELIVERED vehicle)")
    return vehicle


def vehicle_view(vehicle: dict[str, Any]) -> dict[str, Any]:
    return _json({k: vehicle.get(k) for k in ("vin", "year", "make", "model", "customer_id", "lead_id",
                                              "ownership_status", "delivered_at", "recall_check",
                                              "recalls_next_check_at")})


def maintenance_view(vehicle: dict[str, Any]) -> dict[str, Any]:
    schedule = vehicle.get("maintenance_schedule") or {}
    return _json({"status": vehicle.get("maintenance") or {"status": "not_calculated"},
                  "schedule_source": schedule.get("source"), "schedule_fetched_at": schedule.get("fetched_at"),
                  "schedule": schedule.get("schedule")})


@router.get("/{vin}/recalls")
async def list_recalls(vin: str, dealer_id: str = Query(...)) -> list[dict[str, Any]]:
    rows = await dealer_scoped_db(dealer_id).collection(AI_VEHICLE_RECALLS_COLLECTION).find(
        {"vin": _vin(vin)}).sort("detected_at", -1).to_list(500)
    return [recall_view(r) for r in rows]


@router.get("/{vin}/maintenance")
async def get_maintenance(vin: str, dealer_id: str = Query(...)) -> dict[str, Any]:
    return maintenance_view(await _vehicle(dealer_id, _vin(vin)))


@router.get("/{vin}/service-status")
async def service_status(vin: str, dealer_id: str = Query(...)) -> dict[str, Any]:
    vin = _vin(vin)
    db = dealer_scoped_db(dealer_id)
    vehicle = await _vehicle(dealer_id, vin)
    rows = await db.collection(AI_VEHICLE_RECALLS_COLLECTION).find({"vin": vin}).sort("detected_at", -1).to_list(500)
    events = await db.collection(AI_SERVICE_EVENTS_COLLECTION).find({"vin": vin}).sort("created_at", -1).to_list(50)
    return {"vehicle": vehicle_view(vehicle), "recalls": [recall_view(r) for r in rows],
            "maintenance": maintenance_view(vehicle),
            "events": [{**_json(e), "id": str(e["_id"])} for e in events]}


class StaffNote(BaseModel):
    dealer_id: str
    by: str | None = None
    note: str | None = None


class RecallClose(StaffNote):
    reason: Literal["completed", "not_applicable"]


class MileageReport(BaseModel):
    dealer_id: str
    miles: int = Field(gt=0, lt=1_000_000)
    observed_at: datetime | None = None
    by: str | None = None


class ServiceReport(BaseModel):
    dealer_id: str
    at: datetime | None = None
    miles: int | None = Field(default=None, gt=0, lt=1_000_000)
    outside: bool = False
    by: str | None = None
    note: str | None = None


@router.post("/{vin}/recalls/{recall_id}/confirm")
async def confirm_recall(vin: str, recall_id: str, body: StaffNote) -> dict[str, Any]:
    row = await recalls.confirm(body.dealer_id, _vin(vin), recall_id.upper(), by=body.by, note=body.note)
    if row is None:
        raise HTTPException(status_code=404, detail="no such recall for this vehicle")
    return recall_view(row)


@router.post("/{vin}/recalls/{recall_id}/close")
async def close_recall(vin: str, recall_id: str, body: RecallClose) -> dict[str, Any]:
    row = await recalls.close(body.dealer_id, _vin(vin), recall_id.upper(), reason=body.reason, by=body.by,
                              note=body.note)
    if row is None:
        raise HTTPException(status_code=404, detail="no such recall for this vehicle")
    return recall_view(row)


@router.post("/{vin}/mileage")
async def report_mileage(vin: str, body: MileageReport) -> dict[str, Any]:
    vin = _vin(vin)
    if await maintenance.record_mileage(body.dealer_id, vin, miles=body.miles, observed_at=body.observed_at,
                                        by=body.by) is None:
        raise HTTPException(status_code=404, detail="this vehicle isn't watched")
    return maintenance_view(await _vehicle(body.dealer_id, vin))


@router.post("/{vin}/service")
async def report_service(vin: str, body: ServiceReport) -> dict[str, Any]:
    vin = _vin(vin)
    if await maintenance.record_service(body.dealer_id, vin, at=body.at, miles=body.miles, outside=body.outside,
                                        by=body.by, note=body.note) is None:
        raise HTTPException(status_code=404, detail="this vehicle isn't watched")
    return maintenance_view(await _vehicle(body.dealer_id, vin))
