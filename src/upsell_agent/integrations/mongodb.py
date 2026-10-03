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
# Consent history, add-only (MASTER_PLAN_3 C1, decision 77): opt-outs and
# opt-ins, marketing consent evidence, open reviews (channels/consent.py).
AI_CONSENT_COLLECTION = "ai_consent"
# Every send check's decision, add-only, kept 5 years (compliance/engine.py).
AI_COMPLIANCE_LOG_COLLECTION = "ai_compliance_log"
# Shared with the platform's campaign worker (decision 66): it writes one
# check request per campaign text; this service writes the answer onto that
# entry only (compliance/send_checks.py).
AI_SEND_CHECKS_COLLECTION = "ai_send_checks"
# Staff call tasks opened after the 60-minute connection timer (MASTER_PLAN_3 C2, agent/call_tasks.py).
AI_CALL_TASKS_COLLECTION = "ai_call_tasks"
# MASTER_PLAN_4 D3/D8 (stream A3, agent/ownership.py; SOLD-DELIVERED PDF §9-§11, §14): one ownership record per
# vehicle a customer has (several per customer, current or historical), and the customer's ACTIVE / INACTIVE status.
AI_VEHICLE_OWNERSHIP_COLLECTION = "ai_vehicle_ownership"
AI_CUSTOMER_STATUS_COLLECTION = "ai_customer_status"
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
# `Booking` documents (aidmvcs-be-dev/app/models/Booking.js): the source of
# truth for availability (MASTER_PLAN_3 B5, architecture §15 decision 103) -
# read directly rather than through the lead's `booking_status` flag, which
# goes stale on a move or cancel (B5's known gaps).
PLATFORM_BOOKINGS_COLLECTION = "bookings"

EVENT_DEDUPE_TTL_S = 7 * 24 * 3600
TURN_LOG_TTL_S = 90 * 24 * 3600
# Longer than the TCPA's 4-year window for lawsuits (decision 77).
COMPLIANCE_RETENTION_S = 5 * 366 * 24 * 3600

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
    AI_CALL_TASKS_COLLECTION: [
        ([("dealer_id", 1), ("status", 1), ("opened_at", -1)], {}),
        ([("dealer_id", 1), ("lead_id", 1), ("status", 1)], {}),
    ],
    # MASTER_PLAN_4 D3 (stream A3).
    AI_VEHICLE_OWNERSHIP_COLLECTION: [
        ([("dealer_id", 1), ("customer_id", 1), ("ownership_status", 1)], {}),
        ([("dealer_id", 1), ("lead_id", 1)], {"sparse": True}),
    ],
    AI_CUSTOMER_STATUS_COLLECTION: [
        ([("dealer_id", 1), ("customer_id", 1)], {"unique": True}),
    ],
    AI_EVENTS_COLLECTION: [
        ([("received_at", 1)], {"expireAfterSeconds": EVENT_DEDUPE_TTL_S}),
    ],
    AI_CONSENT_COLLECTION: [
        ([("dealer_id", 1), ("customer_id", 1), ("channel", 1), ("consent_type", 1), ("recorded_at", -1)], {}),
        # Opt-outs are also read by phone / email, so a re-imported customer keeps them (decision 140).
        ([("dealer_id", 1), ("address", 1), ("channel", 1), ("consent_type", 1), ("recorded_at", -1)],
         {"partialFilterExpression": {"address": {"$type": "string"}}}),
        # The same evidence (a lead form's consent line) is recorded once.
        ([("consent_evidence_id", 1)],
         {"unique": True, "partialFilterExpression": {"consent_evidence_id": {"$type": "string"}}}),
    ],
    AI_COMPLIANCE_LOG_COLLECTION: [
        ([("dealer_id", 1), ("customer_id", 1), ("channel", 1), ("at", -1)], {}),
        ([("dealer_id", 1), ("lead_id", 1), ("at", -1)], {}),
        ([("logged_at", 1)], {"expireAfterSeconds": COMPLIANCE_RETENTION_S}),
    ],
    AI_SEND_CHECKS_COLLECTION: [
        # The answering job's claim query (cross-dealer by design, like follow-ups).
        ([("status", 1), ("requested_at", 1)], {}),
        ([("request_key", 1)], {"unique": True}),
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
    # The pre-C1 consent documents and their unique index go first, or the
    # new non-unique index on the same keys can't be created.
    from upsell_agent.channels.consent import migrate_legacy_consent, migrate_silenced_opt_outs

    await migrate_legacy_consent()
    await migrate_silenced_opt_outs()
    db = get_db()
    for collection_name, specs in INDEX_SPECS.items():
        for keys, options in specs:
            await db[collection_name].create_index(keys, **options)
