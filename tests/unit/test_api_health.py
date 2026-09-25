"""The API boots, /health is open, and the /dev routes exist only in DEV
(MASTER_PLAN_1 Stage 3.2, layer 1)."""

import pytest
from fastapi.testclient import TestClient

from tests.unit.conftest import make_settings
from upsell_agent.main import create_app


def test_health_is_open_and_reports_environment():
    with TestClient(create_app(make_settings("DEV"), connect=False)) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["environment"] == "DEV"


@pytest.mark.parametrize("environment", ["PROD", "production", "development", "test", ""])
def test_dev_routes_do_not_exist_outside_dev(environment):
    with TestClient(create_app(make_settings(environment), connect=False)) as client:
        assert client.get("/dev/ping").status_code == 404
        assert client.get("/dev/pipeline").status_code == 404
        assert client.get("/dev/stream").status_code == 404
        assert client.get("/health").json()["environment"] == "PROD"


@pytest.mark.parametrize("environment", ["DEV", "dev", " Dev "])
def test_dev_routes_exist_in_dev(environment):
    with TestClient(create_app(make_settings(environment), connect=False)) as client:
        assert client.get("/dev/ping").json()["environment"] == "DEV"
        pipeline = client.get("/dev/pipeline").json()
    assert [n["id"] for n in pipeline["nodes"]][:6] == ["load_context", "extract", "validate", "decide", "compose", "guard"]
    assert {e["kind"] for e in pipeline["edges"]} == {"main", "retry", "fallback"}


def test_upsell_routes_are_not_registered():
    with TestClient(create_app(make_settings("DEV"), connect=False)) as client:
        assert client.post("/upsell/recommend", json={}).status_code == 404
