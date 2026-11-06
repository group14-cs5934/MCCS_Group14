"""GET /products/{id}/overall-review against a real database (skipped without TEST_DATABASE_URL).

T052.8: the product page shows the AI-written overall review that jobs/product-monitor saves to
agent_review_summaries, with each store's own average and review count from
agent_source_ratings, apart from app users' own reviews.
"""

from collections.abc import Iterator

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.main import create_app
from tests.factories import add_product

PAGE = "https://www.mynavyexchange.com/sample-chips/123"


@pytest.fixture
def client(db_url: str) -> Iterator[TestClient]:
    app = create_app(load_settings(_env_file=None, database_url=db_url))
    with TestClient(app) as client:
        yield client


@pytest.fixture
def product_id(connection: psycopg.Connection) -> int:
    product_id = add_product(connection)
    connection.commit()
    return product_id


def add_overall_review(connection: psycopg.Connection, product_id: int) -> None:
    connection.execute(
        "INSERT INTO agent_review_summaries "
        "(product_id, overall_review, review_count, model, generated_at) "
        "VALUES (%s, 'Shoppers like the crunch.', 12, 'test-model', '2026-11-01T12:00:00Z')",
        (product_id,),
    )


def add_source(
    connection: psycopg.Connection,
    product_id: int,
    source: str,
    average: float | None,
    count: int | None,
) -> None:
    connection.execute(
        "INSERT INTO agent_source_ratings "
        "(product_id, source, source_url, average_stars, review_count) "
        "VALUES (%s, %s, %s, %s, %s)",
        (product_id, source, PAGE, average, count),
    )


def test_returns_the_overall_review_with_each_stores_totals(client, connection, product_id) -> None:
    add_overall_review(connection, product_id)
    add_source(connection, product_id, "target.com", 4.25, 40)
    add_source(connection, product_id, "mynavyexchange.com", 4.6, 928)
    add_source(connection, product_id, "example.com", None, None)
    connection.commit()

    response = client.get(f"/products/{product_id}/overall-review")

    assert response.status_code == 200
    assert response.json() == {
        "product_id": product_id,
        "overall_review": "Shoppers like the crunch.",
        "review_count": 12,
        "generated_at": "2026-11-01T12:00:00Z",
        # Most reviews first; a store that gives no count goes last.
        "sources": [
            {"source": "mynavyexchange.com", "average_stars": 4.6, "review_count": 928},
            {"source": "target.com", "average_stars": 4.25, "review_count": 40},
            {"source": "example.com", "average_stars": None, "review_count": None},
        ],
    }
    # Which model wrote it is the agent's record, not part of the product page.
    assert "model" not in response.json()


def test_overall_review_without_store_totals(client, connection, product_id) -> None:
    add_overall_review(connection, product_id)
    connection.commit()

    response = client.get(f"/products/{product_id}/overall-review")

    assert response.status_code == 200
    assert response.json()["sources"] == []


def test_product_without_an_overall_review_is_a_404(client, connection, product_id) -> None:
    # Store totals alone aren't an overall review.
    add_source(connection, product_id, "mynavyexchange.com", 4.6, 928)
    connection.commit()

    response = client.get(f"/products/{product_id}/overall-review")

    assert response.status_code == 404
    assert response.json()["code"] == "overall_review_not_found"


def test_only_the_products_own_overall_review_is_returned(client, connection, product_id) -> None:
    other = add_product(connection, barcode="012345678905")
    add_overall_review(connection, other)
    connection.commit()

    response = client.get(f"/products/{product_id}/overall-review")

    assert response.status_code == 404
    assert response.json()["code"] == "overall_review_not_found"


@pytest.mark.parametrize("product_id", [999999, 2**31])
def test_unknown_product_is_a_404(client, product_id) -> None:
    response = client.get(f"/products/{product_id}/overall-review")

    assert response.status_code == 404
    assert response.json()["code"] == "product_not_found"
