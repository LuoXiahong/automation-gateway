import client, { type Registry, type Histogram, type Counter } from "prom-client";

export interface GatewayMetrics {
  readonly registry: Registry;
  readonly httpRequestDurationSeconds: Histogram<string>;
  readonly outboxProcessedTotal: Counter<string>;
  readonly outboxFailedTotal: Counter<string>;
  readonly outboxDeadLetterTotal: Counter<string>;
  readonly outboxRetryScheduledTotal: Counter<string>;
}

const registry = new client.Registry();

client.collectDefaultMetrics({
  register: registry,
});

const httpRequestDurationSeconds = new client.Histogram({
  name: "node_gateway_http_request_duration_seconds",
  help: "HTTP request duration in seconds for node-gateway",
  labelNames: ["method", "route", "status_code"],
  registers: [registry],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

const outboxProcessedTotal = new client.Counter({
  name: "node_gateway_outbox_processed_total",
  help: "Total number of successfully processed outbox events",
  registers: [registry],
});

const outboxFailedTotal = new client.Counter({
  name: "node_gateway_outbox_failed_total",
  help: "Total number of outbox events permanently failed (4xx from n8n)",
  registers: [registry],
});

const outboxDeadLetterTotal = new client.Counter({
  name: "node_gateway_outbox_dead_letter_total",
  help: "Total number of outbox events moved to dead letter after max retries",
  registers: [registry],
});

const outboxRetryScheduledTotal = new client.Counter({
  name: "node_gateway_outbox_retry_scheduled_total",
  help: "Total number of outbox events scheduled for retry",
  registers: [registry],
});

export const gatewayMetrics: GatewayMetrics = {
  registry,
  httpRequestDurationSeconds,
  outboxProcessedTotal,
  outboxFailedTotal,
  outboxDeadLetterTotal,
  outboxRetryScheduledTotal,
};

