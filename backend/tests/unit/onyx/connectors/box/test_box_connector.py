from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from datetime import timezone
from typing import cast

from pytest import MonkeyPatch

from onyx.configs.constants import DocumentSource
from onyx.connectors.box.connector import _parse_root_folder_ids
from onyx.connectors.box.connector import BoxConnector
from onyx.connectors.box.models import BOX_FILE_TYPE
from onyx.connectors.box.models import BOX_FOLDER_TYPE
from onyx.connectors.box.models import box_document_id
from onyx.connectors.box.models import BoxItem
from onyx.connectors.box.models import BoxUser
from onyx.connectors.models import Document
from onyx.connectors.models import HierarchyNode
from onyx.connectors.registry import CONNECTOR_CLASS_MAP
from onyx.connectors.registry import ConnectorMapping
from onyx.db.enums import HierarchyNodeType


class FakeBoxClient:
    def __init__(self) -> None:
        self.downloaded_file_ids: list[str] = []
        self.folders = {
            "0": BoxItem(
                id="0",
                type=BOX_FOLDER_TYPE,
                name="All Files",
                modified_at=None,
                owned_by=BoxUser(id=None, name=None, login=None),
                size=None,
                sha1=None,
                parent_id=None,
                web_url="https://app.box.com/folder/0",
            ),
            "10": BoxItem(
                id="10",
                type=BOX_FOLDER_TYPE,
                name="RFP",
                modified_at=None,
                owned_by=BoxUser(id=None, name=None, login=None),
                size=None,
                sha1=None,
                parent_id="0",
                web_url="https://app.box.com/folder/10",
            ),
        }
        self.items = {
            "0": [self.folders["10"]],
            "10": [
                BoxItem(
                    id="99",
                    type=BOX_FILE_TYPE,
                    name="proposal.pdf",
                    modified_at=datetime(2026, 6, 15, 1, 2, 3, tzinfo=timezone.utc),
                    owned_by=BoxUser(
                        id="u1",
                        name="Ada Lovelace",
                        login="ada@example.com",
                    ),
                    size=1234,
                    sha1="abc123",
                    parent_id="10",
                    web_url="https://app.box.com/file/99",
                )
            ],
        }

    def get_folder(self, folder_id: str) -> BoxItem:
        return self.folders[folder_id]

    def iter_folder_items(self, folder_id: str, _limit: int) -> Iterator[BoxItem]:
        return iter(self.items[folder_id])

    def download_file(self, file_id: str) -> bytes:
        self.downloaded_file_ids.append(file_id)
        return b"fake pdf bytes"


def test_box_registered() -> None:
    assert CONNECTOR_CLASS_MAP[DocumentSource.BOX] == ConnectorMapping(
        module_path="onyx.connectors.box.connector",
        class_name="BoxConnector",
    )


def test_parse_root_folder_ids() -> None:
    assert _parse_root_folder_ids(None) == ["0"]
    assert _parse_root_folder_ids("123, 456 ,,") == ["123", "456"]
    assert _parse_root_folder_ids(["123", " 456 "]) == ["123", "456"]


def test_poll_source_yields_hierarchy_and_document(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(
        "onyx.connectors.box.connector.extract_file_text",
        lambda *_args, **_kwargs: "Extracted proposal text",
    )

    connector = BoxConnector(batch_size=10)
    fake_client = FakeBoxClient()
    connector.box_client = fake_client  # type: ignore[assignment]
    connector.root_folder_ids = ["0"]

    batches = list(connector.poll_source(None, None))

    root_node = cast(HierarchyNode, batches[0][0])
    child_node = cast(HierarchyNode, batches[1][0])
    document = cast(Document, batches[2][0])

    assert root_node.raw_node_id == "0"
    assert root_node.node_type == HierarchyNodeType.FOLDER
    assert child_node.raw_node_id == "10"
    assert child_node.raw_parent_id == "0"
    assert document.id == box_document_id("99")
    assert document.source == DocumentSource.BOX
    assert document.semantic_identifier == "proposal.pdf"
    assert document.doc_updated_at == datetime(
        2026, 6, 15, 1, 2, 3, tzinfo=timezone.utc
    )
    assert document.parent_hierarchy_raw_node_id == "10"
    assert document.metadata == {
        "box_file_id": "99",
        "box_folder_path": "/All Files/RFP",
        "box_owner": "Ada Lovelace",
        "box_size": "1234",
        "box_modified_at": "2026-06-15T01:02:03+00:00",
        "box_sha1": "abc123",
    }
    assert document.sections[0].text == "Extracted proposal text"
    assert fake_client.downloaded_file_ids == ["99"]
