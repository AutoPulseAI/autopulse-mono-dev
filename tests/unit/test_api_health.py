"""First smoke tests — confirm the FastAPI app boots, the router is wired, and
the internal-service auth check actually rejects/accepts as expected.
Run: pytest tests/unit/test_api_health.py -v
(Requires OPENAI_API_KEY/MONGODB_URI/REDIS_URL/AUTOPULSE_API_BASE_URL/
UPSELL_SERVICE_SHARED_SECRET set in .env, since config.Settings validates them
at import time — see config.py.)
"""

from fastapi.testclient import TestClient

from upsell_agent.config import get_settings
from upsell_agent.main import app


def test_health_endpoint_has_no_auth_requirement():
    """/health is intentionally unprotected for infra liveness probes."""
    with TestClient(app) as client:
        response = client.get("/upsell/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


def test_recommend_rejects_missing_auth():
    with TestClient(app) as client:
        response = client.post(
            "/upsell/recommend",
            json={"dealer_id": "d1", "customer_id": "c1", "trigger": "appointment_booked"},
        )
        assert response.status_code == 401


def test_recommend_rejects_wrong_token():
    with TestClient(app) as client:
        response = client.post(
            "/upsell/recommend",
            json={"dealer_id": "d1", "customer_id": "c1", "trigger": "appointment_booked"},
            headers={"Authorization": "Bearer not-the-right-secret"},
        )
        assert response.status_code == 401


def test_recommend_stub_returns_not_implemented_marker_when_authenticated():
    """The stub route must be honest about being unimplemented, not return
    something that looks like a real recommendation."""
    settings = get_settings()
    with TestClient(app) as client:
        response = client.post(
            "/upsell/recommend",
            json={"dealer_id": "d1", "customer_id": "c1", "trigger": "appointment_booked"},
            headers={"Authorization": f"Bearer {settings.upsell_service_shared_secret}"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["recommendations"] == []
        assert body["suppressed_reason"] is not None
