from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from datetime import timezone
from typing import Any
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
import requests

from onyx.configs.constants import DocumentSource
from onyx.connectors.box.connector import _parse_root_folder_ids
from onyx.connectors.box.connector import BoxConnector
from onyx.connectors.box.models import BOX_FILE_TYPE
from onyx.connectors.box.models import BOX_FOLDER_TYPE
from onyx.connectors.box.models import BoxItem
from onyx.connectors.box.models import BoxUser
from onyx.connectors.exceptions import ConnectorValidationError
from onyx.connectors.exceptions import InsufficientPermissionsError
from onyx.connectors.models import Document
from onyx.connectors.models import HierarchyNode
from onyx.connectors.registry import CONNECTOR_CLASS_MAP
from onyx.connectors.registry import ConnectorMapping


MODIFIED_AT = datetime(2026, 6, 16, 1, 2, 3, tzinfo=timezone.utc)
OWNER = BoxUser(id="user-1", name="Owner Name", login="owner@example.com")


def _folder(folder_id: str, name: str, parent_id: str | None = None) -> BoxItem:
    return BoxItem(
        id=folder_id,
        type=BOX_FOLDER_TYPE,
        name=name,
        modified_at=None,
        owned_by=OWNER,
        size=None,
        sha1=None,
        parent_id=parent_id,
        web_url=f"https://app.box.com/folder/{folder_id}",
    )


def _file(file_id: str, name: str, parent_id: str) -> BoxItem:
    return BoxItem(
        id=file_id,
        type=BOX_FILE_TYPE,
        name=name,
        modified_at=MODIFIED_AT,
        owned_by=OWNER,
        size=1234,
        sha1="sha1-value",
        parent_id=parent_id,
        web_url=f"https://app.box.com/file/{file_id}",
    )


def _http_error(status_code: int, message: str = "box error") -> requests.HTTPError:
    response = MagicMock(spec=requests.Response)
    response.status_code = status_code
    response.text = message
    response.json.return_value = {"message": message, "code": "box_error"}
    return requests.HTTPError(f"{status_code} error", response=response)


class FakeBoxClient:
    def __init__(self) -> None:
        self.folders: dict[str, BoxItem] = {}
        self.items: dict[str, list[BoxItem]] = {}
        self.downloads: dict[str, bytes | Exception] = {}

    def get_folder(self, folder_id: str) -> BoxItem:
        return self.folders[folder_id]

    def iter_folder_items(self, folder_id: str, _limit: int) -> Iterator[BoxItem]:
        yield from self.items.get(folder_id, [])

    def download_file(self, file_id: str) -> bytes:
        result = self.downloads[file_id]
        if isinstance(result, Exception):
            raise result
        return result


def _flatten(outputs: list[list[Document | HierarchyNode]]) -> list[Any]:
    return [item for batch in outputs for item in batch]


def test_box_registered() -> None:
    assert CONNECTOR_CLASS_MAP[DocumentSource.BOX] == ConnectorMapping(
        module_path="onyx.connectors.box.connector",
        class_name="BoxConnector",
    )


def test_parse_root_folder_ids() -> None:
    assert _parse_root_folder_ids(None) == ["0"]
    assert _parse_root_folder_ids("123, 456 ,,") == ["123", "456"]
    assert _parse_root_folder_ids(["123", " 456 "]) == ["123", "456"]


def test_validation_maps_403_to_insufficient_permissions() -> None:
    connector = BoxConnector()
    connector.root_folder_ids = ["folder-1"]
    box_client = MagicMock()
    box_client.iter_folder_items.side_effect = _http_error(403, "access denied")
    connector.box_client = box_client

    with pytest.raises(InsufficientPermissionsError, match="folder-1"):
        connector.validate_connector_settings()


def test_validation_maps_404_to_folder_not_found() -> None:
    connector = BoxConnector()
    connector.root_folder_ids = ["missing-folder"]
    box_client = MagicMock()
    box_client.iter_folder_items.side_effect = _http_error(404, "not found")
    connector.box_client = box_client

    with pytest.raises(ConnectorValidationError, match="missing-folder"):
        connector.validate_connector_settings()


