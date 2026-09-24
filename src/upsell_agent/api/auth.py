"""Validates that a request to this service's real endpoints came from the
trusted Next.js backend (app/lib/upsellAgentClient.js), not an arbitrary
caller. Mirrors the check that app on the other side does for calls in the
opposite direction (app/lib/internalServiceAuth.js) - same shared secret,
same "hash both sides then constant-time compare" technique, so the two
implementations can't drift into checking different things.

Applied as a FastAPI dependency on every route that isn't a plain liveness
probe - see api/routes.py.
"""

import hashlib
import hmac

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from upsell_agent.config import Settings, get_settings

_bearer_scheme = HTTPBearer(auto_error=False)


def _constant_time_equals(a: str, b: str) -> bool:
    digest_a = hashlib.sha256(a.encode()).digest()
    digest_b = hashlib.sha256(b.encode()).digest()
    return hmac.compare_digest(digest_a, digest_b)


async def require_internal_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> None:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    if not _constant_time_equals(credentials.credentials, settings.upsell_service_shared_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token")
