from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True)
class StressSnapshot:
    stress_value: int
    resting_heart_rate: int | None = None


COOLDOWN_PERIOD = timedelta(hours=4)
