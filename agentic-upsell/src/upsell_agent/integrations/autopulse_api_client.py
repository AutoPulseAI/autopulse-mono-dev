"""Client for calling the EXISTING aidmvcs-be-dev Next.js API, so this service
reuses proven logic (Customer 360 assembly, inventory search) instead of
re-implementing it in Python — see tools/customer_tool.py and
tools/inventory_tool.py for why.

Auth: sends the same UPSELL_SERVICE_SHARED_SECRET this service itself
requires on incoming calls (see api/auth.py) as a Bearer token.
aidmvcs-be-dev/app/api/customers/[id]/360/route.js accepts that token as an
alternate to a human dealer session — see
aidmvcs-be-dev/app/lib/internalServiceAuth.js and ../../../INTEGRATION.md for
the full chain and why the dealer_id passed here doesn't need to be
re-authorized a second time (it was already checked against a real dealer
session one hop earlier, by whatever called THIS service's /upsell/recommend).

/api/car (inventory) is a SEPARATE, pre-existing situation: it currently has
no auth check at all for any caller (see docs/architecture/architecture.md's
"Known caveats" — this predates this service and isn't fixed by it). Retrofitting
auth onto a route another live integration (Pulse) already depends on needs its
own sign-off, not a silent change bundled into this client. search_inventory()
below calls it as-is, unauthenticated, matching its current real behavior.
"""

import httpx

from upsell_agent.config import Settings


class AutoPulseApiClient:
    def __init__(self, settings: Settings):
        self._base_url = settings.autopulse_api_base_url
        self._shared_secret = settings.upsell_service_shared_secret

    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._shared_secret}"}

    async def get_customer_360(self, dealer_id: str, customer_id: str) -> dict:
        url = f"{self._base_url}/api/customers/{customer_id}/360"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                url,
                params={"dealer_id": dealer_id},
                headers=self._auth_headers(),
            )
        response.raise_for_status()
        return response.json()

    async def search_inventory(self, dealer_source: str, filters: dict) -> dict:
        # TODO: /api/car has no auth today (see module docstring) — called
        # as-is, matching its current real behavior, not a gap this client
        # introduces.
        url = f"{self._base_url}/api/car"
        params = {"source": dealer_source, **filters}
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()
