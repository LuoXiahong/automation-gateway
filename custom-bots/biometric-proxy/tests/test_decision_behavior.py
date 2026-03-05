from __future__ import annotations

import os
import sys
from typing import Any

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.decision import DecisionWorker, InternalApiKey, NodeGatewayUrl
from app.main import _extract_resting_hr, _extract_stress_value


class FakeHttpClient:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    async def post(
        self,
        url: str,
        json: dict[str, Any],
        headers: dict[str, str] | None = None,
    ) -> object:
        self.requests.append({"url": url, "json": json, "headers": headers})
        return object()


def make_stress_provider(stress: int, resting_hr: int | None = None):
    async def provider():
        from app.decision import StressSnapshot

        return StressSnapshot(stress_value=stress, resting_heart_rate=resting_hr)

    return provider


async def stress_provider_75():
    from app.decision import StressSnapshot

    return StressSnapshot(stress_value=75, resting_heart_rate=None)


@pytest.mark.asyncio
async def test_given_stress_75_when_worker_runs_then_posts_to_node_gateway() -> None:
    """
    Given stress is 75,
    When worker runs,
    Then it sends HTTP POST to node-gateway.
    """
    http_client = FakeHttpClient()

    worker = DecisionWorker(
        stress_threshold=70,
        internal_api_key=InternalApiKey("secret-key"),
        node_gateway_url=NodeGatewayUrl("http://node-gateway:8000"),
        http_client=http_client,
        stress_provider=stress_provider_75,
    )

    await worker.run_once()

    assert len(http_client.requests) == 1
    request = http_client.requests[0]

    assert request["url"] == "http://node-gateway:8000/api/internal/stress-alert"
    assert request["json"]["stressValue"] == 75
    assert request["headers"]["x-internal-api-key"] == "secret-key"
    assert "x-correlation-id" in request["headers"]
    assert "restingHeartRate" not in request["json"]


async def stress_provider_60():
    from app.decision import StressSnapshot

    return StressSnapshot(stress_value=60, resting_heart_rate=None)


@pytest.mark.asyncio
async def test_given_stress_below_threshold_when_worker_runs_then_does_not_post() -> None:
    """
    Given stress is 60,
    When worker runs,
    Then it does not send HTTP POST to node-gateway.
    """
    http_client = FakeHttpClient()

    worker = DecisionWorker(
        stress_threshold=70,
        internal_api_key=InternalApiKey("secret-key"),
        node_gateway_url=NodeGatewayUrl("http://node-gateway:8000"),
        http_client=http_client,
        stress_provider=stress_provider_60,
    )

    await worker.run_once()

    assert http_client.requests == []


@pytest.mark.asyncio
async def test_cooldown_4h_blocks_second_alert() -> None:
    """
    Given stress is above threshold and persists,
    When worker runs multiple times within 4 hours,
    Then only the first run sends HTTP POST; second run does not post (cooldown).
    """
    http_client = FakeHttpClient()

    worker = DecisionWorker(
        stress_threshold=70,
        internal_api_key=InternalApiKey("secret-key"),
        node_gateway_url=NodeGatewayUrl("http://node-gateway:8000"),
        http_client=http_client,
        stress_provider=stress_provider_75,
    )

    await worker.run_once()
    assert len(http_client.requests) == 1
    assert http_client.requests[0]["json"]["stressValue"] == 75

    await worker.run_once()
    assert len(http_client.requests) == 1, "Second run within cooldown must not send another alert"


@pytest.mark.asyncio
async def test_alert_payload_includes_resting_heart_rate() -> None:
    """
    Given stress provider returns stress and resting heart rate,
    When worker runs and posts alert,
    Then payload includes restingHeartRate.
    """
    http_client = FakeHttpClient()
    worker = DecisionWorker(
        stress_threshold=70,
        internal_api_key=InternalApiKey("secret-key"),
        node_gateway_url=NodeGatewayUrl("http://node-gateway:8000"),
        http_client=http_client,
        stress_provider=make_stress_provider(75, 55),
    )
    await worker.run_once()
    assert len(http_client.requests) == 1
    assert http_client.requests[0]["json"]["stressValue"] == 75
    assert http_client.requests[0]["json"]["restingHeartRate"] == 55


def test_given_response_with_all_day_stress_when_parsing_then_returns_summary_value() -> None:
    """
    Given Garmin response with allDayStress,
    When parsing,
    Then returns that value as integer.
    """
    raw: dict[str, Any] = {"allDayStress": 72.5}

    value = _extract_stress_value(raw)

    assert value == 72


def test_given_response_with_stress_values_list_when_parsing_then_returns_maximum() -> None:
    """
    Given Garmin response with stressLevelValues list,
    When parsing,
    Then returns maximum numeric value.
    """
    raw: dict[str, Any] = {
        "stressLevelValues": [
            {"value": 10},
            {"value": 35},
            {"value": 80},
        ]
    }

    value = _extract_stress_value(raw)

    assert value == 80


def test_given_unknown_response_shape_when_parsing_then_returns_zero() -> None:
    """
    Given unknown response shape,
    When parsing,
    Then returns zero as safe fallback.
    """
    raw: dict[str, Any] = {"unexpected": "structure"}

    value = _extract_stress_value(raw)

    assert value == 0


def test_given_response_with_resting_heart_rate_when_parsing_then_returns_value() -> None:
    """
    Given Garmin response with restingHeartRate,
    When parsing,
    Then returns that value as integer.
    """
    raw: dict[str, Any] = {"restingHeartRate": 55}

    value = _extract_resting_hr(raw)

    assert value == 55


def test_given_response_without_resting_heart_rate_when_parsing_then_returns_none() -> None:
    """
    Given response without restingHeartRate key or invalid type,
    When parsing,
    Then returns None.
    """
    assert _extract_resting_hr({"other": 1}) is None
    assert _extract_resting_hr({"restingHeartRate": "invalid"}) is None
