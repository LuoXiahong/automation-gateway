from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import NewType, Protocol

from pydantic import BaseModel, Field


InternalApiKey = NewType("InternalApiKey", str)
NodeGatewayUrl = NewType("NodeGatewayUrl", str)


class HttpClient(Protocol):
    async def post(  # pragma: no cover - protocol definition
        self,
        url: str,
        json: Mapping[str, object],
        headers: Mapping[str, str] | None = None,
    ) -> object: ...


@dataclass(frozen=True)
class StressSnapshot:
    stress_value: int
    resting_heart_rate: int | None = None


class StressAlertRequest(BaseModel):
    stressValue: int = Field()
    restingHeartRate: int | None = Field(default=None)


StressProvider = Callable[[], Awaitable[StressSnapshot]]


COOLDOWN_PERIOD = timedelta(hours=4)


@dataclass
class DecisionWorker:
    stress_threshold: int
    internal_api_key: InternalApiKey
    node_gateway_url: NodeGatewayUrl
    http_client: HttpClient
    stress_provider: StressProvider
    last_alert_time: datetime | None = field(default=None, init=False)

    async def run_once(self) -> None:
        """
        Given current stress level from provider,
        When it is above threshold and cooldown has elapsed (or no prior alert),
        Then send alert message to node-gateway internal API.
        """
        snapshot = await self.stress_provider()
        if snapshot.stress_value <= self.stress_threshold:
            return

        now = datetime.now(timezone.utc)
        if self.last_alert_time is not None and now - self.last_alert_time < COOLDOWN_PERIOD:
            return

        url = f"{self.node_gateway_url.rstrip('/')}/api/internal/stress-alert"

        payload_model = StressAlertRequest(
            stressValue=snapshot.stress_value,
            restingHeartRate=snapshot.resting_heart_rate,
        )
        payload = payload_model.model_dump(exclude_none=True)

        correlation_id = str(uuid.uuid4())
        headers = {
            "x-internal-api-key": self.internal_api_key,
            "x-correlation-id": correlation_id,
        }

        await self.http_client.post(url, json=payload, headers=headers)
        self.last_alert_time = now
