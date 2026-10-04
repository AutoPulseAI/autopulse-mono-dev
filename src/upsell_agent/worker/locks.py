"""Concurrency guards for conversation turns (architecture §12).

- **Per-lead lock:** two jobs for the same lead never run at the same time,
  so replies can't race and contradict each other. Redis `SET NX PX` with a
  random token; released only by its owner (compare-and-delete in Lua), and
  expires on its own if a worker dies holding it.
- **Per-dealer cap:** at most N turns in flight per dealer, so one dealer's
  campaign burst can't starve everyone else. A counter with a safety expiry,
  so a crashed worker's slot frees itself. Check-and-take is one Lua script,
  so a refused attempt never touches the counter: it always equals the turns
  really running, and a free slot is never refused.

Both raise `Busy` instead of waiting; the worker re-queues the job a couple
of seconds later (worker/jobs.py).
"""

import asyncio
import contextlib
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import redis.asyncio as redis

logger = logging.getLogger(__name__)

# PLAN_4 stream X3 item 10: the lock is extended while its turn runs (a heartbeat every third of the TTL), so a
# slow turn never loses it mid-job and lets a second turn for the same lead start.
_EXTEND_IF_OWNER = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
"""

_RELEASE_IF_OWNER = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""


# Take a slot only if one is free. Returns the new count, or -1 when full.
_TAKE_SLOT_IF_FREE = """
local n = tonumber(redis.call('get', KEYS[1]) or '0')
if n >= tonumber(ARGV[1]) then
    return -1
end
n = redis.call('incr', KEYS[1])
redis.call('expire', KEYS[1], ARGV[2])
return n
"""


class Busy(Exception):
    """The lead is locked or the dealer is at its cap. Try again shortly."""


def lead_lock_key(dealer_id: str, lead_id: str) -> str:
    return f"lock:lead:{dealer_id}:{lead_id}"


def dealer_inflight_key(dealer_id: str) -> str:
    return f"inflight:dealer:{dealer_id}"


@asynccontextmanager
async def lead_lock(client: redis.Redis, dealer_id: str, lead_id: str, ttl_s: float) -> AsyncIterator[None]:
    key = lead_lock_key(dealer_id, lead_id)
    token = uuid.uuid4().hex
    ttl_ms = int(ttl_s * 1000)
    if not await client.set(key, token, nx=True, px=ttl_ms):
        raise Busy(f"lead {lead_id} already has a turn running")

    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(ttl_s / 3)
            try:
                if not await client.eval(_EXTEND_IF_OWNER, 1, key, token, ttl_ms):
                    logger.warning("lead lock %s was lost while its turn ran", key)
                    return
            except Exception as exc:  # noqa: BLE001 - a Redis blip must not kill the turn; the next beat retries
                logger.warning("lead lock %s heartbeat failed: %r", key, exc)

    beat = asyncio.create_task(heartbeat())
    try:
        yield
    finally:
        beat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await beat
        await client.eval(_RELEASE_IF_OWNER, 1, key, token)


@asynccontextmanager
async def dealer_slot(client: redis.Redis, dealer_id: str, limit: int, ttl_s: float) -> AsyncIterator[None]:
    key = dealer_inflight_key(dealer_id)
    # The expiry is refreshed on every acquire: the counter only survives while
    # the dealer is busy, and a slot leaked by a dead worker is gone within ttl_s.
    if int(await client.eval(_TAKE_SLOT_IF_FREE, 1, key, limit, int(ttl_s))) < 0:
        raise Busy(f"dealer {dealer_id} already has {limit} turns running")
    try:
        yield
    finally:
        # Never below zero, even if the key expired while this turn ran.
        if await client.decr(key) < 0:
            await client.set(key, 0, ex=int(ttl_s))
