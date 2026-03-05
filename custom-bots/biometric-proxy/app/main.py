"""Backward-compat entrypoint; composition root lives in interfaces.http.app."""
from app.interfaces.http.app import fastapi_app as app, lifespan as lifespan
from app.infrastructure.garmin.stress_provider import (
    _extract_resting_hr as _extract_resting_hr,
    _extract_stress_value as _extract_stress_value,
    create_garmin_stress_provider as create_stress_provider,
)

__all__ = [
    "app",
    "create_stress_provider",
    "lifespan",
    "_extract_resting_hr",
    "_extract_stress_value",
]
