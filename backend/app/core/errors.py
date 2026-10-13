"""One error format for the whole API: every 4xx/5xx body is an ErrorResponse.

    {"code": "product_not_found", "message": "Product not found"}

Validation errors (422) add "details", one entry per problem. Routes raise ApiError to choose
their own code; anything else (a plain HTTPException, an unknown URL, a crash) gets a code from
its status, e.g. "not_found", "method_not_allowed", or "internal_error".
"""

import re
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.error import ErrorResponse


class ApiError(HTTPException):
    """An error response with its own code, e.g. ApiError(404, "product_not_found", "...")."""

    def __init__(
        self, status_code: int, code: str, message: str, headers: dict[str, str] | None = None
    ) -> None:
        super().__init__(status_code=status_code, detail=message, headers=headers)
        self.code = code


def error_response(description: str) -> dict[str, Any]:
    """Documents an error status in a route's responses, e.g. {404: error_response("...")}."""
    return {"model": ErrorResponse, "description": description}


def add_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    # Unhandled exceptions: uvicorn still logs the traceback and the request log records the 500.
    app.add_exception_handler(Exception, _unhandled_error)


def _phrase(status: int) -> str:
    try:
        return HTTPStatus(status).phrase
    except ValueError:  # a status Python doesn't know, e.g. 499
        return "Error"


def _code_for_status(status: int) -> str:
    """ "not_found" for 404, "method_not_allowed" for 405, and so on."""
    return re.sub(r"[^a-z]+", "_", _phrase(status).lower()).strip("_")


def _error(status: int, body: ErrorResponse, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse(body.model_dump(exclude_none=True), status_code=status, headers=headers)


async def _http_error(request: Request, exc: Exception) -> JSONResponse:
    # ApiError, plain HTTPExceptions, and Starlette's own 404 (unknown URL) and 405.
    assert isinstance(exc, StarletteHTTPException)
    code = getattr(exc, "code", None) or _code_for_status(exc.status_code)
    message = exc.detail if isinstance(exc.detail, str) else _phrase(exc.status_code)
    return _error(exc.status_code, ErrorResponse(code=code, message=message), exc.headers)


async def _validation_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    details = jsonable_encoder(exc.errors())
    count = len(details)
    message = f"The request has {count} invalid field{'' if count == 1 else 's'}"
    return _error(422, ErrorResponse(code="validation_error", message=message, details=details))


async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    # Never echo the exception text: it can expose internals like SQL or file paths.
    return _error(500, ErrorResponse(code="internal_error", message="Internal server error"))
