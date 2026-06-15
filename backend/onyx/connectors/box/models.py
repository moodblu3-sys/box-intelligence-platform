from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from datetime import timezone
from typing import Any


BOX_FOLDER_TYPE = "folder"
BOX_FILE_TYPE = "file"


@dataclass(frozen=True)
class BoxUser:
    id: str | None
    name: str | None
    login: str | None

    @classmethod
    def from_json(cls, data: dict[str, Any] | None) -> "BoxUser":
        data = data or {}
        return cls(
            id=data.get("id"),
            name=data.get("name"),
            login=data.get("login"),
        )


@dataclass(frozen=True)
class BoxItem:
    id: str
    type: str
    name: str
    modified_at: datetime | None
    owned_by: BoxUser
    size: int | None
    sha1: str | None
    parent_id: str | None
    web_url: str | None

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "BoxItem":
        return cls(
            id=str(data["id"]),
            type=str(data["type"]),
            name=str(data.get("name") or data["id"]),
            modified_at=parse_box_datetime(data.get("modified_at")),
            owned_by=BoxUser.from_json(data.get("owned_by")),
            size=data.get("size"),
            sha1=data.get("sha1"),
            parent_id=(data.get("parent") or {}).get("id"),
            web_url=data.get("web_url"),
        )


def parse_box_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def box_document_id(file_id: str) -> str:
    return f"box:file:{file_id}"
