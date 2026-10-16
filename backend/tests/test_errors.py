"""T032 acceptance: when any endpoint returns an error, the body has the same code/message format.

Each kind of error the API can produce is checked here: a route's own ApiError (with or without
actions for the app to offer), a plain HTTPException, Starlette's 404 and 405, request validation
(422), and an unhandled crash (500).
"""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.core.errors import ApiError
from app.main import create_app
from app.schemas import ErrorAction
from tests.conftest import VALID_DATABASE_URL


@pytest.fixture
def client() -> TestClient:
    """A client for the real app plus a few test routes that fail in different ways."""
    app = create_app(load_settings(_env_file=None, database_url=VALID_DATABASE_URL))

    @app.get("/test/api-error")
    def api_error() -> None:
        raise ApiError(409, "already_reviewed", "You already reviewed this product")

    @app.get("/test/api-error-with-actions")
    def api_error_with_actions() -> None:
        raise ApiError(404, "product_not_found", "Product not found", actions=list(ErrorAction))

    @app.get("/test/http-exception")
    def http_exception() -> None:
        raise HTTPException(status_code=403, detail="Not allowed")

    @app.get("/test/http-exception-without-message")
    def http_exception_without_message() -> None:
        raise HTTPException(status_code=400, detail={"reason": "not a string"})

    @app.get("/test/crash")
    def crash() -> None:
        raise RuntimeError("password=hunter2 leaked in an error message")

    @app.get("/test/query")
    def query(limit: int) -> dict[str, int]:
        return {"limit": limit}

    # raise_server_exceptions=False returns the 500 response instead of re-raising the crash.
    return TestClient(app, raise_server_exceptions=False)


ERROR_REQUESTS = [
    ("GET", "/test/api-error", 409),
    ("GET", "/test/api-error-with-actions", 404),
    ("GET", "/test/http-exception", 403),
    ("GET", "/test/http-exception-without-message", 400),
    ("GET", "/test/crash", 500),
    ("GET", "/test/query?limit=lots", 422),
    ("GET", "/no/such/page", 404),
    ("DELETE", "/health", 405),
    ("POST", "/products/validate", 422),
]


@pytest.mark.parametrize(("method", "path", "status"), ERROR_REQUESTS)
def test_every_error_has_a_code_and_message(client, method, path, status) -> None:
    response = client.request(method, path)

    assert response.status_code == status
    assert response.headers["content-type"] == "application/json"
    body = response.json()
    assert isinstance(body["code"], str) and body["code"]
    assert isinstance(body["message"], str) and body["message"]
    assert set(body) <= {"code", "message", "details", "actions"}


def test_api_error_uses_its_own_code(client) -> None:
    response = client.get("/test/api-error")

    assert response.json() == {
        "code": "already_reviewed",
        "message": "You already reviewed this product",
    }


def test_api_error_can_tell_the_app_what_to_offer_next(client) -> None:
    response = client.get("/test/api-error-with-actions")

    assert response.json() == {
        "code": "product_not_found",
        "message": "Product not found",
        "actions": ["retry_scan", "manual_search"],
    }


def test_errors_without_actions_leave_the_field_out(client) -> None:
    assert "actions" not in client.get("/test/api-error").json()


def test_plain_http_exception_gets_a_code_from_its_status(client) -> None:
    assert client.get("/test/http-exception").json() == {
        "code": "forbidden",
        "message": "Not allowed",
    }


def test_http_exception_without_a_string_message_uses_the_status_phrase(client) -> None:
    assert client.get("/test/http-exception-without-message").json() == {
        "code": "bad_request",
        "message": "Bad Request",
    }


def test_unknown_url_returns_not_found(client) -> None:
    assert client.get("/no/such/page").json() == {"code": "not_found", "message": "Not Found"}


def test_wrong_method_returns_method_not_allowed_and_keeps_the_allow_header(client) -> None:
    response = client.delete("/health")

    assert response.json() == {"code": "method_not_allowed", "message": "Method Not Allowed"}
    assert response.headers["allow"] == "GET"


def test_validation_error_lists_each_problem_in_details(client) -> None:
    response = client.post("/products/validate", json={"size": "x" * 51})

    body = response.json()
    assert body["code"] == "validation_error"
    assert body["message"] == "The request has 3 invalid fields"
    assert {tuple(problem["loc"]) for problem in body["details"]} == {
        ("body", "barcode"),
        ("body", "name"),
        ("body", "size"),
    }


def test_single_validation_problem_message(client) -> None:
    body = client.get("/test/query?limit=lots").json()

    assert body["message"] == "The request has 1 invalid field"
    [problem] = body["details"]
    assert (problem["loc"], problem["type"]) == (["query", "limit"], "int_parsing")


def test_crash_returns_internal_error_without_leaking_the_exception(client) -> None:
    response = client.get("/test/crash")

    assert response.json() == {"code": "internal_error", "message": "Internal server error"}
    assert "hunter2" not in response.text


def test_docs_describe_errors_with_the_standard_schema(make_client) -> None:
    schema = make_client().app.openapi()
    by_id = schema["paths"]["/products/{product_id}"]["get"]["responses"]
    validate = schema["paths"]["/products/validate"]["post"]["responses"]

    error_ref = {"$ref": "#/components/schemas/ErrorResponse"}
    assert by_id["404"]["content"]["application/json"]["schema"] == error_ref
    assert validate["422"]["content"]["application/json"]["schema"] == error_ref
    assert "HTTPValidationError" not in schema["components"]["schemas"]
