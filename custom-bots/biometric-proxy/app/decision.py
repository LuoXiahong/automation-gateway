from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Protocol


class HttpClient(Protocol):
    async def post(  # pragma: no cover - protocol definition
        self,
        url: str,
        json: dict,
        headers: dict | None = None,
    ) -> object: ...


@dataclass(frozen=True)
class StressSnapshot:
    stress_value: int
    resting_heart_rate: int | None = None


StressProvider = Callable[[], Awaitable[StressSnapshot]]


COOLDOWN_PERIOD = timedelta(hours=4)


@dataclass
class DecisionWorker:
    stress_threshold: int
    internal_api_key: str
    node_gateway_url: str
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

        payload: dict[str, int] = {
            "stressValue": snapshot.stress_value,
        }
        if snapshot.resting_heart_rate is not None:
            payload["restingHeartRate"] = snapshot.resting_heart_rate

        headers = {"x-internal-api-key": self.internal_api_key}

        await self.http_client.post(url, json=payload, headers=headers)
        self.last_alert_time = now
