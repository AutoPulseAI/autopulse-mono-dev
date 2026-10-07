"""Turn concurrency guards (MASTER_PLAN_1 Stage 4, architecture §12): one turn
per lead at a time, at most N per dealer, and nothing left locked after a
turn ends or a worker dies."""

import fakeredis.aioredis
import pytest

from upsell_agent.worker.locks import (
    Busy,
    dealer_inflight_key,
    dealer_slot,
    lead_lock,
    lead_lock_key,
)


@pytest.fixture
def redis():
    return fakeredis.aioredis.FakeRedis()


async def test_second_turn_for_the_same_lead_is_busy(redis):
    async with lead_lock(redis, "d1", "lead1", ttl_s=30):
        with pytest.raises(Busy):
            async with lead_lock(redis, "d1", "lead1", ttl_s=30):
                pass
        # A different lead is unaffected.
        async with lead_lock(redis, "d1", "lead2", ttl_s=30):
            pass
    # Released after the turn.
    async with lead_lock(redis, "d1", "lead1", ttl_s=30):
        pass


async def test_lock_is_released_even_when_the_turn_fails(redis):
    with pytest.raises(RuntimeError):
        async with lead_lock(redis, "d1", "lead1", ttl_s=30):
            raise RuntimeError("turn crashed")
    assert await redis.get(lead_lock_key("d1", "lead1")) is None


async def test_lock_expires_if_a_worker_dies_holding_it(redis):
    async with lead_lock(redis, "d1", "lead1", ttl_s=30):
        ttl_ms = await redis.pttl(lead_lock_key("d1", "lead1"))
    assert 0 < ttl_ms <= 30_000


async def test_a_lock_is_only_released_by_its_owner(redis):
    """If a slow turn outlives its lock and another worker takes it, the slow
    turn finishing must not release the new owner's lock."""
    async with lead_lock(redis, "d1", "lead1", ttl_s=30):
        await redis.set(lead_lock_key("d1", "lead1"), "someone-else")
    assert await redis.get(lead_lock_key("d1", "lead1")) == b"someone-else"


async def test_dealer_cap(redis):
    async with dealer_slot(redis, "d1", limit=2, ttl_s=60), dealer_slot(redis, "d1", limit=2, ttl_s=60):
        with pytest.raises(Busy):
            async with dealer_slot(redis, "d1", limit=2, ttl_s=60):
                pass
        # Another dealer has its own cap.
        async with dealer_slot(redis, "d2", limit=2, ttl_s=60):
            pass
        assert int(await redis.get(dealer_inflight_key("d1"))) == 2
    assert int(await redis.get(dealer_inflight_key("d1"))) == 0


async def test_dealer_counter_never_goes_negative(redis):
    async with dealer_slot(redis, "d1", limit=2, ttl_s=60):
        await redis.delete(dealer_inflight_key("d1"))  # expired mid-turn
    assert int(await redis.get(dealer_inflight_key("d1"))) == 0


async def test_a_refused_attempt_never_moves_the_counter(redis):
    # Burst test finding (Stage 12): the counter must equal the turns really
    # running, even while many jobs are being turned away at once.
    async with dealer_slot(redis, "d1", limit=2, ttl_s=30), dealer_slot(redis, "d1", limit=2, ttl_s=30):
        for _ in range(5):
            with pytest.raises(Busy):
                async with dealer_slot(redis, "d1", limit=2, ttl_s=30):
                    pass
            assert int(await redis.get(dealer_inflight_key("d1"))) == 2
        assert await redis.ttl(dealer_inflight_key("d1")) > 0
    assert int(await redis.get(dealer_inflight_key("d1"))) == 0


def test_busy_retries_back_off_and_last_about_48_minutes():
    from upsell_agent.config import get_settings
    from upsell_agent.worker.jobs import busy_retry_delay

    assert busy_retry_delay(0) == 2.0 and busy_retry_delay(4) == 3.0
    assert busy_retry_delay(1000) == 10.0
    total_min = sum(busy_retry_delay(i) for i in range(get_settings().busy_retry_max)) / 60
    assert 40 < total_min < 60
