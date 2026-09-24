"""Service configuration, loaded from environment variables.

Every setting the agent, tools, or integrations need lives here — nothing should
read `os.environ` directly elsewhere in the codebase. This is the single point
where "what does this service need to run" is documented and validated at
startup (a missing required var fails fast, not three requests into production).
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = Field(default="development", alias="ENVIRONMENT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    port: int = Field(default=8100, alias="PORT")

    # Model provider
    openai_api_key: str = Field(alias="OPENAI_API_KEY")

    # Shared datastores — same MongoDB/Redis aidmvcs-be-dev already runs (see INTEGRATION.md)
    mongodb_uri: str = Field(alias="MONGODB_URI")
    redis_url: str = Field(alias="REDIS_URL")

    # Calling back into the existing Next.js platform instead of duplicating its logic
    autopulse_api_base_url: str = Field(alias="AUTOPULSE_API_BASE_URL")

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


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton — import and call this, don't instantiate Settings() directly."""
    return Settings()
