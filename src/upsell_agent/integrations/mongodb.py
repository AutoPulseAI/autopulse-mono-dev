"""Async MongoDB connection — points at the SAME database aidmvcs-be-dev uses
(settings.mongodb_uri). This service reads the existing collections (Customer,
Lead, Vehicle, ...) read-only in most cases, and owns a small set of its own
collections: `upsell_profile`, `upsell_recommendation_log`, and (from
docs/plans/AI/PLAN_1.md Phase 1 onward) the qualification-conversation memory
collections.

Using Motor (async) rather than Mongoose-equivalent, since this is a separate
Python process — there is no code-sharing possible with aidmvcs-be-dev's
Mongoose models across the language boundary, so schema shape is kept in sync
by convention + docs/architecture/architecture.md §4.3, not by shared code.
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorDatabase

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
    """Raw, unscoped database handle. Only for genuinely cross-dealer
    operations (index creation, admin scripts) and the pre-existing
    single-dealer-caller-supplies-its-own-filter code in memory/long_term.py
    predating this module (docs/plans/AI/PLAN_1.md Phase 0.1). Every NEW
    per-customer or per-conversation read/write should go through
    dealer_scoped_db() instead — see its docstring for why.
    """
    if _db is None:
        raise RuntimeError("Mongo not initialized — call init_mongo() during app startup")
    return _db


class CrossDealerAccessError(RuntimeError):
    """Raised when code tries to read or write a document whose own
    dealer_id doesn't match the dealer this access was scoped to. This fails
    LOUDLY and refuses the call rather than silently rewriting the filter —
    per docs/architecture/architecture.md §17.7, a database call that forgets
    (or gets tricked into ignoring) dealer_id is a data breach, not a bug, and
    a silent override could mask exactly that kind of bug instead of catching
    it.
    """


class DealerScopedCollection:
    """Wraps one Motor collection so every read/write is forced to filter (on
    reads) or stamp (on writes) dealer_id. This is the single enforcement
    point docs/plans/AI/PLAN_1.md Phase 0.1 calls for: "a single module that
    every other piece of code goes through to read or write Mongo... It
    REQUIRES a dealer ID on every call and adds the filter itself, so no
    individual query can forget it."

    Deliberately narrow: only the handful of operations this service actually
    needs (find_one, find, insert_one, update_one, count_documents). Add more
    as needed rather than exposing the raw collection — the moment code can
    reach the raw collection, this guarantee is gone.
    """

    def __init__(self, collection: AsyncIOMotorCollection, dealer_id: str) -> None:
        if not dealer_id:
            raise ValueError("dealer_id is required to scope a collection access")
        self._collection = collection
        self._dealer_id = dealer_id

    def _scoped_filter(self, flt: dict | None) -> dict:
        flt = dict(flt or {})
        existing = flt.get("dealer_id")
        if existing is not None and existing != self._dealer_id:
            raise CrossDealerAccessError(
                f"query requested dealer_id={existing!r} but this access is scoped to "
                f"{self._dealer_id!r}"
            )
        flt["dealer_id"] = self._dealer_id
        return flt

    def _scoped_document(self, doc: dict) -> dict:
        doc = dict(doc)
        existing = doc.get("dealer_id")
        if existing is not None and existing != self._dealer_id:
            raise CrossDealerAccessError(
                f"document has dealer_id={existing!r} but this access is scoped to "
                f"{self._dealer_id!r}"
            )
        doc["dealer_id"] = self._dealer_id
        return doc

    async def find_one(self, filter: dict | None = None, **kwargs):
        return await self._collection.find_one(self._scoped_filter(filter), **kwargs)

    def find(self, filter: dict | None = None, **kwargs):
        return self._collection.find(self._scoped_filter(filter), **kwargs)

    async def insert_one(self, document: dict, **kwargs):
        return await self._collection.insert_one(self._scoped_document(document), **kwargs)

    async def update_one(self, filter: dict, update: dict, upsert: bool = False, **kwargs):
        scoped_filter = self._scoped_filter(filter)
        if upsert:
            # Stamp dealer_id into $setOnInsert too, so a first-time upsert
            # can't create a document missing (or with the wrong) dealer_id —
            # the equality filter above only guarantees it on documents that
            # already existed.
            update = dict(update)
            set_on_insert = dict(update.get("$setOnInsert", {}))
            set_on_insert["dealer_id"] = self._dealer_id
            update["$setOnInsert"] = set_on_insert
        return await self._collection.update_one(scoped_filter, update, upsert=upsert, **kwargs)

    async def count_documents(self, filter: dict | None = None, **kwargs) -> int:
        return await self._collection.count_documents(self._scoped_filter(filter), **kwargs)


class DealerScopedDatabase:
    """Hand one of these to any code that needs to read/write per-dealer
    data. Constructed once per request from the dealer_id on the incoming
    AgentState/request — never held across requests for different dealers.
    """

    def __init__(self, dealer_id: str) -> None:
        self._dealer_id = dealer_id

    @property
    def dealer_id(self) -> str:
        return self._dealer_id

    def collection(self, name: str) -> DealerScopedCollection:
        return DealerScopedCollection(get_db()[name], self._dealer_id)


def dealer_scoped_db(dealer_id: str) -> DealerScopedDatabase:
    return DealerScopedDatabase(dealer_id)


# Compound indexes this service's own collections need before real traffic
# hits them (docs/plans/AI/PLAN_1.md Phase 0.1). No existing aidmvcs-be-dev
# collection is touched here — these are all new collections this service
# owns, so this is index creation, not a data migration.
#
# Collection names match the ones Phase 1 (memory: save/read path) writes to:
#   - qualification_facts            — customer facts, §5.3/§5.4
#   - qualification_messages         — raw per-turn messages, §5.2
#   - qualification_session_summaries — session boundaries, §5.5
QUALIFICATION_FACTS_COLLECTION = "qualification_facts"
QUALIFICATION_MESSAGES_COLLECTION = "qualification_messages"
QUALIFICATION_SESSION_SUMMARIES_COLLECTION = "qualification_session_summaries"

INDEX_SPECS: dict[str, list[tuple[list[tuple[str, int]], dict]]] = {
    QUALIFICATION_FACTS_COLLECTION: [
        ([("dealer_id", 1), ("customer_id", 1)], {}),
    ],
    QUALIFICATION_MESSAGES_COLLECTION: [
        ([("dealer_id", 1), ("lead_id", 1)], {}),
        # What Phase 7's silence-check scans by — built now, per Phase 0.1,
        # not deferred until Phase 7 needs it.
        ([("dealer_id", 1), ("last_message_at", 1)], {}),
    ],
    QUALIFICATION_SESSION_SUMMARIES_COLLECTION: [
        ([("dealer_id", 1), ("customer_id", 1), ("session_end", 1)], {}),
    ],
}


async def ensure_indexes() -> None:
    """Creates every index in INDEX_SPECS. Idempotent — create_index is a
    no-op against an already-existing identical index, so this is safe to
    call on every process startup, not just once by hand. Called from
    main.py's lifespan, after init_mongo().
    """
    db = get_db()
    for collection_name, specs in INDEX_SPECS.items():
        for keys, options in specs:
            await db[collection_name].create_index(keys, **options)
