"""Upsell routes — NOT registered in main.py. Upselling is out of scope
(architecture PURPOSE.md); the file is kept for when it comes back.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends

from upsell_agent.api.auth import require_internal_auth
from upsell_agent.api.schemas import (
    UpsellFeedbackRequest,
    UpsellRecommendationRequest,
    UpsellRecommendationResponse,
)
from upsell_agent.memory import long_term

router = APIRouter(prefix="/upsell", tags=["upsell"])


@router.post(
    "/recommend",
    response_model=UpsellRecommendationResponse,
    dependencies=[Depends(require_internal_auth)],
)
async def recommend(request: UpsellRecommendationRequest) -> UpsellRecommendationResponse:
    """Run the agent graph for this customer and return grounded recommendations.

    TODO: replace this stub with `agent.graph.run(request)` once the graph is built.
    Until then this returns an empty, clearly-a-stub response rather than fabricating
    example data — a stub that *looks* like a real recommendation is exactly the kind
    of thing that gets accidentally shipped.
    """
    return UpsellRecommendationResponse(
        customer_id=request.customer_id,
        dealer_id=request.dealer_id,
        recommendations=[],
        suppressed_reason="not_implemented: agent graph is not wired up yet",
        generated_at=datetime.now(UTC),
    )


@router.post("/feedback", dependencies=[Depends(require_internal_auth)])
async def feedback(request: UpsellFeedbackRequest) -> dict:
    """Staff decision on a recommendation — feeds memory/long_term.py so the agent
    stops re-suggesting things this customer has already declined twice, etc.
    """
    profile = await long_term.record_feedback(
        dealer_id=request.dealer_id,
        customer_id=request.customer_id,
        source_id=request.recommendation_source_id,
        item_type=request.item_type.value,
        decision=request.decision,
        trigger=request.trigger,
        staff_note=request.staff_note,
    )
    return {
        "status": "ok",
        "suppressed_item_types": {k: v.isoformat() for k, v in profile.suppressed_item_types.items()},
    }


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}
