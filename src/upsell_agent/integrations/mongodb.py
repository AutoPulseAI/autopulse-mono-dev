"""Async MongoDB connection — points at the SAME database aidmvcs-be-dev uses
(settings.mongodb_uri). This service reads the existing collections (Customer,
Lead, Vehicle, ...) read-only in most cases, and owns a small set of its own
collections: `upsell_profile`, `upsell_recommendation_log`.

Using Motor (async) rather than Mongoose-equivalent, since this is a separate
Python process — there is no code-sharing possible with aidmvcs-be-dev's
Mongoose models across the language boundary, so schema shape is kept in sync
by convention + docs/architecture/architecture.md §4.3, not by shared code.
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from upsell_agent.config import Settings

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


async def init_mongo(settings: Settings) -> None:
    global _client, _db
    _client = AsyncIOMotorClient(settings.mongodb_uri)
    _db = _client.get_default_database()


async def close_mongo() -> None:
    global _client
    if _client is not None:
        _client.close()


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("Mongo not initialized — call init_mongo() during app startup")
    return _db