@patch("onyx.connectors.box.connector.extract_file_text")
def test_download_failure_skips_file_without_failing_connector(
    mock_extract_file_text: MagicMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    fake_client = FakeBoxClient()
    fake_client.folders["0"] = _folder("0", "root")
    fake_client.items["0"] = [_file("file-1", "contract.pdf", "0")]
    fake_client.downloads["file-1"] = requests.ConnectionError("download failed")

    connector = BoxConnector(batch_size=10)
    connector.box_client = fake_client  # type: ignore[assignment]
    connector.root_folder_ids = ["0"]

    outputs = list(connector.poll_source(None, None))
    flattened = _flatten(outputs)

    assert not [item for item in flattened if isinstance(item, Document)]
    assert [item for item in flattened if isinstance(item, HierarchyNode)]
    mock_extract_file_text.assert_not_called()
    assert "box_file_id=file-1" in caplog.text
    assert "contract.pdf" in caplog.text
    assert "folder_path='/root'" in caplog.text


@patch("onyx.connectors.box.connector.extract_file_text")
def test_extraction_failure_skips_file_without_failing_connector(
    mock_extract_file_text: MagicMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    mock_extract_file_text.side_effect = RuntimeError("extraction failed")
    fake_client = FakeBoxClient()
    fake_client.folders["0"] = _folder("0", "root")
    fake_client.items["0"] = [_file("file-1", "contract.pdf", "0")]
    fake_client.downloads["file-1"] = b"pdf bytes"

    connector = BoxConnector(batch_size=10)
    connector.box_client = fake_client  # type: ignore[assignment]
    connector.root_folder_ids = ["0"]

    flattened = _flatten(list(connector.poll_source(None, None)))

    assert not [item for item in flattened if isinstance(item, Document)]
    assert [item for item in flattened if isinstance(item, HierarchyNode)]
    assert "box_file_id=file-1" in caplog.text
    assert "contract.pdf" in caplog.text
    assert "folder_path='/root'" in caplog.text


@patch("onyx.connectors.box.connector.extract_file_text")
def test_recursive_traversal_indexes_nested_files(
    mock_extract_file_text: MagicMock,
) -> None:
    mock_extract_file_text.return_value = "extracted text"
    fake_client = FakeBoxClient()
    fake_client.folders["0"] = _folder("0", "root")
    fake_client.folders["sub"] = _folder("sub", "Contracts", "0")
    fake_client.items["0"] = [_folder("sub", "Contracts", "0")]
    fake_client.items["sub"] = [_file("file-1", "contract.pdf", "sub")]
    fake_client.downloads["file-1"] = b"pdf bytes"

    connector = BoxConnector(batch_size=10)
    connector.box_client = fake_client  # type: ignore[assignment]
    connector.root_folder_ids = ["0"]

    flattened = _flatten(list(connector.poll_source(None, None)))
    documents = [item for item in flattened if isinstance(item, Document)]
    hierarchy_nodes = [item for item in flattened if isinstance(item, HierarchyNode)]

    assert [doc.id for doc in documents] == ["box:file:file-1"]
    assert documents[0].metadata["box_folder_path"] == "/root/Contracts"
    assert [node.raw_node_id for node in hierarchy_nodes] == ["0", "sub"]


@patch("onyx.connectors.box.connector.extract_file_text")
def test_metadata_generation(mock_extract_file_text: MagicMock) -> None:
    mock_extract_file_text.return_value = "contract text"
    fake_client = FakeBoxClient()
    fake_client.downloads["file-1"] = b"file bytes"

    connector = BoxConnector()
    connector.box_client = fake_client  # type: ignore[assignment]

    document = connector._build_document(
        _file("file-1", "contract.pdf", "folder-1"),
        "/Demo/Contracts",
    )

    assert document.id == "box:file:file-1"
    assert document.semantic_identifier == "contract.pdf"
    assert document.doc_updated_at == MODIFIED_AT
    assert document.metadata == {
        "box_file_id": "file-1",
        "box_folder_path": "/Demo/Contracts",
        "box_owner": "Owner Name",
        "box_size": "1234",
        "box_modified_at": "2026-06-16T01:02:03+00:00",
        "box_sha1": "sha1-value",
    }
    assert document.primary_owners is not None
    assert document.primary_owners[0].email == "owner@example.com"
