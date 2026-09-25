"""Everything this service needs from aidmvcs-be-dev, behind one interface.

- `stub`: builds Customer 360 from the platform's own collections in the
  local database (integrations/customer360.py, a port of the route) and
  records sent messages in dev_platform_messages. Lets the AI work run
  without the Next.js app.
- `live`: calls the real platform over HTTP with the shared secret.

Both implement the same contract, so switching PLATFORM_CLIENT is a config
change only. `python -m upsell_agent.devtools.compare_360` checks that stub
and live return the same Customer 360 for the seeded customers.

get_customer_360 returns the route's `data` object - customer,
value_snapshot, overview, leads, deals, repair_orders, appointments,
all_appointments, vehicles, trade_ins - or None when the customer doesn't
exist for that dealer.

Record-message contract (the platform side is
aidmvcs-be-dev/app/api/internal/ai/messages/route.js, BPLAN Phase 3):

    POST /api/internal/ai/messages
    {dealer_id, lead_id, customer_id, channel: "sms"|"email", to, text,
     subject, status: "sent"|"failed", provider_id, idempotency_key,
     turn_id, is_fallback, sent_at}
    → 200 {"id": "<Email _id>", "created": true|false}

It is idempotent on `idempotency_key`: recording the same send twice returns
the same Email record.
"""

from typing import Any, Protocol

import httpx

from upsell_agent import clock
from upsell_agent.config import Settings
from upsell_agent.integrations.customer360 import EMPTY_360, build_customer_360
from upsell_agent.integrations.mongodb import dealer_scoped_db

DEV_PLATFORM_MESSAGES_COLLECTION = "dev_platform_messages"
__all__ = ["EMPTY_360", "LivePlatformClient", "PlatformClient", "PlatformError", "StubPlatformClient",
           "get_platform_client"]

RECORD_TIMEOUT_S = 5.0


class PlatformError(RuntimeError):
    """The platform answered, but not with success."""


class PlatformClient(Protocol):
    async def get_customer_360(self, dealer_id: str, customer_id: str) -> dict[str, Any] | None: ...

    async def record_message(self, dealer_id: str, message: dict[str, Any]) -> str: ...

    async def update_message_status(self, dealer_id: str, provider_id: str, status: str) -> bool: ...


class StubPlatformClient:
    async def get_customer_360(self, dealer_id: str, customer_id: str) -> dict[str, Any] | None:
        return await build_customer_360(dealer_id, customer_id)

    async def record_message(self, dealer_id: str, message: dict[str, Any]) -> str:
        messages = dealer_scoped_db(dealer_id).collection(DEV_PLATFORM_MESSAGES_COLLECTION)
        await messages.update_one(
            {"idempotency_key": message["idempotency_key"]},
            {"$setOnInsert": {**message, "recorded_at": clock.now()}},
            upsert=True,
        )
        doc = await messages.find_one({"idempotency_key": message["idempotency_key"]})
        return str(doc["_id"])

    async def update_message_status(self, dealer_id: str, provider_id: str, status: str) -> bool:
        result = await dealer_scoped_db(dealer_id).collection(DEV_PLATFORM_MESSAGES_COLLECTION).update_one(
            {"provider_id": provider_id}, {"$set": {"delivery_status": status, "status_at": clock.now()}}
        )
        return result.matched_count > 0


class LivePlatformClient:
    def __init__(self, settings: Settings):
        self._base_url = settings.autopulse_api_base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {settings.upsell_service_shared_secret}"}

    async def get_customer_360(self, dealer_id: str, customer_id: str) -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=RECORD_TIMEOUT_S) as client:
            response = await client.get(f"{self._base_url}/api/customers/{customer_id}/360",
                                        params={"dealer_id": dealer_id}, headers=self._headers)
        if response.status_code in (400, 404):
            return None
        if response.status_code >= 400:
            raise PlatformError(f"GET customer 360 → {response.status_code}: {response.text[:300]}")
        return response.json().get("data")

    async def record_message(self, dealer_id: str, message: dict[str, Any]) -> str:
        body = await self._post("/api/internal/ai/messages", {**message, "dealer_id": dealer_id})
        return str(body["id"])

    async def update_message_status(self, dealer_id: str, provider_id: str, status: str) -> bool:
        body = await self._post(
            "/api/internal/ai/messages/status",
            {"dealer_id": dealer_id, "provider_id": provider_id, "status": status},
        )
        return bool(body.get("updated"))

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=RECORD_TIMEOUT_S) as client:
            response = await client.post(f"{self._base_url}{path}", json=payload, headers=self._headers)
        if response.status_code >= 400:
            raise PlatformError(f"POST {path} → {response.status_code}: {response.text[:300]}")
        return response.json()


def get_platform_client(settings: Settings) -> PlatformClient:
    if settings.platform_client == "stub":
        return StubPlatformClient()
    return LivePlatformClient(settings)
