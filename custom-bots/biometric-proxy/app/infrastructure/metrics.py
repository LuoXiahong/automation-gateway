from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, CONTENT_TYPE_LATEST, generate_latest

registry = CollectorRegistry()

worker_runs_total = Counter(
    "biometric_worker_runs_total",
    "Total number of decision worker iterations, partitioned by result.",
    labelnames=["result"],
    registry=registry,
)

worker_errors_total = Counter(
    "biometric_worker_errors_total",
    "Total number of worker errors by error type.",
    labelnames=["error_type"],
    registry=registry,
)

alerts_published_total = Counter(
    "biometric_alerts_published_total",
    "Total number of stress alerts published towards node-gateway.",
    registry=registry,
)

backoff_seconds_gauge = Gauge(
    "biometric_worker_backoff_seconds",
    "Current backoff duration in seconds before next worker iteration.",
    registry=registry,
)

iteration_duration_seconds = Histogram(
    "biometric_worker_iteration_duration_seconds",
    "Duration of a single worker.run_once() iteration in seconds.",
    registry=registry,
    buckets=[0.5, 1, 2, 5, 10, 30, 60],
)


def render_prometheus_metrics() -> tuple[bytes, str]:
    """Return Prometheus exposition payload and content type."""
    payload = generate_latest(registry)
    return payload, CONTENT_TYPE_LATEST

