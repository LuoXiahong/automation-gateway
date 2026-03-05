from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import date
from typing import Any

from fastapi import FastAPI
from garminconnect import Garmin

from .config import Settings
from .decision import DecisionWorker, InternalApiKey, NodeGatewayUrl, StressSnapshot
from .errors import (
    GarminAuthError,
    GarminTransientError,
    NodeGatewayPermanentError,
    NodeGatewayTransientError,
    NodeGatewayUnauthorizedError,
)
from .http_client import AsyncHttpClient


def _extract_stress_value(raw: Any) -> int:
    """
    Best-effort extraction of a single stress value from Garmin API response.
    Falls back to 0 if structure is unknown.
    """
    if isinstance(raw, dict):
        # Newer APIs may provide 'allDayStress' or similar summary metrics
        summary_value = raw.get("allDayStress")
        if isinstance(summary_value, int | float):
            return int(summary_value)

        values = raw.get("stressLevelValues")
        if isinstance(values, list):
            numeric_values = []
            for item in values:
                if isinstance(item, dict):
                    value = item.get("value")
                    if isinstance(value, int | float):
                        numeric_values.append(int(value))
            if numeric_values:
                return max(numeric_values)

    return 0


def _extract_resting_hr(raw: Any) -> int | None:
    """
    Best-effort extraction of resting heart rate from Garmin API response.
    Returns None if key is missing or value is not numeric.
    """
    if not isinstance(raw, dict):
        return None
    value = raw.get("restingHeartRate")
    if isinstance(value, int | float):
        return int(value)
    return None


def create_stress_provider(settings: Settings):
    async def provider() -> StressSnapshot:
        def _fetch() -> StressSnapshot:
            try:
                garmin = Garmin(
                    email=settings.garmin_email,
                    password=settings.garmin_password,
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


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    settings = Settings.from_env()
    http_client = AsyncHttpClient()

    worker = DecisionWorker(
        stress_threshold=settings.stress_threshold,
        internal_api_key=InternalApiKey(settings.internal_api_key),
        node_gateway_url=NodeGatewayUrl(settings.node_gateway_url),
        http_client=http_client,
        stress_provider=create_stress_provider(settings),
    )

    stop_event = asyncio.Event()
    failure_count = 0
    base_delay_s = 30
    max_delay_s = 900

    def backoff_seconds() -> float:
        delay = min(base_delay_s * (2**failure_count), max_delay_s)
        jitter = random.uniform(0, 0.1 * delay)  # noqa: S311
        return min(delay + jitter, max_delay_s)

    async def _loop() -> None:
        nonlocal failure_count
        while not stop_event.is_set():
            try:
                await worker.run_once()
                failure_count = 0
            except NodeGatewayUnauthorizedError as e:
                logging.critical("Node-gateway auth failed (401); check INTERNAL_API_KEY: %s", e)
                failure_count += 1
                await asyncio.sleep(backoff_seconds())
                continue
            except NodeGatewayPermanentError as e:
                logging.error("Node-gateway client error (4xx): %s", e)
                failure_count += 1
                await asyncio.sleep(backoff_seconds())
                continue
            except NodeGatewayTransientError as e:
                logging.warning("Node-gateway transient error (5xx/timeout), will retry: %s", e)
                failure_count += 1
                await asyncio.sleep(backoff_seconds())
                continue
            except GarminAuthError as e:
                logging.warning("Garmin auth/session expired, next iteration will re-login: %s", e)
                failure_count += 1
                await asyncio.sleep(backoff_seconds())
                continue
            except GarminTransientError as e:
                logging.warning("Garmin/network transient error, will retry: %s", e)
                failure_count += 1
                await asyncio.sleep(backoff_seconds())
                continue
            except Exception:  # pragma: no cover - defensive
                logging.exception("Biometric decision worker iteration failed")
                failure_count += 1
                await asyncio.sleep(backoff_seconds())
                continue

            try:
                await asyncio.wait_for(stop_event.wait(), timeout=15 * 60)
            except TimeoutError:
                continue

    task = asyncio.create_task(_loop())

    try:
        yield
    finally:
        stop_event.set()
        await task
        await http_client.aclose()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
