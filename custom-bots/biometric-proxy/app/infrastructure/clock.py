from __future__ import annotations

from datetime import datetime, timezone


class SystemClock:
    def now_utc(self) -> datetime:
        return datetime.now(timezone.utc)
