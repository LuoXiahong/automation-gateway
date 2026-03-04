from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Protocol


class HttpClient(Protocol):
    async def post(  # pragma: no cover - protocol definition
        self,
        url: str,
        json: dict,
        headers: dict | None = None,
    ) -> object:
        ...


StressProvider = Callable[[], Awaitable[int]]


@dataclass
class DecisionWorker:
    stress_threshold: int
    internal_api_key: str
    node_gateway_url: str
    http_client: HttpClient
    stress_provider: StressProvider

    async def run_once(self) -> None:
        """
        Given current stress level from provider,
        When it is above threshold,
        Then send alert message to node-gateway internal API.
        """
        stress_value = await self.stress_provider()
        if stress_value <= self.stress_threshold:
            return

        url = f"{self.node_gateway_url.rstrip('/')}/api/internal/stress-alert"

        payload = {
            "stressValue": stress_value,
        }

        headers = {"x-internal-api-key": self.internal_api_key}

        await self.http_client.post(url, json=payload, headers=headers)

