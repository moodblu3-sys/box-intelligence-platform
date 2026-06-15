from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import requests

from onyx.connectors.box.models import BoxItem

BOX_API_BASE_URL = "https://api.box.com/2.0"
BOX_TOKEN_URL = "https://api.box.com/oauth2/token"
BOX_ITEM_FIELDS = ",".join(
    [
        "id",
        "type",
        "name",
        "size",
        "modified_at",
        "owned_by",
        "path_collection",
        "sha1",
        "parent",
        "web_url",
    ]
)
BOX_FOLDER_FIELDS = ",".join(
    [
        "id",
        "type",
        "name",
        "size",
        "modified_at",
        "owned_by",
        "path_collection",
        "parent",
        "web_url",
    ]
)
BOX_MAX_PAGE_LIMIT = 1000


class BoxClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        box_subject_type: str,
        box_subject_id: str,
        api_base_url: str = BOX_API_BASE_URL,
        token_url: str = BOX_TOKEN_URL,
    ) -> None:
        self.api_base_url = api_base_url.rstrip("/")
        self.token_url = token_url
        self.access_token = self._fetch_access_token(
            client_id=client_id,
            client_secret=client_secret,
            box_subject_type=box_subject_type,
            box_subject_id=box_subject_id,
        )

    def _fetch_access_token(
        self,
        client_id: str,
        client_secret: str,
        box_subject_type: str,
        box_subject_id: str,
    ) -> str:
        response = requests.post(
            self.token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "box_subject_type": box_subject_type,
                "box_subject_id": box_subject_id,
            },
            timeout=30,
        )
        response.raise_for_status()
        token = response.json().get("access_token")
        if not token:
            raise ValueError("Box token response did not include access_token")
        return str(token)

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}

    def _get_json(
        self,
        path: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = requests.get(
            f"{self.api_base_url}{path}",
            headers=self._headers,
            params=params,
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def get_folder(self, folder_id: str) -> BoxItem:
        data = self._get_json(
            f"/folders/{folder_id}",
            params={"fields": BOX_FOLDER_FIELDS},
        )
        return BoxItem.from_json(data)

    def iter_folder_items(self, folder_id: str, limit: int) -> Iterator[BoxItem]:
        page_limit = min(max(limit, 1), BOX_MAX_PAGE_LIMIT)
        offset = 0
        while True:
            data = self._get_json(
                f"/folders/{folder_id}/items",
                params={
                    "fields": BOX_ITEM_FIELDS,
                    "limit": page_limit,
                    "offset": offset,
                },
            )
            entries = data.get("entries", [])
            for entry in entries:
                yield BoxItem.from_json(entry)

            total_count = int(data.get("total_count") or 0)
            offset += int(data.get("limit") or page_limit)
            if offset >= total_count or not entries:
                break

    def download_file(self, file_id: str) -> bytes:
        response = requests.get(
            f"{self.api_base_url}/files/{file_id}/content",
            headers=self._headers,
            timeout=120,
        )
        response.raise_for_status()
        return response.content
