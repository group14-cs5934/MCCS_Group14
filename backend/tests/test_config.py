"""T004 acceptance: with a valid .env the service runs; a missing required variable fails
with a clear message."""

import pytest
from fastapi.testclient import TestClient

from app import main
from app.core.config import ConfigError, load_settings
from app.main import create_app
from tests.conftest import VALID_DATABASE_URL

pytestmark = pytest.mark.usefixtures("clean_env")


def test_valid_env_file_loads_and_app_runs(env_file):
    path = env_file(f"DATABASE_URL={VALID_DATABASE_URL}\nAPP_ENV=test\nLOG_LEVEL=DEBUG\n")

    settings = load_settings(_env_file=path)

    assert str(settings.database_url) == VALID_DATABASE_URL
    assert settings.app_env == "test"
    assert settings.log_level == "DEBUG"

    response = TestClient(create_app(settings)).get("/")
    assert response.status_code == 200
    assert response.json() == {"service": "mccs-backend", "environment": "test"}


def test_optional_variables_have_defaults(env_file):
    settings = load_settings(_env_file=env_file(f"DATABASE_URL={VALID_DATABASE_URL}\n"))

    assert settings.app_env == "development"
    assert settings.log_level == "INFO"


def test_missing_required_variable_fails_with_clear_message(env_file):
    with pytest.raises(ConfigError) as exc_info:
        load_settings(_env_file=env_file("APP_ENV=development\n"))

    message = str(exc_info.value)
    assert "DATABASE_URL is required but not set" in message
    assert ".env.example" in message


def test_invalid_value_is_named_without_echoing_secrets(env_file):
    path = env_file("DATABASE_URL=mysql://user:s3cret-pw@localhost/db\nAPP_ENV=prod\n")

    with pytest.raises(ConfigError) as exc_info:
        load_settings(_env_file=path)

    message = str(exc_info.value)
    assert "DATABASE_URL is invalid" in message
    assert "APP_ENV is invalid" in message
    assert "s3cret-pw" not in message


def test_environment_variables_override_env_file(env_file, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    path = env_file(f"DATABASE_URL={VALID_DATABASE_URL}\nAPP_ENV=development\n")

    assert load_settings(_env_file=path).app_env == "production"


def test_startup_exits_with_message_instead_of_traceback(monkeypatch, capsys):
    def broken_config():
        raise ConfigError("Backend configuration error:\n  - DATABASE_URL is required but not set")

    monkeypatch.setattr(main, "create_app", broken_config)

    with pytest.raises(SystemExit) as exc_info:
        main._create_app_or_exit()

    assert exc_info.value.code == 1
    assert "DATABASE_URL is required but not set" in capsys.readouterr().err
