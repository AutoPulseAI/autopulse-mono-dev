"""Async MongoDB connection — points at the SAME database aidmvcs-be-dev uses
(settings.mongodb_uri). This service reads the existing collections (Customer,
Lead, Vehicle, ...) read-only in most cases, and owns a small set of its own
collections, listed below (architecture §10).

Using Motor (async) rather than Mongoose-equivalent, since this is a separate
Python process — there is no code-sharing possible with aidmvcs-be-dev's
Mongoose models across the language boundary, so schema shape is kept in sync
by convention + docs/architecture/architecture.md §10, not by shared code.
"""

from bson import ObjectId
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
    predating this module (architecture §10). Every NEW
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
    per docs/architecture/architecture.md §10, a database call that forgets
    (or gets tricked into ignoring) dealer_id is a data breach, not a bug, and
    a silent override could mask exactly that kind of bug instead of catching
    it.
    """


class DealerScopedCollection:
    """Wraps one Motor collection so every read/write is forced to filter (on
    reads) or stamp (on writes) dealer_id. This is the single enforcement
    point architecture §10 calls for: "a single module that
    every other piece of code goes through to read or write Mongo... It
    REQUIRES a dealer ID on every call and adds the filter itself, so no
    individual query can forget it."

    Deliberately narrow: only the handful of operations this service actually
    needs (find_one, find, insert_one, update_one, update_many, delete_one,
    count_documents). Add more
    as needed rather than exposing the raw collection — the moment code can
    reach the raw collection, this guarantee is gone.
    """

    def __init__(self, collection: AsyncIOMotorCollection, dealer_id: str, dealer_field: str = "dealer_id") -> None:
        """`dealer_field` is the name of the dealer key in this collection. It is
        `dealer_id` everywhere except the platform's Vehicle model, which uses
        `dealerId` (aidmvcs-be-dev/app/models/Vehicle.js)."""
        if not dealer_id:
            raise ValueError("dealer_id is required to scope a collection access")
        self._collection = collection
        self._dealer_id = dealer_id
        self._field = dealer_field

    def _scoped_filter(self, flt: dict | None) -> dict:
        flt = dict(flt or {})
        existing = flt.get(self._field)
        if existing is not None and existing != self._dealer_id:
            raise CrossDealerAccessError(
                f"query requested {self._field}={existing!r} but this access is scoped to "
                f"{self._dealer_id!r}"
            )
        flt[self._field] = self._dealer_id
        return flt

    def _scoped_document(self, doc: dict) -> dict:
        doc = dict(doc)
        existing = doc.get(self._field)
        if existing is not None and existing != self._dealer_id:
            raise CrossDealerAccessError(
                f"document has {self._field}={existing!r} but this access is scoped to "
                f"{self._dealer_id!r}"
            )
        doc[self._field] = self._dealer_id
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
            set_on_insert[self._field] = self._dealer_id
            update["$setOnInsert"] = set_on_insert
        return await self._collection.update_one(scoped_filter, update, upsert=upsert, **kwargs)

    async def delete_one(self, filter: dict, **kwargs):
        return await self._collection.delete_one(self._scoped_filter(filter), **kwargs)

    async def update_many(self, filter: dict, update: dict, **kwargs):
        return await self._collection.update_many(self._scoped_filter(filter), update, **kwargs)

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

    def collection(self, name: str, dealer_field: str = "dealer_id") -> DealerScopedCollection:
        return DealerScopedCollection(get_db()[name], self._dealer_id, dealer_field)


def dealer_scoped_db(dealer_id: str) -> DealerScopedDatabase:
    return DealerScopedDatabase(dealer_id)


def as_object_id(value: str) -> ObjectId | str:
    """Platform documents (Lead, Customer, ...) use ObjectId _ids; events carry
    them as strings. Returns the ObjectId when the string is one, else the
    string unchanged."""
    return ObjectId(value) if ObjectId.is_valid(value) else value


def set_db_for_tests(db) -> None:
    """Point this module at an in-memory database (mongomock-motor) in tests."""
    global _db
    _db = db


# Collections this service owns (architecture §10). Every document carries
# dealer_id and is read/written through DealerScopedDatabase.
AI_LEAD_STATE_COLLECTION = "ai_lead_state"
QUALIFICATION_FACTS_COLLECTION = "qualification_facts"
AI_MESSAGES_COLLECTION = "ai_messages"
SCHEDULED_FOLLOWUPS_COLLECTION = "scheduled_followups"
AI_EVENTS_COLLECTION = "ai_events"
AI_TURN_LOG_COLLECTION = "ai_turn_log"
# Per customer and channel: has the customer opted out (STOP) or back in
# (START)? Checked right before every send (architecture §9).
AI_CONSENT_COLLECTION = "ai_consent"
# DEV only: where the fake channel driver "sends" to (channels/fake.py).
DEV_OUTBOX_COLLECTION = "dev_outbox"

# The platform's own collections (aidmvcs-be-dev Mongoose models). This
# service only ever reads them; the platform owns their shape.
PLATFORM_LEADS_COLLECTION = "leads"
PLATFORM_CUSTOMERS_COLLECTION = "customers"
PLATFORM_VEHICLES_COLLECTION = "vehicles"  # dealer key is `dealerId`, not `dealer_id`
PLATFORM_DEALS_COLLECTION = "deals"
PLATFORM_REPAIR_ORDERS_COLLECTION = "repairorders"
PLATFORM_SERVICE_APPOINTMENTS_COLLECTION = "serviceappointments"
PLATFORM_TRADE_INS_COLLECTION = "tradeins"
# Dealers are `User` documents of type "dealer"; `ai_mode` lives there (Stage 5).
PLATFORM_USERS_COLLECTION = "users"
PLATFORM_EMAIL_ACCOUNTS_COLLECTION = "emailaccounts"

EVENT_DEDUPE_TTL_S = 7 * 24 * 3600
TURN_LOG_TTL_S = 90 * 24 * 3600

INDEX_SPECS: dict[str, list[tuple[list[tuple[str, int]], dict]]] = {
    AI_LEAD_STATE_COLLECTION: [
        ([("dealer_id", 1), ("lead_id", 1)], {"unique": True}),
    ],
    QUALIFICATION_FACTS_COLLECTION: [
        ([("dealer_id", 1), ("customer_id", 1), ("path", 1), ("valid_to", 1)], {}),
    ],
    AI_MESSAGES_COLLECTION: [
        ([("dealer_id", 1), ("lead_id", 1), ("created_at", 1)], {}),
        # One row per (turn, channel) send - a retried job hits DuplicateKeyError
        # instead of sending twice (architecture §9). Partial so inbound rows,
        # which have no key, don't collide on null.
        (
            [("idempotency_key", 1)],
            {"unique": True, "partialFilterExpression": {"idempotency_key": {"$type": "string"}}},
        ),
        ([("provider_id", 1)], {"sparse": True}),
    ],
    SCHEDULED_FOLLOWUPS_COLLECTION: [
        # The follow-up cron's claim query (cross-dealer by design, §10).
        (
            [("status", 1), ("due_at", 1)],
            {"partialFilterExpression": {"status": {"$in": ["pending", "claimed"]}}},
        ),
        ([("dealer_id", 1), ("lead_id", 1), ("status", 1)], {}),
    ],
    AI_EVENTS_COLLECTION: [
        ([("received_at", 1)], {"expireAfterSeconds": EVENT_DEDUPE_TTL_S}),
    ],
    AI_CONSENT_COLLECTION: [
        ([("dealer_id", 1), ("customer_id", 1)], {"unique": True}),
    ],
    AI_TURN_LOG_COLLECTION: [
        ([("dealer_id", 1), ("lead_id", 1), ("created_at", 1)], {}),
        ([("created_at", 1)], {"expireAfterSeconds": TURN_LOG_TTL_S}),
    ],
    DEV_OUTBOX_COLLECTION: [
        ([("dealer_id", 1), ("lead_id", 1), ("created_at", 1)], {}),
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
