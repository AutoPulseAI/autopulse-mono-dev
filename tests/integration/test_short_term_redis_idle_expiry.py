"""Integration test for docs/plans/AI/PLAN_1.md Phase 0.2: 'expire a
conversation's Redis state mid-conversation by hand, send a message for it,
and confirm it resumes correctly' — one of the four §17.9 rollout tests,
built now rather than deferred to Phase 11.

Scope note: this exercises the CHECKPOINTER's own idle-expiry mechanics
directly against a real Redis (TTL gets set on save, and an expired key
genuinely has nothing to resume from) — not the full "customer message
arrives, conversation rebuilds from MongoDB" behavior, since that rebuild is
agent/graph.py's job and the graph doesn't exist until Phase 6. This test is
what Phase 6+ builds on top of, not a replacement for a later end-to-end
version of the same scenario.

Needs a real Redis reachable at REDIS_URL (defaults to the same
redis://localhost:6379/1 as .env.example) — SKIPPED automatically if one
isn't running, rather than failing, since this service's unit test suite
(tests/unit/) must stay runnable with no infrastructure at all.
"""

import os
import uuid

import pytest
from langgraph.checkpoint.base import empty_checkpoint

from upsell_agent.memory.short_term import IDLE_EXPIRY_DAYS

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/1")


async def _redis_reachable() -> bool:
    try:
        from redis.asyncio import Redis

        client = Redis.from_url(REDIS_URL, socket_connect_timeout=1)
        try:
            await client.ping()
            return True
        finally:
            await client.aclose()
    except Exception:  # noqa: BLE001 — any failure here just means "treat as unreachable, skip"
        return False


@pytest.fixture
async def skip_if_no_redis():
    if not await _redis_reachable():
        pytest.skip(f"no Redis reachable at {REDIS_URL} — this is an integration test, run with Redis up")


async def test_checkpoint_key_gets_a_ttl_matching_idle_expiry(skip_if_no_redis):
    from langgraph.checkpoint.redis import AsyncShallowRedisSaver

    thread_id = f"test-thread-{uuid.uuid4()}"
    config = {"configurable": {"thread_id": thread_id, "checkpoint_ns": ""}}

    async with AsyncShallowRedisSaver.from_conn_string(
        REDIS_URL, ttl={"default_ttl": IDLE_EXPIRY_DAYS * 24 * 60, "refresh_on_read": True}
    ) as saver:
        await saver.asetup()
        await saver.aput(config, empty_checkpoint(), {"source": "input", "step": 0}, {})

        key = saver._make_shallow_redis_checkpoint_key_cached(thread_id, "")
        ttl_seconds = await saver._redis.ttl(key)

        # A TTL was actually applied (not -1 = "no expiry"), and it's in the
        # right ballpark for a 7-day idle window (allow slack for the test's
        # own runtime, not an exact-second match).
        assert 0 < ttl_seconds <= IDLE_EXPIRY_DAYS * 24 * 60 * 60

        await saver._redis.delete(key)


async def test_an_expired_thread_has_nothing_to_resume_from(skip_if_no_redis):
    """Simulates 'expire a conversation's Redis state by hand': write a
    checkpoint, force its key to expire immediately (rather than waiting 7
    real days), and confirm the checkpointer reports nothing to resume — the
    exact condition that must make agent/graph.py fall back to rebuilding
    from MongoDB once that logic exists (Phase 6+).
    """
    from langgraph.checkpoint.redis import AsyncShallowRedisSaver

    thread_id = f"test-thread-{uuid.uuid4()}"
    config = {"configurable": {"thread_id": thread_id, "checkpoint_ns": ""}}

    async with AsyncShallowRedisSaver.from_conn_string(
        REDIS_URL, ttl={"default_ttl": IDLE_EXPIRY_DAYS * 24 * 60, "refresh_on_read": True}
    ) as saver:
        await saver.asetup()
        await saver.aput(config, empty_checkpoint(), {"source": "input", "step": 0}, {})

        key = saver._make_shallow_redis_checkpoint_key_cached(thread_id, "")
        await saver._redis.expire(key, 0)  # force immediate expiry, standing in for "7 idle days passed"

        resumed = await saver.aget(config)

        assert resumed is None
