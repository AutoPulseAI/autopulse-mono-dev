"""GET /v1/metrics?dealer_id=...&days=7 — the numbers to watch for one dealer
(observability/metrics.py), and GET /v1/rollout-check — the go-live checks
(observability/rollout.py: no double messages, no lost replies, numbers within
limits). Shared-secret auth, like every /v1 route; the platform's admin reads
them while rolling a dealer out (MASTER_PLAN_1 Stages 12-13)."""

from typing import Any

from fastapi import APIRouter, Depends, Query

from upsell_agent.api.auth import require_internal_auth
from upsell_agent.observability.metrics import dealer_metrics
from upsell_agent.observability.rollout import rollout_check

router = APIRouter(prefix="/v1", tags=["metrics"], dependencies=[Depends(require_internal_auth)])


@router.get("/metrics")
async def metrics(dealer_id: str = Query(min_length=1), days: float = Query(7, gt=0, le=90)) -> dict[str, Any]:
    return await dealer_metrics(dealer_id, days)


@router.get("/rollout-check")
async def rollout(dealer_id: str = Query(min_length=1), days: float = Query(7, gt=0, le=90)) -> dict[str, Any]:
    return await rollout_check(dealer_id, days)
