"""Client, 8 Oct 2026: the multi-agent setup - the router picks the expert for what the customer is talking about."""

import pytest

from upsell_agent.agent import specialists


@pytest.mark.parametrize(("text", "lead_type", "bucket", "expected"), [
    ("What would my monthly payment be?", "sales", None, "price_payment"),
    ("How much is the RAV4 out the door?", "sales", None, "price_payment"),
    ("I have bad credit, can I still get approved?", "sales", None, "credit"),
    ("What's my car worth if I trade it in?", "sales", None, "trade"),
    ("I need an oil change", "service", None, "service"),
    ("Is there a recall on my truck?", "sales", None, "service"),
    ("Does it have new tires?", "sales", None, "sales"),
    ("Does it have heated seats?", "sales", None, "sales"),
    ("Hi", "sales", "credit", "credit"),
    ("Hi", "sales", "trade_in", "trade"),
    ("Hi", "service", None, "service"),
])
def test_router(text, lead_type, bucket, expected):
    assert specialists.route(text, lead_type=lead_type, bucket=bucket)[0].id == expected


def test_every_specialist_has_hard_limits_and_aims_at_the_visit():
    for s in specialists.SPECIALISTS.values():
        assert s.never.startswith("Never")
    assert "approved" in specialists.SPECIALISTS["credit"].never
    assert "trade value" in specialists.SPECIALISTS["trade"].never
    assert "monthly payment" in specialists.SPECIALISTS["price_payment"].never
