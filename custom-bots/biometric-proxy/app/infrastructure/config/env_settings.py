from __future__ import annotations

import os
from dataclasses import dataclass


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable {name}")
    return value


@dataclass(frozen=True)
class Settings:
    garmin_email: str
    garmin_password: str
    internal_api_key: str
    node_gateway_url: str
    stress_threshold: int

    @staticmethod
    def from_env() -> Settings:
        stress_threshold_raw = os.getenv("STRESS_ALERT_THRESHOLD", "70")
        try:
            stress_threshold = int(stress_threshold_raw)
        except ValueError:
            raise RuntimeError("STRESS_ALERT_THRESHOLD must be an integer") from None

        return Settings(
            garmin_email=_require_env("GARMIN_EMAIL"),
            garmin_password=_require_env("GARMIN_PASSWORD"),
            internal_api_key=_require_env("INTERNAL_API_KEY"),
            node_gateway_url=_require_env("NODE_GATEWAY_URL"),
            stress_threshold=stress_threshold,
        )
