"""Vehicle inventory lookup — for trade-up recommendations.

Calls the existing `/api/car` endpoint (the same one the Pulse chat engine
uses, see docs/architecture/architecture.md §5.10) via
integrations/autopulse_api_client.py, rather than re-querying Vehicle
documents directly — one source of truth for "what's actually in stock."

TODO: implement search_inventory(dealer_id, filters: dict) -> list[dict]
Return the RAW api response rows (not reshaped) so verify_grounding.py can
trace a recommendation's source_id straight back to a real VIN in this result.
"""


async def search_inventory(dealer_id: str, filters: dict) -> list[dict]:
    raise NotImplementedError("search_inventory: call AUTOPULSE_API_BASE_URL + '/api/car'")
