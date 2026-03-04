from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import date
from typing import Any, AsyncGenerator

import logging
from fastapi import FastAPI
from garminconnect import Garmin

from .config import Settings
from .decision import DecisionWorker
from .http_client import AsyncHttpClient


def _extract_stress_value(raw: Any) -> int:
    """
    Best-effort extraction of a single stress value from Garmin API response.
    Falls back to 0 if structure is unknown.
    """
    if isinstance(raw, dict):
        # Newer APIs may provide 'allDayStress' or similar summary metrics
        summary_value = raw.get("allDayStress")
        if isinstance(summary_value, (int, float)):
            return int(summary_value)

        values = raw.get("stressLevelValues")
        if isinstance(values, list):
            numeric_values = []
            for item in values:
                if isinstance(item, dict):
                    value = item.get("value")
                    if isinstance(value, (int, float)):
                        numeric_values.append(int(value))
            if numeric_values:
                return max(numeric_values)

    return 0


def create_stress_provider(settings: Settings):
    async def provider() -> int:
        def _fetch() -> int:
            garmin = Garmin(
                email=settings.garmin_email,
                password=settings.garmin_password,
                is_cn=False,
                return_on_mfa=True,
            )
            garmin.login()
            raw = garmin.get_stress_data(date.today().isoformat())
            return _extract_stress_value(raw)

        return await asyncio.to_thread(_fetch)

    return provider


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    settings = Settings.from_env()
    http_client = AsyncHttpClient()

    worker = DecisionWorker(
        stress_threshold=settings.stress_threshold,
        internal_api_key=settings.internal_api_key,
        node_gateway_url=settings.node_gateway_url,
        http_client=http_client,
        stress_provider=create_stress_provider(settings),
    )

    stop_event = asyncio.Event()

    async def _loop() -> None:
        while not stop_event.is_set():
            try:
                await worker.run_once()
            except Exception:  # pragma: no cover - defensive, behaviour verified indirectly
                # Avoid crashing the loop on transient errors (network, Garmin API, etc.)
                logging.exception("Biometric decision worker iteration failed")
                # Small backoff to avoid tight failure loops
                await asyncio.sleep(30)

            try:
                await asyncio.wait_for(stop_event.wait(), timeout=15 * 60)
            except asyncio.TimeoutError:
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

