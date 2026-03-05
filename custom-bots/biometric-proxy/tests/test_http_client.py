"""Tests for AsyncHttpClient (infrastructure adapter) status handling."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.domain.errors import (
    NodeGatewayPermanentError,
    NodeGatewayTransientError,
    NodeGatewayUnauthorizedError,
)
from app.http_client import AsyncHttpClient


@pytest.mark.asyncio
async def test_given_401_response_when_post_then_raises_unauthorized() -> None:
    """Given server returns 401, When post, Then raises NodeGatewayUnauthorizedError."""
    client = AsyncHttpClient()
    try:
        with patch.object(
            client._client,
            "post",
            new_callable=AsyncMock,
            return_value=httpx.Response(401, text="Unauthorized"),
        ):
            with pytest.raises(NodeGatewayUnauthorizedError) as exc_info:
                await client.post("http://test/api", json={"k": 1}, headers=None)
            assert "401" in str(exc_info.value)
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_given_500_response_when_post_then_raises_transient() -> None:
    """Given server returns 500, When post, Then raises NodeGatewayTransientError."""
    client = AsyncHttpClient()
    try:
        with patch.object(
            client._client,
            "post",
            new_callable=AsyncMock,
            return_value=httpx.Response(500, text="Internal Server Error"),
        ):
            with pytest.raises(NodeGatewayTransientError) as exc_info:
                await client.post("http://test/api", json={"k": 1}, headers=None)
            assert "500" in str(exc_info.value)
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_given_400_response_when_post_then_raises_permanent() -> None:
    """Given server returns 400, When post, Then raises NodeGatewayPermanentError."""
    client = AsyncHttpClient()
    try:
        with patch.object(
            client._client,
            "post",
            new_callable=AsyncMock,
            return_value=httpx.Response(400, text="Bad Request"),
        ):
            with pytest.raises(NodeGatewayPermanentError) as exc_info:
                await client.post("http://test/api", json={"k": 1}, headers=None)
            assert "400" in str(exc_info.value)
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_given_connect_error_when_post_then_raises_transient() -> None:
    """Given connection error, When post, Then raises NodeGatewayTransientError."""
    client = AsyncHttpClient()
    try:
        with patch.object(
            client._client,
            "post",
            new_callable=AsyncMock,
            side_effect=httpx.ConnectError("Connection refused"),
        ):
            with pytest.raises(NodeGatewayTransientError) as exc_info:
                await client.post("http://test/api", json={"k": 1}, headers=None)
            assert "Connection" in str(exc_info.value)
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_given_2xx_response_when_post_then_returns_response() -> None:
    """Given server returns 200, When post, Then returns response."""
    client = AsyncHttpClient()
    try:
        with patch.object(
            client._client,
            "post",
            new_callable=AsyncMock,
            return_value=httpx.Response(200, json={"ok": True}),
        ):
            resp = await client.post("http://test/api", json={"k": 1}, headers=None)
            assert resp.status_code == 200
            assert resp.json() == {"ok": True}
    finally:
        await client.aclose()
