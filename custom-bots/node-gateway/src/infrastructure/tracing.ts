import { diag, DiagConsoleLogger, DiagLogLevel, trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

export function setupTracing(): void {
  const exporterEndpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://otel-collector:4318/v1/traces";

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "node-gateway",
  });

  const provider = new NodeTracerProvider({ resource });

  const exporter = new OTLPTraceExporter({ url: exporterEndpoint });

  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  provider.register();

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [new HttpInstrumentation(), new FastifyInstrumentation(), new PgInstrumentation()],
  });
}

export function getActiveTraceContext():
  | {
      traceId: string;
      spanId: string;
    }
  | undefined {
  const span = trace.getActiveSpan();
  if (!span) {
    return undefined;
  }
  const ctx = span.spanContext();
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
  };
}

