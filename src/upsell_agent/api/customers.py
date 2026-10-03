"""GET /v1/customers/{customer_id}/ownership?dealer_id=... (MASTER_PLAN_4 D3, D8; stream A3).

The customer's ACTIVE / INACTIVE status, every vehicle ownership record (several per customer, dealer-sold or
CUSTOMER_REPORTED) and every opportunity with its status (SOLD-DELIVERED PDF §9-§11, §14). Shared-secret auth like
the other /v1 routes; for the CRM screens other streams build. The JSON shape is agent/ownership.customer_view
(documented in docs/plans/PLAN_4/stream_A3.md).
"""

from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from upsell_agent.agent import ownership
from upsell_agent.api.auth import require_internal_auth
from upsell_agent.integrations.mongodb import PLATFORM_CUSTOMERS_COLLECTION, as_object_id, dealer_scoped_db

router = APIRouter(prefix="/v1/customers", tags=["customers"], dependencies=[Depends(require_internal_auth)])


@router.get("/{customer_id}/ownership")
async def get_ownership(customer_id: str, dealer_id: str) -> dict[str, Any]:
    if not ObjectId.is_valid(customer_id):
        raise HTTPException(status_code=404, detail="Customer not found for this dealer")
    customer = await dealer_scoped_db(dealer_id).collection(PLATFORM_CUSTOMERS_COLLECTION).find_one(
        {"_id": as_object_id(customer_id)})
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found for this dealer")
    return await ownership.customer_view(dealer_id, customer_id)
