from __future__ import annotations

import json
import logging
import sys
from typing import Any

from opentelemetry import trace


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:  # type: ignore[override]
        span = trace.get_current_span()
        ctx = span.get_span_context() if span else None

        payload: dict[str, Any] = {
            "level": record.levelname.lower(),
            "message": record.getMessage(),
            "logger": record.name,
        }
        if ctx is not None:
            payload["trace_id"] = ctx.trace_id
            payload["span_id"] = ctx.span_id
        if record.__dict__.get("correlation_id"):
            payload["correlation_id"] = record.__dict__["correlation_id"]

        return json.dumps(payload)


def setup_logging() -> None:
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.handlers = [handler]

