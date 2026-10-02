"""Service configuration, loaded from environment variables.

Every setting the agent, tools, or integrations need lives here — nothing should
read `os.environ` directly elsewhere in the codebase. This is the single point
where "what does this service need to run" is documented and validated at
startup (a missing required var fails fast, not three requests into production).
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Only the exact value "DEV" turns on debug-only behaviour: the /dev/* routes,
    # the live trace stream, stored prompts, artificial stub delays (see
    # docs/plans/MASTER_PLAN_1.md Stage 0 and Stage 3.2). Anything else - including
    # a missing value - is production behaviour, so forgetting to set this can
    # never expose the Debug UI.
    environment: str = Field(default="PROD", alias="ENVIRONMENT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    port: int = Field(default=8100, alias="PORT")

    # Model provider. Optional until Stage 8 (the first stage that calls a model),
    # so the API, worker and Debug UI can run locally without a key.
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    # A cheap, fast model for extraction and a stronger one only for writing the
    # message - the main cost lever (architecture §10). "offline" selects the
    # deterministic stand-in (agent/offline_model.py) for development without
    # a key; it is rules, not AI, and must not be used in production.
    model_extract: str = Field(default="openai:gpt-4o-mini", alias="MODEL_EXTRACT")
    model_compose: str = Field(default="openai:gpt-4o", alias="MODEL_COMPOSE")
    # Makes every offline-model call wait this long, like a real model would
    # (burst tests, MASTER_PLAN_1 Stage 12). 0 = answer instantly.
    offline_model_latency_ms: int = Field(default=0, alias="OFFLINE_MODEL_LATENCY_MS")

    # Per-turn limits (architecture §7). Hitting any of them sends the template.
    extract_timeout_s: float = Field(default=3.0, alias="EXTRACT_TIMEOUT_S")
    compose_timeout_s: float = Field(default=5.0, alias="COMPOSE_TIMEOUT_S")
    first_reply_deadline_s: float = Field(default=8.0, alias="FIRST_REPLY_DEADLINE_S")
    reply_deadline_s: float = Field(default=20.0, alias="REPLY_DEADLINE_S")
    max_ai_calls_per_turn: int = Field(default=4, alias="MAX_AI_CALLS_PER_TURN")
    # Working memory in the context pack (MASTER_PLAN_2 Phase 1): the recent
    # conversation, word for word, up to about this many tokens. The last 6
    # messages are always kept.
    context_working_tokens: int = Field(default=3000, alias="CONTEXT_WORKING_TOKENS")

    # One dealer's campaign burst must not slow the others (architecture §12):
    # a dealer gets at most DEALER_MAX_INFLIGHT turns at once, and each worker
    # runs WORKER_CONCURRENCY jobs, which must stay above that cap so a busy
    # dealer can never occupy every slot.
    dealer_max_inflight: int = Field(default=10, alias="DEALER_MAX_INFLIGHT")
    worker_concurrency: int = Field(default=20, alias="WORKER_CONCURRENCY")
    # A lead's lock outlives the longest possible turn (20s deadline) with room
    # to spare; it expires on its own if a worker dies holding it.
    lead_lock_ttl_s: float = Field(default=60.0, alias="LEAD_LOCK_TTL_S")
    # A job that finds its lead locked or its dealer at the cap is re-queued:
    # first busy_retry_delay_s later, the wait growing by a quarter second per
    # try up to busy_retry_max_delay_s, for up to busy_retry_max tries (about
    # 48 minutes), so a campaign flood queues up rather than dropping replies
    # (burst test, MASTER_PLAN_1 Stage 12).
    busy_retry_delay_s: float = Field(default=2.0, alias="BUSY_RETRY_DELAY_S")
    busy_retry_max_delay_s: float = Field(default=10.0, alias="BUSY_RETRY_MAX_DELAY_S")
    busy_retry_max: int = Field(default=300, alias="BUSY_RETRY_MAX")

    # First reply to a new lead: `ai` runs the full pipeline with the template
    # as the 8-second fallback (MASTER_PLAN_1 Stage 8); `template` sends the
    # lead type's template straight away with no AI call.
    first_reply_mode: Literal["template", "ai"] = Field(default="ai", alias="FIRST_REPLY_MODE")
    # MASTER_PLAN_3 C4: the client's Day 1-90 follow-up cadence (agent/cadence.py). Off, a lead gets
    # Plan 1's single 24h switch to the other channel instead - the rollback if a dealer's cadence
    # has to be stopped (decision 153).
    cadence_enabled: bool = Field(default=True, alias="CADENCE_ENABLED")

    # Sending (architecture §9): provider attempts per message, with the delay
    # doubling from send_retry_base_s between attempts.
    send_max_attempts: int = Field(default=3, alias="SEND_MAX_ATTEMPTS")
    send_retry_base_s: float = Field(default=0.5, alias="SEND_RETRY_BASE_S")

    # `fake` writes to the dev_outbox collection; `live` calls Twilio/SendGrid
    # (Stage 12). `stub` platform client returns seeded Customer 360 data and
    # records messages locally; `live` calls aidmvcs-be-dev (Stage 5).
    channel_driver: Literal["fake", "live"] = Field(default="fake", alias="CHANNEL_DRIVER")
    platform_client: Literal["stub", "live"] = Field(default="stub", alias="PLATFORM_CLIENT")

    # Delivery webhooks (architecture §9, MASTER_PLAN_1 Stage 10). Twilio signs
    # its status callbacks with the account's auth token; SendGrid signs its
    # event webhook with an ECDSA key (Settings → Mail Settings → Signed Event
    # Webhook, "Verification Key"). A webhook whose secret isn't set rejects
    # every call. PUBLIC_BASE_URL is the address the providers call us on
    # (e.g. https://ai.autopulse.example); Twilio's signature covers the full
    # URL, which a proxy in front of us would otherwise change.
    twilio_auth_token: str = Field(default="", alias="TWILIO_AUTH_TOKEN")
    sendgrid_webhook_public_key: str = Field(default="", alias="SENDGRID_WEBHOOK_PUBLIC_KEY")
    public_base_url: str = Field(default="", alias="PUBLIC_BASE_URL")

    # Live channel drivers (CHANNEL_DRIVER=live, MASTER_PLAN_1 Stage 12). SMS go
    # out from each dealer's own Twilio number and email from its mailbox, with
    # reply-to set to that mailbox so replies come back through the platform's
    # Mailgun inbound route (architecture §15). SENDGRID_FROM_EMAIL overrides the
    # From address when the dealer domains aren't authenticated in SendGrid.
    twilio_account_sid: str = Field(default="", alias="TWILIO_ACCOUNT_SID")
    twilio_api_base: str = Field(default="https://api.twilio.com", alias="TWILIO_API_BASE")
    sendgrid_api_key: str = Field(default="", alias="SENDGRID_API_KEY")
    sendgrid_api_base: str = Field(default="https://api.sendgrid.com", alias="SENDGRID_API_BASE")
    sendgrid_from_email: str = Field(default="", alias="SENDGRID_FROM_EMAIL")
    # Outside production, live drivers only message these phone numbers and
    # email addresses (comma-separated); everyone else is suppressed. Keeps a
    # staging run with real credentials from ever texting a real customer.
    send_allowlist: str = Field(default="", alias="SEND_ALLOWLIST")

    # Shared datastores — same MongoDB/Redis aidmvcs-be-dev already runs (see INTEGRATION.md)
    mongodb_uri: str = Field(alias="MONGODB_URI")
    redis_url: str = Field(alias="REDIS_URL")
    queue_name: str = Field(default="ai-turns", alias="QUEUE_NAME")

    # Calling back into the existing Next.js platform instead of duplicating its logic
    autopulse_api_base_url: str = Field(default="http://localhost:3000", alias="AUTOPULSE_API_BASE_URL")

    # Single shared secret for BOTH directions of the Next.js <-> this service
    # boundary: Next.js sends it to authenticate calls INTO this service (see
    # api/auth.py), and this service sends the SAME value to authenticate its
    # own calls back into Next.js's /api/customers/[id]/360 (see
    # integrations/autopulse_api_client.py). One logical trust relationship
    # between two services -> one secret to configure and rotate, on both
    # sides. Required, not optional: this service must fail to start rather
    # than run with authentication silently disabled.
    upsell_service_shared_secret: str = Field(alias="UPSELL_SERVICE_SHARED_SECRET")

    # Observability
    langfuse_public_key: str = Field(default="", alias="LANGFUSE_PUBLIC_KEY")
    langfuse_secret_key: str = Field(default="", alias="LANGFUSE_SECRET_KEY")
    langfuse_host: str = Field(default="https://cloud.langfuse.com", alias="LANGFUSE_HOST")

    @property
    def is_dev(self) -> bool:
        return self.environment.strip().upper() == "DEV"

    @property
    def is_production(self) -> bool:
        return self.environment.strip().upper() in ("PROD", "PRODUCTION")

    @property
    def allowlist(self) -> set[str]:
        return {item.strip().lower() for item in self.send_allowlist.split(",") if item.strip()}


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton — import and call this, don't instantiate Settings() directly."""
    return Settings()
