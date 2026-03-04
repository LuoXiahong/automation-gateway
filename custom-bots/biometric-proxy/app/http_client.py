from __future__ import annotations

from typing import Any

import httpx


class AsyncHttpClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=10.0)

    async def post(
        self,
        url: str,
        json: dict[str, Any],
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        return await self._client.post(url, json=json, headers=headers)

    async def aclose(self) -> None:
        await self._client.aclose()
