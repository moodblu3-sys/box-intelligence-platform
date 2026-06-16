from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from io import BytesIO
from typing import Any

import requests

from onyx.configs.app_configs import INDEX_BATCH_SIZE
from onyx.configs.constants import DocumentSource
from onyx.connectors.box.client import BoxClient
from onyx.connectors.box.models import BOX_FILE_TYPE
from onyx.connectors.box.models import BOX_FOLDER_TYPE
from onyx.connectors.box.models import box_document_id
from onyx.connectors.box.models import BoxItem
from onyx.connectors.exceptions import ConnectorValidationError
from onyx.connectors.exceptions import CredentialInvalidError
from onyx.connectors.exceptions import InsufficientPermissionsError
from onyx.connectors.interfaces import GenerateDocumentsOutput
from onyx.connectors.interfaces import LoadConnector
from onyx.connectors.interfaces import PollConnector
from onyx.connectors.interfaces import SecondsSinceUnixEpoch
from onyx.connectors.models import BasicExpertInfo
from onyx.connectors.models import ConnectorMissingCredentialError
from onyx.connectors.models import Document
from onyx.connectors.models import HierarchyNode
from onyx.connectors.models import TextSection
from onyx.db.enums import HierarchyNodeType
from onyx.file_processing.extract_file_text import extract_file_text
from onyx.utils.logger import setup_logger

logger = setup_logger()


def _box_http_status(error: requests.HTTPError) -> int | None:
    return error.response.status_code if error.response is not None else None


def _box_error_detail(error: requests.HTTPError) -> str:
    response = error.response
    if response is None:
        return str(error)

    try:
        data = response.json()
    except ValueError:
        text = response.text[:500] if response.text else str(error)
        return text

    if isinstance(data, dict):
        message = data.get("message") or data.get("error_description")
        code = data.get("code") or data.get("error")
        if message and code:
            return f"{code}: {message}"
        if message:
            return str(message)
        if code:
            return str(code)
    return str(error)


def _raise_box_auth_error(error: requests.HTTPError) -> None:
    status_code = _box_http_status(error)
    detail = _box_error_detail(error)
    if status_code in {400, 401}:
        raise CredentialInvalidError(
            f"Box credential is invalid. Check client_id, client_secret, "
            f"box_subject_type, and box_subject_id. Box response: {detail}"
        ) from error
    if status_code == 403:
        raise InsufficientPermissionsError(
            f"Box credential does not have sufficient permissions. "
            f"Box response: {detail}"
        ) from error
    if status_code == 429:
        raise ConnectorValidationError(
            f"Box API rate limit was exceeded while validating credentials. "
            f"Please retry shortly. Box response: {detail}"
        ) from error
    if status_code is not None and status_code >= 500:
        raise ConnectorValidationError(
            f"Box API is temporarily unavailable while validating credentials. "
            f"Please retry shortly. Box response: {detail}"
        ) from error
    raise ConnectorValidationError(
        f"Unexpected Box authentication error. Box response: {detail}"
    ) from error


def _raise_box_folder_validation_error(
    error: requests.HTTPError,
    folder_id: str,
) -> None:
    status_code = _box_http_status(error)
    detail = _box_error_detail(error)
    if status_code in {400, 401}:
        raise CredentialInvalidError(
            f"Box credential is invalid while validating folder {folder_id}. "
            f"Box response: {detail}"
        ) from error
    if status_code == 403:
        raise InsufficientPermissionsError(
            f"Box credential does not have access to folder {folder_id}. "
            f"Share the folder with the CCG subject or choose a folder the "
            f"subject can access. Box response: {detail}"
        ) from error
    if status_code == 404:
        raise ConnectorValidationError(
            f"Box folder {folder_id} was not found. Check root_folder_ids and "
            f"confirm the folder exists in the target enterprise/user context. "
            f"Box response: {detail}"
        ) from error
    if status_code == 429:
        raise ConnectorValidationError(
            f"Box API rate limit was exceeded while validating folder {folder_id}. "
            f"Please retry shortly. Box response: {detail}"
        ) from error
    if status_code is not None and status_code >= 500:
        raise ConnectorValidationError(
            f"Box API is temporarily unavailable while validating folder {folder_id}. "
            f"Please retry shortly. Box response: {detail}"
        ) from error
    raise ConnectorValidationError(
        f"Unexpected Box API error while validating folder {folder_id}. "
        f"Box response: {detail}"
    ) from error


def _parse_root_folder_ids(raw_value: Any) -> list[str]:
    if raw_value is None or raw_value == "":
        return ["0"]
    if isinstance(raw_value, list):
        parsed = [str(value).strip() for value in raw_value if str(value).strip()]
        return parsed or ["0"]
    if isinstance(raw_value, str):
        parsed = [value.strip() for value in raw_value.split(",") if value.strip()]
        return parsed or ["0"]
    parsed_value = str(raw_value).strip()
    return [parsed_value] if parsed_value else ["0"]


def _is_in_time_range(
    modified_at: datetime | None,
    start: SecondsSinceUnixEpoch | None,
    end: SecondsSinceUnixEpoch | None,
) -> bool:
    if modified_at is None:
        return True

    modified_ts = modified_at.timestamp()
    if start is not None and modified_ts < start:
        return False
    if end is not None and modified_ts > end:
        return False
    return True


def _folder_path(path_parts: Iterable[str]) -> str:
    cleaned_parts = [part.strip("/") for part in path_parts if part.strip("/")]
    return "/" + "/".join(cleaned_parts) if cleaned_parts else "/"


