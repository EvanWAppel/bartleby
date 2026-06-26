"""Thin HTTP client for the bartleby REST `/notes` endpoint.

T-007 only needs the list shape; we read ``GET /notes`` and return one
``Note`` dataclass per row. Authentication uses the same bearer token
the auth module hands out (see auth.py).

Per agents.md "do not hide or wrap errors": HTTP and parsing errors
propagate as-is so the caller / log surfaces them.
"""

from __future__ import annotations

import asyncio
import json
import logging
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, cast

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Note:
    """One row in the notes-list view."""

    id: str
    title: str
    tags: tuple[str, ...]
    updated_at: str


class NotesApiError(RuntimeError):
    """Raised when the /notes response is missing/malformed fields."""


async def fetch_notes(http_base_url: str, access_token: str | None = None) -> list[Note]:
    """GET ``{base}/notes`` and return the parsed list.

    ``access_token`` is sent as ``Authorization: Bearer ...`` when present.
    The server returns ``{"notes": [{id, title, tags, updated_at, ...}, ...]}``.
    """
    url = f"{http_base_url.rstrip('/')}/notes"
    data = await asyncio.to_thread(_get_json_sync, url, access_token)
    raw_notes = _require_list(data, "notes")
    return [_parse_note(item) for item in raw_notes]


def _get_json_sync(url: str, access_token: str | None) -> dict[str, Any]:
    headers = {"accept": "application/json"}
    if access_token is not None:
        headers["authorization"] = f"Bearer {access_token}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=10) as res:
        decoded = json.loads(res.read().decode("utf-8"))
    if not isinstance(decoded, dict):
        raise NotesApiError("expected JSON object from /notes")
    return decoded


def _parse_note(item: object) -> Note:
    if not isinstance(item, dict):
        raise NotesApiError("notes[] entry must be an object")
    obj = cast("Mapping[str, object]", item)
    raw_tags = obj.get("tags")
    if not isinstance(raw_tags, list):
        raise NotesApiError("note.tags must be a list")
    tags: list[str] = []
    for t in raw_tags:
        if not isinstance(t, str):
            raise NotesApiError("note.tags entries must be strings")
        tags.append(t)
    return Note(
        id=_require_str(obj, "id"),
        title=_require_str(obj, "title"),
        tags=tuple(tags),
        updated_at=_require_str(obj, "updated_at"),
    )


def _require_str(data: Mapping[str, object], field: str) -> str:
    value = data.get(field)
    if not isinstance(value, str):
        raise NotesApiError(f"expected string field {field}")
    return value


def _require_list(data: object, field: str) -> list[object]:
    if not isinstance(data, dict):
        raise NotesApiError("expected JSON object")
    obj = cast("Mapping[str, object]", data)
    value = obj.get(field)
    if not isinstance(value, list):
        raise NotesApiError(f"expected list field {field}")
    return list(value)
