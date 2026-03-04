from __future__ import annotations

from typing import Any

import httpx

from .errors import (
    NodeGatewayPermanentError,
    NodeGatewayTransientError,
    NodeGatewayUnauthorizedError,
)


class AsyncHttpClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=10.0)

    async def post(
        self,
        url: str,
        json: dict[str, Any],
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        try:
            response = await self._client.post(url, json=json, headers=headers)
        except (
            httpx.TimeoutException,
            httpx.ConnectError,
            httpx.ReadError,
        ) as exc:
            raise NodeGatewayTransientError(str(exc)) from exc

        if response.status_code == 401:
            raise NodeGatewayUnauthorizedError(f"Node-gateway returned 401: {response.text[:200]}")
        if 400 <= response.status_code < 500:
            raise NodeGatewayPermanentError(
                f"Node-gateway returned {response.status_code}: {response.text[:200]}"
            )
        if response.status_code >= 500:
            raise NodeGatewayTransientError(
                f"Node-gateway returned {response.status_code}: {response.text[:200]}"
            )

        return response

    async def aclose(self) -> None:
        await self._client.aclose()
