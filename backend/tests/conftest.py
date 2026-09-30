import os
from collections.abc import Callable
from pathlib import Path

import pytest

CONFIG_VARS = ("DATABASE_URL", "APP_ENV", "LOG_LEVEL")
VALID_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/mccs"

# Test-suite config, set before any test imports app.main (which loads settings on import).
# Real environment variables win over backend/.env, so tests never depend on a developer's .env.
os.environ["DATABASE_URL"] = VALID_DATABASE_URL
os.environ["APP_ENV"] = "test"


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove all config variables so a test controls config only through its own .env file."""
    for name in CONFIG_VARS:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def env_file(tmp_path: Path) -> Callable[[str], Path]:
    """Write a temporary .env file and return its path."""

    def write(contents: str) -> Path:
        path = tmp_path / ".env"
        path.write_text(contents, encoding="utf-8")
        return path

    return write
