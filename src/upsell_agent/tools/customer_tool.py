"""Customer 360 lookup tool.

Reads the SAME collections aidmvcs-be-dev's /api/customers/[id]/360 assembles
from (see docs/architecture/architecture.md §5.9): Customer, Lead, Deal,
RepairOrder, TradeIn. Calls that existing endpoint (via
integrations/autopulse_api_client.py) rather than re-implementing its join
logic (already known to be loose/string-based, see architecture.md §9) a
second time in a different language.

TODO: the mapping below from the 360 endpoint's actual response shape to
CustomerContext is a first draft, not verified against a real response —
confirm field names against assemble.js's actual output shape before relying
on this in agent/nodes/retrieve_context.py.
"""

from upsell_agent.agent.state import CustomerContext
from upsell_agent.integrations.autopulse_api_client import AutoPulseApiClient


async def get_customer_context(
    client: AutoPulseApiClient, dealer_id: str, customer_id: str
) -> CustomerContext:
    raw = await client.get_customer_360(dealer_id, customer_id)

    return CustomerContext(
        customer_id=customer_id,
        name=raw.get("customer", {}).get("name"),
        owned_vehicles=raw.get("vehicles", []),
        last_service_visit=(raw.get("repairOrders") or [None])[0],
        open_leads=raw.get("leads", []),
        # upsell_history is OUR OWN long-term memory (memory/long_term.py),
        # not part of the 360 response — populated separately in
        # agent/nodes/retrieve_context.py, not here.
    )
