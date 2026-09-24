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
AsyncRedisSaver (langgraph.checkpoint.redis) — AsyncRedisSaver.from_conn_string()
is an async context manager (@asynccontextmanager classmethod), not a plain
constructor call, hence the lifespan wiring in main.py rather than a bare
`build_checkpointer()` return value.
"""

from contextlib import AbstractAsyncContextManager

from langgraph.checkpoint.redis import AsyncRedisSaver

from upsell_agent.config import Settings


def thread_id_for(dealer_id: str, lead_id: str | None, customer_id: str) -> str:
    return f"{dealer_id}:{lead_id}" if lead_id else f"{dealer_id}:{customer_id}"


def checkpointer_context(settings: Settings) -> AbstractAsyncContextManager[AsyncRedisSaver]:
    """Returns the async context manager for the Redis-backed checkpointer.
    Entered once in main.py's lifespan (so the connection pool lives for the
    whole process, not reopened per request) and the yielded saver is passed
    into agent/graph.build_graph().

    Uses the SAME Redis instance aidmvcs-be-dev's BullMQ queues run on
    (settings.redis_url) but relies on REDIS_URL already pointing at a
    dedicated logical DB index (see ../../.env.example) so this checkpointer's
    keyspace can't collide with the existing BullMQ queues on that instance.
    """
    return AsyncRedisSaver.from_conn_string(settings.redis_url)