class BoxConnector(LoadConnector, PollConnector):
    def __init__(self, batch_size: int = INDEX_BATCH_SIZE) -> None:
        self.batch_size = batch_size
        self.box_client: BoxClient | None = None
        self.root_folder_ids: list[str] = ["0"]

    def load_credentials(self, credentials: dict[str, Any]) -> dict[str, Any] | None:
        subject_type = str(credentials.get("box_subject_type") or "").strip()
        subject_id = str(
            credentials.get("box_subject_id") or credentials.get("enterprise_id") or ""
        ).strip()

        if subject_type not in {"enterprise", "user"}:
            raise CredentialInvalidError(
                "box_subject_type must be either 'enterprise' or 'user'."
            )

        missing_fields = [
            field
            for field in ("client_id", "client_secret", "enterprise_id")
            if not credentials.get(field)
        ]
        if not subject_id:
            missing_fields.append("box_subject_id")
        if missing_fields:
            raise CredentialInvalidError(
                f"Missing Box credential fields: {', '.join(missing_fields)}"
            )

        self.root_folder_ids = _parse_root_folder_ids(credentials.get("root_folder_ids"))
        try:
            self.box_client = BoxClient(
                client_id=str(credentials["client_id"]),
                client_secret=str(credentials["client_secret"]),
                box_subject_type=subject_type,
                box_subject_id=subject_id,
            )
        except requests.HTTPError as e:
            _raise_box_auth_error(e)
        return None

    def _build_hierarchy_node(
        self,
        folder: BoxItem,
        parent_id: str | None,
    ) -> HierarchyNode:
        return HierarchyNode(
            raw_node_id=folder.id,
            raw_parent_id=parent_id,
            display_name=folder.name,
            link=folder.web_url or f"https://app.box.com/folder/{folder.id}",
            node_type=HierarchyNodeType.FOLDER,
        )

    def _build_document(self, file: BoxItem, folder_path: str) -> Document:
        if self.box_client is None:
            raise ConnectorMissingCredentialError("Box")

        downloaded_file = self.box_client.download_file(file.id)
        text = extract_file_text(
            BytesIO(downloaded_file),
            file_name=file.name,
            break_on_unprocessable=False,
        )
        owner = file.owned_by.name or file.owned_by.login
        owners = (
            [
                BasicExpertInfo(
                    display_name=file.owned_by.name,
                    email=file.owned_by.login,
                )
            ]
            if owner
            else None
        )

        return Document(
            id=box_document_id(file.id),
            sections=[
                TextSection(
                    link=file.web_url or f"https://app.box.com/file/{file.id}",
                    text=text,
                )
            ],
            source=DocumentSource.BOX,
            semantic_identifier=file.name,
            metadata={
                "box_file_id": file.id,
                "box_folder_path": folder_path,
                "box_owner": owner or "",
                "box_size": "" if file.size is None else str(file.size),
                "box_modified_at": file.modified_at.isoformat()
                if file.modified_at
                else "",
                "box_sha1": file.sha1 or "",
            },
            doc_updated_at=file.modified_at,
            primary_owners=owners,
            parent_hierarchy_raw_node_id=file.parent_id,
            file_id=file.id,
        )

    def _yield_folder_recursive(
        self,
        folder_id: str,
        parent_id: str | None,
        path_parts: list[str],
        start: SecondsSinceUnixEpoch | None,
        end: SecondsSinceUnixEpoch | None,
    ) -> GenerateDocumentsOutput:
        if self.box_client is None:
            raise ConnectorMissingCredentialError("Box")

        folder = self.box_client.get_folder(folder_id)
        current_path_parts = path_parts + [folder.name]
        yield [self._build_hierarchy_node(folder, parent_id)]

        batch: list[Document | HierarchyNode] = []
        for item in self.box_client.iter_folder_items(folder_id, self.batch_size):
            if item.type == BOX_FOLDER_TYPE:
                if batch:
                    yield batch
                    batch = []
                yield from self._yield_folder_recursive(
                    folder_id=item.id,
                    parent_id=folder.id,
                    path_parts=current_path_parts,
                    start=start,
                    end=end,
                )
                continue

            if item.type != BOX_FILE_TYPE:
                continue
            if not _is_in_time_range(item.modified_at, start, end):
                continue

            try:
                batch.append(self._build_document(item, _folder_path(current_path_parts)))
            except Exception as e:
                logger.exception(
                    "Failed to process Box file. box_file_id=%s file_name=%r "
                    "folder_path=%r error=%s",
                    item.id,
                    item.name,
                    _folder_path(current_path_parts),
                    e,
                )

            if len(batch) >= self.batch_size:
                yield batch
                batch = []

        if batch:
            yield batch

    def load_from_state(self) -> GenerateDocumentsOutput:
        return self.poll_source(None, None)

    def poll_source(
        self,
        start: SecondsSinceUnixEpoch | None,
        end: SecondsSinceUnixEpoch | None,
    ) -> GenerateDocumentsOutput:
        if self.box_client is None:
            raise ConnectorMissingCredentialError("Box")

        for folder_id in self.root_folder_ids:
            yield from self._yield_folder_recursive(
                folder_id=folder_id,
                parent_id=None,
                path_parts=[],
                start=start,
                end=end,
            )

    def validate_connector_settings(self) -> None:
        if self.box_client is None:
            raise ConnectorMissingCredentialError("Box credentials not loaded.")

        for folder_id in self.root_folder_ids:
            try:
                next(self.box_client.iter_folder_items(folder_id, 1), None)
            except requests.HTTPError as e:
                _raise_box_folder_validation_error(e, folder_id)
            except Exception as e:
                raise ConnectorValidationError(
                    f"Unexpected Box validation error for folder {folder_id}: {e}"
                ) from e
