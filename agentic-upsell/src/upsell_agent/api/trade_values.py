"""Trade-in values for the CRM (agent/trade_values.py), asked by the CRM only for a dealer whose super admin chose
"AutoPulse value" (Betsy, 19 Nov 2026).

  POST /v1/trade-values/estimate  {dealer_id, mileage, state, vin? | year + make + model}
       200 {status: "ok", values: {year, make, model, trims: [{trim, by_condition: {Clean: {trade_in, ...}}}]}, ...}
       200 {status: "no_record"} · 422 bad input · 503 Vehicle Databases off · 502 Vehicle Databases failed

Shared-secret auth like the other /v1 routes. No customer is messaged.
"""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from upsell_agent.agent import trade_values
from upsell_agent.api.auth import require_internal_auth
from upsell_agent.integrations.vehicle_databases import VehicleDatabasesError

router = APIRouter(prefix="/v1/trade-values", tags=["trade-values"], dependencies=[Depends(require_internal_auth)])


class EstimateRequest(BaseModel):
    dealer_id: str
    mileage: int = Field(ge=0, le=1_000_000)
    state: str
    vin: str | None = None
    year: int | None = Field(default=None, ge=1981, le=2100)
    make: str | None = None
    model: str | None = None


def _json(value: Any) -> Any:
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=UTC)).isoformat()
    if isinstance(value, dict):
        return {k: _json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json(v) for v in value]
    return value


@router.post("/estimate")
async def estimate(body: EstimateRequest) -> dict[str, Any]:
    try:
        result = await trade_values.estimate(mileage=body.mileage, state=body.state, vin=body.vin, year=body.year,
                                             make=body.make, model=body.model)
    except VehicleDatabasesError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if result["status"] == "invalid":
        raise HTTPException(status_code=422, detail=result["reason"])
    if result["status"] == "off":
        raise HTTPException(status_code=503, detail=result["reason"])
    return _json(result)
