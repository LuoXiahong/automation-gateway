"""Tests for HttpAlertPublisher adapter (infrastructure layer)."""
from __future__ import annotations

from typing import Any

import pytest

from app.application.ports import InternalApiKey, NodeGatewayUrl
from app.domain.model import StressSnapshot
from app.infrastructure.node_gateway.alert_publisher import HttpAlertPublisher


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


@pytest.mark.asyncio
async def test_given_snapshot_when_publish_then_posts_to_correct_url() -> None:
    """
    Given a StressSnapshot with stress_value=75,
    When alert publisher publishes,
    Then it POSTs to node-gateway stress-alert endpoint with correct payload and headers.
    """
    http = FakeHttpClient()
    publisher = HttpAlertPublisher(
        http_client=http,
        internal_api_key=InternalApiKey("secret-key"),
        node_gateway_url=NodeGatewayUrl("http://node-gateway:8000"),
    )

    await publisher.publish(StressSnapshot(stress_value=75))

    assert len(http.requests) == 1
    req = http.requests[0]
    assert req["url"] == "http://node-gateway:8000/api/internal/stress-alert"
    assert req["json"]["stressValue"] == 75
    assert "restingHeartRate" not in req["json"]
    assert req["headers"]["x-internal-api-key"] == "secret-key"
    assert "x-correlation-id" in req["headers"]


@pytest.mark.asyncio
async def test_given_snapshot_with_hr_when_publish_then_includes_resting_hr() -> None:
    """
    Given a StressSnapshot with resting_heart_rate=55,
    When alert publisher publishes,
    Then payload includes restingHeartRate.
    """
    http = FakeHttpClient()
    publisher = HttpAlertPublisher(
        http_client=http,
        internal_api_key=InternalApiKey("secret-key"),
        node_gateway_url=NodeGatewayUrl("http://node-gateway:8000"),
    )

    await publisher.publish(StressSnapshot(stress_value=80, resting_heart_rate=55))

    assert len(http.requests) == 1
    assert http.requests[0]["json"]["restingHeartRate"] == 55


@pytest.mark.asyncio
async def test_trailing_slash_in_url_handled() -> None:
    """
    Given node_gateway_url ends with trailing slash,
    When publishing,
    Then the URL is correctly formed without double slash.
    """
    http = FakeHttpClient()
    publisher = HttpAlertPublisher(
        http_client=http,
        internal_api_key=InternalApiKey("key"),
        node_gateway_url=NodeGatewayUrl("http://gw:8000/"),
    )

    await publisher.publish(StressSnapshot(stress_value=90))

    assert http.requests[0]["url"] == "http://gw:8000/api/internal/stress-alert"
