"""Logs one line per request: method, path, status, duration, and a request ID.

The request ID comes from the caller's X-Request-ID header when it looks safe, otherwise a new
one is generated. It's returned in the X-Request-ID response header so a bug report or app
error can be matched to the server log line.
"""

import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

logger = logging.getLogger("app.request")

REQUEST_ID_HEADER = "X-Request-ID"
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")

# Load balancers and uptime monitors hit these constantly; successful calls are logged at DEBUG
# so they don't flood the INFO log. Failures (status >= 400) are still logged at INFO.
_QUIET_PATHS = {"/health"}


def add_request_logging(app: FastAPI) -> None:
    @app.middleware("http")
    async def log_request(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming_id = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = incoming_id if _SAFE_REQUEST_ID.match(incoming_id) else uuid.uuid4().hex
        start = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            # Log the failure with its timing, then let FastAPI turn it into a 500.
            _log(logging.ERROR, request, 500, start, request_id)
            raise

        response.headers[REQUEST_ID_HEADER] = request_id
        quiet = request.url.path in _QUIET_PATHS and response.status_code < 400
        _log(
            logging.DEBUG if quiet else logging.INFO,
            request,
            response.status_code,
            start,
            request_id,
        )
        return response


def _log(level: int, request: Request, status: int, start: float, request_id: str) -> None:
    duration_ms = (time.perf_counter() - start) * 1000
    # Path only, no query string: queries can carry search terms or tokens we don't want in logs.
    logger.log(
        level,
        "%s %s -> %d (%.1f ms) [request_id=%s]",
        request.method,
        request.url.path,
        status,
        duration_ms,
        request_id,
    )
