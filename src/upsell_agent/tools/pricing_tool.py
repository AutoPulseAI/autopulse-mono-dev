"""Pricing / promotions / finance offer lookup.

TODO: this depends on a product decision not yet made — does AutoPulse have
a real pricing/promotions data source today (dealer-entered offers, a DMS
feed, a finance-partner API), or does this need to be built as new backend
state first? There is currently no `Package`/`Promotion`-type model for
finance offers in aidmvcs-be-dev/app/models (see docs/architecture/architecture.md
§4.3) — `Package` there is the AutoPulse *subscription* plan, not a dealer
product/finance offer. This is a real gap to close before `recommend.py` can
ground a warranty/finance recommendation in anything real.

Until that data source exists, this tool must return an empty result rather
than a plausible-looking placeholder — a stub that looks real is exactly what
verify_grounding.py exists to catch, but it's cheaper to just not build the
trap in the first place.
"""


async def get_pricing_offers(dealer_id: str, item_type: str, context: dict) -> list[dict]:
    raise NotImplementedError(
        "get_pricing_offers: no pricing/promotions/finance data source exists yet in the "
        "platform — resolve this as a product/data question before implementing"
    )
