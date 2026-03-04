from __future__ import annotations

import os
import sys
from typing import Any, Dict, List, Optional

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.decision import DecisionWorker
from app.main import _extract_stress_value


class FakeHttpClient:
    def __init__(self) -> None:
        self.requests: List[Dict[str, Any]] = []

    async def post(
        self,
        url: str,
        json: Dict[str, Any],
        headers: Optional[Dict[str, str]] = None,
    ) -> object:
        self.requests.append({"url": url, "json": json, "headers": headers})
        return object()


async def stress_provider_75() -> int:
    return 75


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
        internal_api_key="secret-key",
        node_gateway_url="http://node-gateway:8000",
        http_client=http_client,
        stress_provider=stress_provider_75,
    )

    await worker.run_once()

    assert len(http_client.requests) == 1
    request = http_client.requests[0]

    assert request["url"] == "http://node-gateway:8000/api/internal/stress-alert"
    assert request["json"]["stressValue"] == 75
    assert request["headers"]["x-internal-api-key"] == "secret-key"


async def stress_provider_60() -> int:
    return 60


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
        internal_api_key="secret-key",
        node_gateway_url="http://node-gateway:8000",
        http_client=http_client,
        stress_provider=stress_provider_60,
    )

    await worker.run_once()

    assert http_client.requests == []


def test_given_response_with_all_day_stress_when_parsing_then_returns_summary_value() -> None:
    """
    Given Garmin response with allDayStress,
    When parsing,
    Then returns that value as integer.
    """
    raw: Dict[str, Any] = {"allDayStress": 72.5}

    value = _extract_stress_value(raw)

    assert value == 72


def test_given_response_with_stress_values_list_when_parsing_then_returns_maximum() -> None:
    """
    Given Garmin response with stressLevelValues list,
    When parsing,
    Then returns maximum numeric value.
    """
    raw: Dict[str, Any] = {
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
    raw: Dict[str, Any] = {"unexpected": "structure"}

    value = _extract_stress_value(raw)

    assert value == 0

