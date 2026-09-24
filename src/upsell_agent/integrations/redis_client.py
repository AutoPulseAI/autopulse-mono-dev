"""Async Redis connection — points at the same Redis instance aidmvcs-be-dev's
BullMQ queues run on (settings.redis_url), but a DEDICATED logical DB index
(see .env.example: REDIS_URL=redis://localhost:6379/1, vs the core app's
default /0) so the LangGraph checkpointer's keyspace can never collide with
or be accidentally flushed alongside the existing BullMQ queues.
"""

import redis.asyncio as redis

from upsell_agent.config import Settings

_client: redis.Redis | None = None


async def init_redis(settings: Settings) -> None:
    global _client
    _client = redis.from_url(settings.redis_url, decode_responses=True)


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()


def get_redis() -> redis.Redis:
    if _client is None:
        raise RuntimeError("Redis not initialized — call init_redis() during app startup")
    return _client
