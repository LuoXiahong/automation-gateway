"""
Contract tests: verify biometric-proxy (producer) sends payloads
conforming to contracts/internal-api.openapi.yaml StressAlertRequest schema.

Schema contract:
  StressAlertRequest:
    required: [stressValue]
    properties:
      stressValue: number
      restingHeartRate: number (optional)
"""
from __future__ import annotations

from typing import Any

import pytest

from app.application.ports import InternalApiKey, NodeGatewayUrl
from app.domain.model import StressSnapshot
from app.infrastructure.node_gateway.alert_publisher import HttpAlertPublisher, StressAlertRequest


class CapturingHttpClient:
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
async def test_stress_alert_payload_has_required_stressValue_field() -> None:
    """
    Given a StressSnapshot,
    When HttpAlertPublisher publishes,
    Then payload contains required 'stressValue' as number (per OpenAPI spec).
    """
    http = CapturingHttpClient()
    publisher = HttpAlertPublisher(
        http_client=http,
        internal_api_key=InternalApiKey("key"),
        node_gateway_url=NodeGatewayUrl("http://gw:8000"),
    )

    await publisher.publish(StressSnapshot(stress_value=85))

    payload = http.requests[0]["json"]
    assert "stressValue" in payload
    assert isinstance(payload["stressValue"], int | float)


@pytest.mark.asyncio
async def test_stress_alert_payload_omits_null_optional_fields() -> None:
    """
    Given a StressSnapshot without resting_heart_rate,
    When published,
    Then payload does NOT include restingHeartRate key (exclude_none per spec).
    """
    http = CapturingHttpClient()
    publisher = HttpAlertPublisher(
        http_client=http,
        internal_api_key=InternalApiKey("key"),
        node_gateway_url=NodeGatewayUrl("http://gw:8000"),
    )

    await publisher.publish(StressSnapshot(stress_value=70, resting_heart_rate=None))

    payload = http.requests[0]["json"]
    assert "restingHeartRate" not in payload


@pytest.mark.asyncio
async def test_stress_alert_payload_includes_optional_restingHeartRate() -> None:
    """
    Given a StressSnapshot with resting_heart_rate=55,
    When published,
    Then payload includes restingHeartRate as number.
    """
    http = CapturingHttpClient()
    publisher = HttpAlertPublisher(
        http_client=http,
        internal_api_key=InternalApiKey("key"),
        node_gateway_url=NodeGatewayUrl("http://gw:8000"),
    )

    await publisher.publish(StressSnapshot(stress_value=90, resting_heart_rate=55))

    payload = http.requests[0]["json"]
    assert payload["restingHeartRate"] == 55
    assert isinstance(payload["restingHeartRate"], int | float)


@pytest.mark.asyncio
async def test_stress_alert_url_matches_contract_path() -> None:
    """
    Given node_gateway_url,
    When published,
    Then POST URL is {base}/api/internal/stress-alert (per OpenAPI paths).
    """
    http = CapturingHttpClient()
    publisher = HttpAlertPublisher(
        http_client=http,
        internal_api_key=InternalApiKey("key"),
        node_gateway_url=NodeGatewayUrl("http://gw:8000"),
    )

    await publisher.publish(StressSnapshot(stress_value=80))

    assert http.requests[0]["url"] == "http://gw:8000/api/internal/stress-alert"


@pytest.mark.asyncio
async def test_stress_alert_headers_include_required_api_key_and_correlation() -> None:
    """
    Given the contract requires x-internal-api-key and x-correlation-id headers,
    When published,
    Then both headers are present.
    """
    http = CapturingHttpClient()
    publisher = HttpAlertPublisher(
        http_client=http,
        internal_api_key=InternalApiKey("my-api-key"),
        node_gateway_url=NodeGatewayUrl("http://gw:8000"),
    )

    await publisher.publish(StressSnapshot(stress_value=80))

    headers = http.requests[0]["headers"]
    assert headers["x-internal-api-key"] == "my-api-key"
    assert "x-correlation-id" in headers
    assert len(headers["x-correlation-id"]) > 0


def test_pydantic_model_serialization_matches_openapi_field_names() -> None:
    """
    Given StressAlertRequest model,
    When serialized with model_dump(),
    Then field names match OpenAPI schema (camelCase: stressValue, restingHeartRate).
    """
    model = StressAlertRequest(stressValue=85, restingHeartRate=55)
    data = model.model_dump()

    assert "stressValue" in data
    assert "restingHeartRate" in data


def test_pydantic_model_exclude_none_drops_optional_fields() -> None:
    """
    Given StressAlertRequest with restingHeartRate=None,
    When serialized with exclude_none=True,
    Then restingHeartRate is omitted.
    """
    model = StressAlertRequest(stressValue=85, restingHeartRate=None)
    data = model.model_dump(exclude_none=True)

    assert "stressValue" in data
    assert "restingHeartRate" not in data
