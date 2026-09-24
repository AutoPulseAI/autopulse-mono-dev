"""Tests for memory/short_term.py's idle-expiry configuration
(docs/plans/AI/PLAN_1.md Phase 0.2, docs/architecture/architecture.md §17.3).

Constructs AsyncShallowRedisSaver directly with a dummy redis_client (rather
than through checkpointer_context()'s from_conn_string(), which needs a real
Redis connection to enter) so the TTL wiring can be verified without live
infrastructure — this mirrors how the real object is built, just swapping the
network client for a stand-in that's never actually called.
"""

from langgraph.checkpoint.redis import AsyncShallowRedisSaver

from upsell_agent.memory.short_term import IDLE_EXPIRY_DAYS, thread_id_for


class _UnusedRedisClient:
    """Never called — just needs to be a non-None object so the saver's
    constructor accepts it as the connection argument."""


def test_idle_expiry_is_seven_days():
    assert IDLE_EXPIRY_DAYS == 7


def test_checkpointer_ttl_config_matches_idle_expiry_and_refreshes_on_read():
    saver = AsyncShallowRedisSaver(
        redis_client=_UnusedRedisClient(),
        ttl={"default_ttl": IDLE_EXPIRY_DAYS * 24 * 60, "refresh_on_read": True},
    )

    assert saver.ttl_config == {"default_ttl": 7 * 24 * 60, "refresh_on_read": True}


def test_thread_id_scoped_by_lead_when_lead_id_present():
    assert thread_id_for("dealer_a", "lead_1", "cust_1") == "dealer_a:lead_1"


def test_thread_id_falls_back_to_customer_id_when_no_lead_id():
    assert thread_id_for("dealer_a", None, "cust_1") == "dealer_a:cust_1"


def test_thread_ids_for_different_dealers_never_collide_even_with_same_lead_id():
    """Same lead_id value under two different dealers must produce different
    thread_ids — otherwise one dealer's conversation state could be read or
    resumed under another dealer's request, which is exactly the isolation
    failure §17.7 (and Phase 0.1's DealerScopedCollection) exists to prevent,
    just on the Redis side instead of Mongo.
    """
    assert thread_id_for("dealer_a", "lead_1", "cust_1") != thread_id_for("dealer_b", "lead_1", "cust_1")
