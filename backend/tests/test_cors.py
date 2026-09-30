"""T005 acceptance: a request from a non-allowed origin is blocked by CORS.

Browsers enforce CORS. For a preflight (OPTIONS) request the server rejects a bad origin outright;
for a simple request it leaves out Access-Control-Allow-Origin, so the browser refuses to let the
page read the response.
"""

import pytest

from app.core.config import ConfigError, load_settings
from tests.conftest import VALID_DATABASE_URL

ALLOWED = "http://localhost:8081"
BLOCKED = "http://evil.example.com"
ALLOW_ORIGIN = "access-control-allow-origin"


def preflight(client, origin: str):
    return client.options(
        "/health",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )


def test_preflight_from_allowed_origin_succeeds(make_client):
    response = preflight(make_client(cors_origins=[ALLOWED]), ALLOWED)

    assert response.status_code == 200
    assert response.headers[ALLOW_ORIGIN] == ALLOWED


def test_preflight_from_non_allowed_origin_is_blocked(make_client):
    response = preflight(make_client(cors_origins=[ALLOWED]), BLOCKED)

    assert response.status_code == 400
    assert ALLOW_ORIGIN not in response.headers


def test_simple_request_from_non_allowed_origin_gets_no_cors_header(make_client):
    response = make_client(cors_origins=[ALLOWED]).get("/health", headers={"Origin": BLOCKED})

    assert ALLOW_ORIGIN not in response.headers


def test_simple_request_from_allowed_origin_can_read_request_id(make_client):
    response = make_client(cors_origins=[ALLOWED]).get("/health", headers={"Origin": ALLOWED})

    assert response.headers[ALLOW_ORIGIN] == ALLOWED
    assert "X-Request-ID" in response.headers["access-control-expose-headers"]


def test_no_origins_configured_blocks_every_origin(make_client):
    response = preflight(make_client(), ALLOWED)

    assert response.status_code == 400
    assert ALLOW_ORIGIN not in response.headers


def test_cors_origins_is_read_as_comma_separated_list(env_file, clean_env):
    path = env_file(
        f"DATABASE_URL={VALID_DATABASE_URL}\n"
        "CORS_ORIGINS=http://localhost:8081, https://admin.example.com\n"
    )

    settings = load_settings(_env_file=path)

    assert settings.cors_origins == ["http://localhost:8081", "https://admin.example.com"]


@pytest.mark.parametrize("bad_origin", ["http://localhost:8081/", "localhost:8081", "*"])
def test_malformed_origin_fails_startup_with_clear_message(env_file, clean_env, bad_origin):
    path = env_file(f"DATABASE_URL={VALID_DATABASE_URL}\nCORS_ORIGINS={bad_origin}\n")

    with pytest.raises(ConfigError) as exc_info:
        load_settings(_env_file=path)

    assert "CORS_ORIGINS is invalid" in str(exc_info.value)
    assert "no trailing slash" in str(exc_info.value)
