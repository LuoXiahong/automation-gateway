from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.application.ports import InternalApiKey, NodeGatewayUrl
from app.application.use_cases.decision_worker import DecisionWorker
from app.domain.errors import (
    GarminAuthError,
    GarminTransientError,
    NodeGatewayPermanentError,
    NodeGatewayTransientError,
    NodeGatewayUnauthorizedError,
)
from app.infrastructure.clock import SystemClock
from app.infrastructure.config.env_settings import Settings
from app.infrastructure.garmin.stress_provider import create_garmin_stress_provider
from app.infrastructure.node_gateway.alert_publisher import HttpAlertPublisher
from app.http_client import AsyncHttpClient


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    settings = Settings.from_env()
    http_client = AsyncHttpClient()

    alert_publisher = HttpAlertPublisher(
        http_client=http_client,
        internal_api_key=InternalApiKey(settings.internal_api_key),
        node_gateway_url=NodeGatewayUrl(settings.node_gateway_url),
    )

    worker = DecisionWorker(
        stress_threshold=settings.stress_threshold,
        stress_provider=create_garmin_stress_provider(
            settings.garmin_email, settings.garmin_password
        ),
        alert_publisher=alert_publisher,
        clock=SystemClock(),
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


fastapi_app = FastAPI(lifespan=lifespan)


@fastapi_app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
