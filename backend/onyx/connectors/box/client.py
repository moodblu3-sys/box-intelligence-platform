from __future__ import annotations

import random
import time
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
BOX_AUTH_TIMEOUT_SECONDS = 30
BOX_METADATA_TIMEOUT_SECONDS = 60
BOX_DOWNLOAD_TIMEOUT_SECONDS = 120
BOX_MAX_RETRIES = 3
BOX_BACKOFF_BASE_SECONDS = 1.0
BOX_BACKOFF_MAX_SECONDS = 10.0
BOX_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


def _status_code(response: requests.Response | None) -> int | None:
    return response.status_code if response is not None else None


def _retry_after_seconds(response: requests.Response | None) -> float | None:
    if response is None:
        return None

    retry_after = response.headers.get("Retry-After")
    if not retry_after:
        return None

    try:
        return max(float(retry_after), 0)
    except ValueError:
        return None


def _backoff_seconds(attempt: int, response: requests.Response | None) -> float:
    retry_after = _retry_after_seconds(response)
    if retry_after is not None:
        return min(retry_after, BOX_BACKOFF_MAX_SECONDS)

    base = min(
        BOX_BACKOFF_BASE_SECONDS * (2**attempt),
        BOX_BACKOFF_MAX_SECONDS,
    )
    return random.uniform(base / 2, base)


def _should_retry(response: requests.Response | None) -> bool:
    status_code = _status_code(response)
    return status_code in BOX_RETRYABLE_STATUS_CODES


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
        response = self._request(
            "post",
            self.token_url,
            timeout=BOX_AUTH_TIMEOUT_SECONDS,
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "box_subject_type": box_subject_type,
                "box_subject_id": box_subject_id,
            },
        )
        token = response.json().get("access_token")
        if not token:
            raise ValueError("Box token response did not include access_token")
        return str(token)

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}

    def _request(
        self,
        method: str,
        url: str,
        timeout: int,
        **kwargs: Any,
    ) -> requests.Response:
        last_error: requests.HTTPError | requests.RequestException | None = None

        for attempt in range(BOX_MAX_RETRIES + 1):
            response: requests.Response | None = None
            try:
                response = requests.request(
                    method,
                    url,
                    timeout=timeout,
                    **kwargs,
                )
                response.raise_for_status()
                return response
            except requests.HTTPError as e:
                last_error = e
                response = e.response
                if attempt >= BOX_MAX_RETRIES or not _should_retry(response):
                    raise
                time.sleep(_backoff_seconds(attempt, response))
            except (
                requests.Timeout,
                requests.ConnectionError,
            ) as e:
                last_error = e
                if attempt >= BOX_MAX_RETRIES:
                    raise
                time.sleep(_backoff_seconds(attempt, response))

        if last_error is not None:
            raise last_error
        raise RuntimeError("Box request failed without an exception")

    def _get_json(
        self,
        path: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = self._request(
            "get",
            f"{self.api_base_url}{path}",
            timeout=BOX_METADATA_TIMEOUT_SECONDS,
            headers=self._headers,
            params=params,
        )
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
        response = self._request(
            "get",
            f"{self.api_base_url}/files/{file_id}/content",
            timeout=BOX_DOWNLOAD_TIMEOUT_SECONDS,
            headers=self._headers,
        )
        return response.content
