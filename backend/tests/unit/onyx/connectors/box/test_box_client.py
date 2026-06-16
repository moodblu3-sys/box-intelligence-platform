from __future__ import annotations

from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
import requests

from onyx.connectors.box.client import BoxClient


def _response(
    status_code: int,
    json_data: dict[str, object] | None = None,
    headers: dict[str, str] | None = None,
) -> MagicMock:
    response = MagicMock(spec=requests.Response)
    response.status_code = status_code
    response.headers = headers or {}
    response.text = ""
    response.json.return_value = json_data or {}

    def _raise_for_status() -> None:
        if status_code >= 400:
            raise requests.HTTPError(f"{status_code} error", response=response)

    response.raise_for_status.side_effect = _raise_for_status
    return response


@patch("onyx.connectors.box.client.time.sleep")
@patch("onyx.connectors.box.client.requests.request")
def test_box_client_retries_429_then_succeeds(
    mock_request: MagicMock,
    mock_sleep: MagicMock,
) -> None:
    mock_request.side_effect = [
        _response(429, headers={"Retry-After": "2"}),
        _response(200, {"access_token": "token"}),
    ]

    client = BoxClient(
        client_id="client-id",
        client_secret="client-secret",
        box_subject_type="enterprise",
        box_subject_id="enterprise-id",
    )

    assert client.access_token == "token"
    assert mock_request.call_count == 2
    mock_sleep.assert_called_once_with(2.0)


@patch("onyx.connectors.box.client.time.sleep")
@patch("onyx.connectors.box.client.requests.request")
def test_box_client_retries_5xx_until_success(
    mock_request: MagicMock,
    mock_sleep: MagicMock,
) -> None:
    mock_request.side_effect = [
        _response(503),
        _response(500),
        _response(200, {"access_token": "token"}),
    ]

    client = BoxClient(
        client_id="client-id",
        client_secret="client-secret",
        box_subject_type="enterprise",
        box_subject_id="enterprise-id",
    )

    assert client.access_token == "token"
    assert mock_request.call_count == 3
    assert mock_sleep.call_count == 2


@patch("onyx.connectors.box.client.time.sleep")
@patch("onyx.connectors.box.client.requests.request")
def test_box_client_does_not_retry_403(
    mock_request: MagicMock,
    mock_sleep: MagicMock,
) -> None:
    mock_request.return_value = _response(403)

    with pytest.raises(requests.HTTPError):
        BoxClient(
            client_id="client-id",
            client_secret="client-secret",
            box_subject_type="enterprise",
            box_subject_id="enterprise-id",
        )

    assert mock_request.call_count == 1
    mock_sleep.assert_not_called()
