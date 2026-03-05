from __future__ import annotations

import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.semconv.resource import ResourceAttributes


def setup_tracing() -> None:
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318/v1/traces")

    resource = Resource(
        attributes={
            ResourceAttributes.SERVICE_NAME: "biometric-proxy",
        }
    )

    provider = TracerProvider(resource=resource)
    span_exporter = OTLPSpanExporter(endpoint=endpoint)
    span_processor = BatchSpanProcessor(span_exporter)

    provider.add_span_processor(span_processor)
    trace.set_tracer_provider(provider)


def get_active_trace_context() -> dict[str, str] | None:
    span = trace.get_current_span()
    if not span:
        return None
    ctx = span.get_span_context()
    return {
        "trace_id": ctx.trace_id,
        "span_id": ctx.span_id,
    }

