"""PostgreSQL database connection helpers."""

import psycopg

from app.core.config import get_settings


def check_database_connection() -> bool:
    """Connect to PostgreSQL and run a simple test query."""
    settings = get_settings()

    with psycopg.connect(str(settings.database_url)) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            result = cursor.fetchone()

    return result == (1,)