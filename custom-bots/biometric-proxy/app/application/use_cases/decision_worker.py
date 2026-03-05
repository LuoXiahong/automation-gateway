from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from app.application.ports import AlertPublisherPort, ClockPort, StressProvider
from app.domain.model import COOLDOWN_PERIOD


@dataclass
class DecisionWorker:
    stress_threshold: int
    stress_provider: StressProvider
    alert_publisher: AlertPublisherPort
    clock: ClockPort
    last_alert_time: datetime | None = field(default=None, init=False)

    async def run_once(self) -> None:
        """
        Given current stress level from provider,
        When it is above threshold and cooldown has elapsed (or no prior alert),
        Then publish alert via AlertPublisherPort.
        """
        snapshot = await self.stress_provider()
        if snapshot.stress_value <= self.stress_threshold:
            return

        now = self.clock.now_utc()
        if self.last_alert_time is not None and now - self.last_alert_time < COOLDOWN_PERIOD:
            return

        await self.alert_publisher.publish(snapshot)
        self.last_alert_time = now
