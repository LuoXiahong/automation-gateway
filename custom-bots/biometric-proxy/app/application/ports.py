from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import NewType, Protocol

from app.domain.model import StressSnapshot

InternalApiKey = NewType("InternalApiKey", str)
NodeGatewayUrl = NewType("NodeGatewayUrl", str)

StressProvider = Callable[[], Awaitable[StressSnapshot]]


class AlertPublisherPort(Protocol):
    async def publish(self, snapshot: StressSnapshot) -> None:  # pragma: no cover
        ...


class ClockPort(Protocol):
    def now_utc(self) -> datetime:  # pragma: no cover
        ...
