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
    # MASTER_PLAN_4 stream G (client, 5 Oct 2026): the team switched to GPT-5 mini for both steps.
    model_extract: str = Field(default="openai:gpt-5-mini", alias="MODEL_EXTRACT")
    model_compose: str = Field(default="openai:gpt-5-mini", alias="MODEL_COMPOSE")
    # GPT-5 models reason before answering, and reasoning tokens are billed and timed as output. Extract and
    # Compose follow detailed instructions rather than solving puzzles, so they run at a low effort
    # ("minimal", "low", "medium", "high"; "" sends none - for a model that doesn't reason, e.g. gpt-4o).
    # Only sent to openai:gpt-5* / o-series models (agent/llm.py).
    reasoning_effort_extract: str = Field(default="minimal", alias="REASONING_EFFORT_EXTRACT")
    # Measured (stream G, gpt-5-mini, 4 Oct 2026): Compose at "minimal" took 2.4-3.2 s; at "low" 5.7-7.7 s with
    # 3x the output tokens, and once dropped a sentence of Touch 1's required opening.
    reasoning_effort_compose: str = Field(default="minimal", alias="REASONING_EFFORT_COMPOSE")
    # OpenAI's prompt cache (agent/llm.py): each agent sends a stable `prompt_cache_key` so its requests land
    # where its static prefix is already cached. This prefix namespaces the keys, e.g. per environment.
    prompt_cache_key_prefix: str = Field(default="autopulse", alias="PROMPT_CACHE_KEY_PREFIX")
    # Makes every offline-model call wait this long, like a real model would
    # (burst tests, MASTER_PLAN_1 Stage 12). 0 = answer instantly.
    offline_model_latency_ms: int = Field(default=0, alias="OFFLINE_MODEL_LATENCY_MS")

    # Per-turn limits (architecture §7). Hitting any of them sends the template - never silence, but also
    # never a good answer thrown away for being a few seconds slow.
    #
    # 6 Oct 2026 (product decision, superseding the 29 Sept note below): a real campaign-reply turn fell back
    # to the generic template because Extract alone took a bit over 8s - a correct, well-reasoned answer was
    # discarded purely for being slow. Quality matters more than shaving seconds, so there is now one
    # generous, loose budget for the WHOLE turn (extract, validate, search stock, decide, compose, one
    # possible rewrite, send, schedule): 60s. EXTRACT_TIMEOUT_S / COMPOSE_TIMEOUT_S match it, so neither call
    # cuts a turn short on its own - the one 60s turn deadline (below) is the only limit that actually binds
    # in practice; the per-call figures exist only so a single hung call can't block forever outside a turn
    # (a direct unit-test call to compose()/extract() with no outer wrapper).
    #
    # 29 Sept 2026: raised from the defaults (3.0 / 5.0) after the first-ever real OpenAI run measured actual
    # latency - gpt-4o-mini Extract took 3.1-3.7s model time, gpt-4o Compose ~3.1s, both close to or over the
    # old budgets. Stream G re-measured on gpt-5-mini (4 Oct 2026, docs/plans/PLAN_4/stream_G.md): Extract
    # 1.8-4.7s, Compose 2.4-3.2s per call - still frequently over the 6s/8s this raised them to.
    extract_timeout_s: float = Field(default=60.0, alias="EXTRACT_TIMEOUT_S")
    compose_timeout_s: float = Field(default=60.0, alias="COMPOSE_TIMEOUT_S")
    first_reply_deadline_s: float = Field(default=60.0, alias="FIRST_REPLY_DEADLINE_S")
    reply_deadline_s: float = Field(default=60.0, alias="REPLY_DEADLINE_S")
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
    # MASTER_PLAN_4 A1 (client SMS demo): a brand-new conversation whose first SMS is exactly CREDIT,
    # TRADE or GENERAL is put in that lead bucket (agent/lead_bucket.py), and the keyword isn't treated
    # as the customer's question. A testing aid only: off for real dealers.
    demo_bucket_keywords: bool = Field(default=False, alias="DEMO_BUCKET_KEYWORDS")
    # PLAN_4 stream L (learning/optimizer.py; blueprint box 5): pick the Days 8-90 angle and the wording variant
    # of each cadence touch from observed response rates (Thompson sampling, platform prior, minimum sample).
    # Off: today's fixed order and the original wording. SEND_TIME_AB: Day 2-90 touches are also split between
    # a morning and an afternoon send (both still held to the dealer's hours and the customer's window).
    learning_enabled: bool = Field(default=True, alias="LEARNING_ENABLED")
    send_time_ab: bool = Field(default=True, alias="SEND_TIME_AB")

    # MASTER_PLAN_4 F3: a vehicle's photo goes out as MMS on SMS (inline in email whatever this says). The
    # client wants the image, not the link (conversation_6), so it's on by default; a dealer record's
    # `ai_mms_enabled: false` turns it off for that dealer (agent/vehicle_media.py). Off: SMS carries no
    # image and still no link. MMS costs about 3x an SMS: the cost review comes before rollout.
    mms_enabled: bool = Field(default=True, alias="MMS_ENABLED")

    # --- MASTER_PLAN_4 D5/D6 (stream A4): service outreach from external data -------------------
    # NHTSA safety recalls (SOLD-DELIVERED PDF §6): the free public API, no key. The sweep re-checks each
    # owned vehicle every RECALL_RECHECK_DAYS, at most RECALL_SWEEP_BATCH vehicles per run, with at least
    # NHTSA_MIN_INTERVAL_S between calls (a polite rate limit; NHTSA publishes none).
    nhtsa_recalls_enabled: bool = Field(default=True, alias="NHTSA_RECALLS_ENABLED")
    nhtsa_api_base: str = Field(default="https://api.nhtsa.gov", alias="NHTSA_API_BASE")
    nhtsa_vpic_base: str = Field(default="https://vpic.nhtsa.dot.gov/api", alias="NHTSA_VPIC_BASE")
    nhtsa_min_interval_s: float = Field(default=1.0, alias="NHTSA_MIN_INTERVAL_S")
    recall_recheck_days: int = Field(default=7, alias="RECALL_RECHECK_DAYS")
    recall_sweep_batch: int = Field(default=100, alias="RECALL_SWEEP_BATCH")
    # Vehicle Databases OEM maintenance schedules (SOLD-DELIVERED PDF §5; client, 1 Oct 2026). Off until the
    # client starts the 15-day trial "near the end of building" (docs/data/5/vechicle_api.md).
    vehicle_databases_enabled: bool = Field(default=False, alias="VEHICLE_DATABASES_ENABLED")
    vehicle_databases_api_key: str = Field(default="", alias="VEHICLE_DATABASES_API_KEY")
    vehicle_databases_api_base: str = Field(default="https://api.vehicledatabases.com",
                                            alias="VEHICLE_DATABASES_API_BASE")
    vehicle_databases_min_interval_s: float = Field(default=1.0, alias="VEHICLE_DATABASES_MIN_INTERVAL_S")
    # §5 "if reliable current mileage is unavailable, use applicable time-based intervals": the Vehicle
    # Databases schedule is mileage-only, so the time interval is ours until the client gives one (open item).
    maintenance_time_interval_months: int = Field(default=6, alias="MAINTENANCE_TIME_INTERVAL_MONTHS")
    # Client, 10 Oct 2026: no staff call task just because a text / email got no reply within 60 minutes (it made
    # hundreds of alerts). A call the customer asks for still opens one. True brings the 60-minute task back.
    call_task_on_no_reply: bool = Field(default=False, alias="CALL_TASK_ON_NO_REPLY")
    # --- end D5/D6 ---------------------------------------------------------------------------------

    # Sending (architecture §9): provider attempts per message, with the delay
    # doubling from send_retry_base_s between attempts.
    send_max_attempts: int = Field(default=3, alias="SEND_MAX_ATTEMPTS")
    send_retry_base_s: float = Field(default=0.5, alias="SEND_RETRY_BASE_S")

    # `fake` writes to the dev_outbox collection; `live` calls Twilio/SendGrid
    # (Stage 12); `platform` asks the CRM (aidmvcs-be-dev) to send through its
    # own sendSMS / sendEmail (channels/platform.py, PLAN_4 stream C1). `stub`
    # platform client returns seeded Customer 360 data and records messages
    # locally; `live` calls aidmvcs-be-dev (Stage 5).
    channel_driver: Literal["fake", "live", "platform"] = Field(default="fake", alias="CHANNEL_DRIVER")
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
    # Where the dealer's stock is read from (GET /api/car), when it isn't AUTOPULSE_API_BASE_URL: a local CRM
    # demoing against a real dealer's live inventory (e.g. https://www.autopulse.ai). Read-only.
    inventory_api_base_url: str = Field(default="", alias="INVENTORY_API_BASE_URL")
    # "<our dealer id>:<dealer id on the inventory API>,..." - whose stock a dealer shows when the two differ.
    inventory_dealer_map: str = Field(default="", alias="INVENTORY_DEALER_MAP")

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
