"""BDD-style tests for DecisionWorker use-case (pure application layer)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from app.application.use_cases.decision_worker import DecisionWorker
from app.domain.model import COOLDOWN_PERIOD, StressSnapshot
from app.infrastructure.garmin.stress_provider import _extract_resting_hr, _extract_stress_value


class FakeClock:
    def __init__(self, start: datetime | None = None) -> None:
        self._now = start or datetime(2025, 6, 1, 12, 0, tzinfo=timezone.utc)

    def now_utc(self) -> datetime:
        return self._now

    def advance(self, delta: timedelta) -> None:
        self._now += delta


class FakeAlertPublisher:
    def __init__(self) -> None:
        self.published: list[StressSnapshot] = []

    async def publish(self, snapshot: StressSnapshot) -> None:
        self.published.append(snapshot)


def make_stress_provider(stress: int, resting_hr: int | None = None):
    async def provider() -> StressSnapshot:
        return StressSnapshot(stress_value=stress, resting_heart_rate=resting_hr)

    return provider


@pytest.mark.asyncio
async def test_given_stress_75_when_worker_runs_then_publishes_alert() -> None:
    """
    Given stress is 75 (above threshold 70),
    When worker runs,
    Then it publishes an alert via AlertPublisherPort.
    """
    publisher = FakeAlertPublisher()
    clock = FakeClock()

    worker = DecisionWorker(
        stress_threshold=70,
        stress_provider=make_stress_provider(75),
        alert_publisher=publisher,
        clock=clock,
    )

    await worker.run_once()

    assert len(publisher.published) == 1
    assert publisher.published[0].stress_value == 75


@pytest.mark.asyncio
async def test_given_stress_below_threshold_when_worker_runs_then_does_not_publish() -> None:
    """
    Given stress is 60 (below threshold 70),
    When worker runs,
    Then it does not publish any alert.
    """
    publisher = FakeAlertPublisher()
    clock = FakeClock()

    worker = DecisionWorker(
        stress_threshold=70,
        stress_provider=make_stress_provider(60),
        alert_publisher=publisher,
        clock=clock,
    )

    await worker.run_once()

    assert publisher.published == []


@pytest.mark.asyncio
async def test_cooldown_4h_blocks_second_alert() -> None:
    """
    Given stress is above threshold and persists,
    When worker runs twice within 4h window,
    Then only the first run publishes; second is blocked by cooldown.
    """
    publisher = FakeAlertPublisher()
    clock = FakeClock()

    worker = DecisionWorker(
        stress_threshold=70,
        stress_provider=make_stress_provider(75),
        alert_publisher=publisher,
        clock=clock,
    )

    await worker.run_once()
    assert len(publisher.published) == 1

    clock.advance(timedelta(hours=1))
    await worker.run_once()
    assert len(publisher.published) == 1, "Second run within cooldown must not publish"


@pytest.mark.asyncio
async def test_cooldown_expires_allows_second_alert() -> None:
    """
    Given stress is above threshold,
    When worker runs after cooldown period (4h+) has elapsed,
    Then it publishes a second alert.
    """
    publisher = FakeAlertPublisher()
    clock = FakeClock()

    worker = DecisionWorker(
        stress_threshold=70,
        stress_provider=make_stress_provider(80),
        alert_publisher=publisher,
        clock=clock,
    )

    await worker.run_once()
    assert len(publisher.published) == 1

    clock.advance(COOLDOWN_PERIOD + timedelta(minutes=1))
    await worker.run_once()
    assert len(publisher.published) == 2


@pytest.mark.asyncio
async def test_alert_snapshot_includes_resting_heart_rate() -> None:
    """
    Given stress provider returns stress and resting heart rate,
    When worker publishes alert,
    Then the snapshot includes restingHeartRate.
    """
    publisher = FakeAlertPublisher()
    clock = FakeClock()

    worker = DecisionWorker(
        stress_threshold=70,
        stress_provider=make_stress_provider(75, 55),
        alert_publisher=publisher,
        clock=clock,
    )

    await worker.run_once()
    assert len(publisher.published) == 1
    assert publisher.published[0].stress_value == 75
    assert publisher.published[0].resting_heart_rate == 55


def test_given_response_with_all_day_stress_when_parsing_then_returns_summary_value() -> None:
    """
    Given Garmin response with allDayStress,
    When parsing,
    Then returns that value as integer.
    """
    raw: dict[str, Any] = {"allDayStress": 72.5}
    assert _extract_stress_value(raw) == 72


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
    assert _extract_stress_value(raw) == 80


def test_given_unknown_response_shape_when_parsing_then_returns_zero() -> None:
    """
    Given unknown response shape,
    When parsing,
    Then returns zero as safe fallback.
    """
    raw: dict[str, Any] = {"unexpected": "structure"}
    assert _extract_stress_value(raw) == 0


def test_given_response_with_resting_heart_rate_when_parsing_then_returns_value() -> None:
    raw: dict[str, Any] = {"restingHeartRate": 55}
    assert _extract_resting_hr(raw) == 55


def test_given_response_without_resting_heart_rate_when_parsing_then_returns_none() -> None:
    assert _extract_resting_hr({"other": 1}) is None
    assert _extract_resting_hr({"restingHeartRate": "invalid"}) is None
