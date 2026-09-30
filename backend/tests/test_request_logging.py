import logging

import pytest
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.main import create_app
from tests.conftest import VALID_DATABASE_URL

LOGGER = "app.request"


def request_logs(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == LOGGER]


def test_each_request_is_logged_with_status_duration_and_request_id(make_client, caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)

    response = make_client().get("/")

    [record] = request_logs(caplog)
    request_id = response.headers["X-Request-ID"]
    assert record.levelno == logging.INFO
    assert record.getMessage().startswith("GET / -> 200 (")
    assert " ms) " in record.getMessage()
    assert f"request_id={request_id}" in record.getMessage()


def test_safe_incoming_request_id_is_reused(make_client):
    response = make_client().get("/", headers={"X-Request-ID": "app-abc-123"})

    assert response.headers["X-Request-ID"] == "app-abc-123"


def test_unsafe_incoming_request_id_is_replaced(make_client):
    response = make_client().get("/", headers={"X-Request-ID": "bad id\nwith newline"})

    assert response.headers["X-Request-ID"] != "bad id\nwith newline"
    assert len(response.headers["X-Request-ID"]) == 32


def test_query_string_is_not_logged(make_client, caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)

    make_client().get("/?token=secret-value")

    [record] = request_logs(caplog)
    assert "secret-value" not in record.getMessage()


def test_successful_health_checks_are_logged_at_debug_only(make_client, caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)

    make_client().get("/health")

    assert request_logs(caplog) == []


def test_failed_health_requests_are_still_logged(make_client, caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)
    client = make_client(cors_origins=["http://localhost:8081"])

    client.options(
        "/health",
        headers={"Origin": "http://evil.example.com", "Access-Control-Request-Method": "GET"},
    )

    [record] = request_logs(caplog)
    assert record.getMessage().startswith("OPTIONS /health -> 400 (")


def test_unhandled_error_is_logged_as_500(caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)
    app = create_app(load_settings(_env_file=None, database_url=VALID_DATABASE_URL))

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("kaboom")

    response = TestClient(app, raise_server_exceptions=False).get("/boom")

    assert response.status_code == 500
    [record] = request_logs(caplog)
    assert record.levelno == logging.ERROR
    assert record.getMessage().startswith("GET /boom -> 500 (")
