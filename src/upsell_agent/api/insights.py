"""The AI Learning & Optimization report (PLAN_4 stream L item 4; blueprint box 5).

  GET /v1/insights/engagement?dealer_id=...&days=30
        response rate (24h / 72h), meaningful replies, appointment rate, shows and
        opt-outs - overall and by touch kind, bucket (current and original), lead
        source, new/used (current and original), angle, wording variant, send time,
        time of day, weekday and channels; each test's current leader with its
        sample sizes; the dealer's verified price drops; how the learning works.

Shared-secret auth like the other /v1 routes; dealer-scoped. The CRM's AI Insights
page reads it through app/api/dealer-ai/insights (aidmvcs-be-dev).
"""

from typing import Any

from fastapi import APIRouter, Depends, Query

from upsell_agent.api.auth import require_internal_auth
from upsell_agent.integrations.mongodb import dealer_scoped_db
from upsell_agent.learning import insights

router = APIRouter(prefix="/v1/insights", tags=["insights"], dependencies=[Depends(require_internal_auth)])


@router.get("/engagement")
async def engagement(dealer_id: str = Query(..., min_length=1),
                     days: int = Query(30, ge=1, le=365)) -> dict[str, Any]:
    return await insights.engagement(dealer_scoped_db(dealer_id), days=days)
