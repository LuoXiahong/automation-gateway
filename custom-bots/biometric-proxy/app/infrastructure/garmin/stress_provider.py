from __future__ import annotations

import asyncio
from datetime import date
from typing import Any

from garminconnect import Garmin

from app.domain.errors import GarminAuthError, GarminTransientError
from app.domain.model import StressSnapshot


def _extract_stress_value(raw: Any) -> int:
    """Best-effort extraction of a single stress value from Garmin API response."""
    if not isinstance(raw, dict):
        return 0

    summary_value = raw.get("allDayStress")
    if isinstance(summary_value, int | float):
        return int(summary_value)

    values = raw.get("stressLevelValues")
    if isinstance(values, list):
        numeric_values = [
            int(item["value"])
            for item in values
            if isinstance(item, dict) and isinstance(item.get("value"), int | float)
        ]
        if numeric_values:
            return max(numeric_values)

    return 0


def _extract_resting_hr(raw: Any) -> int | None:
    """Best-effort extraction of resting heart rate from Garmin API response."""
    if not isinstance(raw, dict):
        return None
    value = raw.get("restingHeartRate")
    if isinstance(value, int | float):
        return int(value)
    return None


def create_garmin_stress_provider(email: str, password: str) -> ...:
    async def provider() -> StressSnapshot:
        def _fetch() -> StressSnapshot:
            try:
                garmin = Garmin(
                    email=email,
                    password=password,
                    is_cn=False,
                    return_on_mfa=True,
                )
                garmin.login()
                raw = garmin.get_stress_data(date.today().isoformat())
                return StressSnapshot(
                    stress_value=_extract_stress_value(raw),
                    resting_heart_rate=_extract_resting_hr(raw),
                )
            except Exception as e:  # noqa: BLE001 - garminconnect may raise broadly
                msg = str(e).lower()
                if "401" in msg or "unauthorized" in msg or "login" in msg or "session" in msg:
                    raise GarminAuthError(msg) from e
                raise GarminTransientError(msg) from e

        return await asyncio.to_thread(_fetch)

    return provider
