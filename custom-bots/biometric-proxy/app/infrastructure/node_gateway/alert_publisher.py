from __future__ import annotations

import uuid

from pydantic import BaseModel, Field
from opentelemetry import trace

from app.application.ports import InternalApiKey, NodeGatewayUrl
from app.domain.model import StressSnapshot
from app.infrastructure.metrics import alerts_published_total


class StressAlertRequest(BaseModel):
    stressValue: int = Field()
    restingHeartRate: int | None = Field(default=None)


class HttpAlertPublisher:
    """Adapter: publishes stress alerts to node-gateway via HTTP."""

    def __init__(
        self,
        http_client: object,
        internal_api_key: InternalApiKey,
        node_gateway_url: NodeGatewayUrl,
    ) -> None:
        self._http_client = http_client
        self._api_key = internal_api_key
        self._base_url = node_gateway_url

    async def publish(self, snapshot: StressSnapshot) -> None:
        url = f"{self._base_url.rstrip('/')}/api/internal/stress-alert"
        payload = StressAlertRequest(
            stressValue=snapshot.stress_value,
            restingHeartRate=snapshot.resting_heart_rate,
        ).model_dump(exclude_none=True)

        correlation_id = str(uuid.uuid4())
        headers = {
            "x-internal-api-key": self._api_key,
            "x-correlation-id": correlation_id,
        }

        span = trace.get_current_span()
        span.set_attribute("messaging.correlation_id", correlation_id)

        await self._http_client.post(url, json=payload, headers=headers)  # type: ignore[attr-defined]
        alerts_published_total.inc()
