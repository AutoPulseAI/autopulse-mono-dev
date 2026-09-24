"""Short-term (this-conversation) memory: the LangGraph checkpointer.

This is what makes CAPTURE cumulative across separate HTTP requests — each
inbound customer message is a NEW request to this service (there is no
long-lived in-process conversation), so without a checkpointer, every message
would start from blank state and "remember and use the customer's responses"
(conversations.md's own success criterion) would be structurally impossible.
LangGraph resumes exactly where a thread left off, keyed by thread_id, backed
by Redis so it survives this service restarting between messages (the plain
MemorySaver used as agent/graph.py's original placeholder does not).

Thread id convention: f"{dealer_id}:{lead_id}" — scoped per LEAD (one
inquiry/conversation), not per customer, since a customer can have multiple
concurrent or sequential leads with genuinely separate conversation contexts.
Falls back to f"{dealer_id}:{customer_id}" only if no lead_id is available
(e.g. an outbound-initiated service-interval conversation with no inbound
lead yet) — see agent/graph.py's usage.

API verified against langgraph-checkpoint-redis==0.5.2's real
AsyncShallowRedisSaver (langgraph.checkpoint.redis) —
AsyncShallowRedisSaver.from_conn_string() is an async context manager
(@asynccontextmanager classmethod), not a plain constructor call, hence the
lifespan wiring in main.py rather than a bare `build_checkpointer()` return
value.

Uses AsyncShallowRedisSaver, not the plain AsyncRedisSaver — per
docs/architecture/architecture.md §17.3, this service keeps only the LATEST
snapshot per conversation in Redis (aput() overwrites one key in place rather
than appending a new one per step), not a full step-by-step history. The full
history already lives in MongoDB once Phase 1 (memory/long_term.py's per-turn
write) is built — see §5.7 — so nothing is lost by not keeping every
intermediate Redis snapshot; this only affects how much LangGraph itself can
replay from Redis alone, not what's durably recorded.

Idle-expiry (§17.3): a conversation with no activity for IDLE_EXPIRY_DAYS is
allowed to drop out of Redis entirely, via a Redis-native TTL passed as the
`ttl` constructor arg — verified against BaseRedisSaver's real ttl_config
handling (langgraph/checkpoint/redis/base.py): `default_ttl` is applied (in
minutes) to the checkpoint key on every aput(), and `refresh_on_read=True`
also refreshes it on every aget(), so the countdown restarts on ANY activity
(a customer message, or a human reading a paused conversation for review) —
this is a rolling idle timer, not a fixed expiry from conversation start. If a
message arrives for a conversation whose key has already expired, LangGraph
starts a fresh checkpoint for that thread_id (there is nothing to resume),
and agent/graph.py is responsible for rebuilding working state (current
facts, recent history) from MongoDB in that case, per §5.7 — this module only
owns the Redis side of that behavior, not the rebuild.
"""

from contextlib import AbstractAsyncContextManager

from langgraph.checkpoint.redis import AsyncShallowRedisSaver

from upsell_agent.config import Settings

IDLE_EXPIRY_DAYS = 7


def thread_id_for(dealer_id: str, lead_id: str | None, customer_id: str) -> str:
    return f"{dealer_id}:{lead_id}" if lead_id else f"{dealer_id}:{customer_id}"


def checkpointer_context(
    settings: Settings,
) -> AbstractAsyncContextManager[AsyncShallowRedisSaver]:
    """Returns the async context manager for the Redis-backed checkpointer.
    Entered once in main.py's lifespan (so the connection pool lives for the
    whole process, not reopened per request) and the yielded saver is passed
    into agent/graph.build_graph().

    Uses the SAME Redis instance aidmvcs-be-dev's BullMQ queues run on
    (settings.redis_url) but relies on REDIS_URL already pointing at a
    dedicated logical DB index (see ../../.env.example) so this checkpointer's
    keyspace can't collide with the existing BullMQ queues on that instance.
    """
    return AsyncShallowRedisSaver.from_conn_string(
        settings.redis_url,
        ttl={"default_ttl": IDLE_EXPIRY_DAYS * 24 * 60, "refresh_on_read": True},
    )
