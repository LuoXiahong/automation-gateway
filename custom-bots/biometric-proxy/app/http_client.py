from __future__ import annotations

from typing import Any, Dict, Optional

import httpx


class AsyncHttpClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=10.0)

    async def post(
        self,
        url: str,
        json: Dict[str, Any],
        headers: Optional[Dict[str, str]] = None,
    ) -> httpx.Response:
        return await self._client.post(url, json=json, headers=headers)

    async def aclose(self) -> None:
        await self._client.aclose()


