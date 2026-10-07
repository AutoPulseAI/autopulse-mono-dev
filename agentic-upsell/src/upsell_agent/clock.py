"""The one clock every "now" in this service comes from.

In production it is plain UTC time. In DEV the Debug UI can move it forward
(Scheduler tab: "advance 24h") so the 24-hour channel switch can be tested
without waiting a day. The offset lives in Redis so the API process (which
moves it) and every worker process (which reads it) agree.

Workers call `sync()` before each job; the dev routes call `advance()` /
`reset()`. Nothing else should call `datetime.now()` for business logic.
"""

from datetime import UTC, datetime, timedelta

import redis.asyncio as redis

DEV_CLOCK_KEY = "dev:clock:offset_s"

_offset_s: float = 0.0


def now() -> datetime:
    return datetime.now(UTC) + timedelta(seconds=_offset_s)


def offset_s() -> float:
    return _offset_s


def set_offset(seconds: float) -> None:
    """Directly set the offset. For tests and for applying a value just read from Redis."""
    global _offset_s
    _offset_s = float(seconds)


async def sync(client: redis.Redis) -> None:
    raw = await client.get(DEV_CLOCK_KEY)
    set_offset(float(raw) if raw else 0.0)


async def advance(client: redis.Redis, seconds: float) -> float:
    new_offset = await client.incrbyfloat(DEV_CLOCK_KEY, seconds)
    set_offset(new_offset)
    return float(new_offset)


async def reset(client: redis.Redis) -> None:
    await client.delete(DEV_CLOCK_KEY)
    set_offset(0.0)
