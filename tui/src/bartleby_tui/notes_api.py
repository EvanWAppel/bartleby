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
from urllib.parse import quote

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Note:
    """One row in the notes-list view."""

    id: str
    title: str
    tags: tuple[str, ...]
    updated_at: str


@dataclass(frozen=True)
class Backlink:
    """One inbound link to a note (T-012 inbound-links pane)."""

    source_id: str
    source_title: str
    link_text: str


@dataclass(frozen=True)
class Mention:
    """One @mention in the inbox (T-017). ``read_at is None`` ⇒ unread."""

    id: str
    note_id: str
    note_title: str
    source: str
    read_at: str | None


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


async def search_notes(
    http_base_url: str, query: str, access_token: str | None = None
) -> list[str]:
    """GET ``{base}/search?q=...`` and return matching note ids in rank order.

    The server returns ``{"hits": [{id, title, snippet}, ...]}`` (S-011); we
    keep only the ids and let the caller back-fill display data from the
    already-loaded notes list. An empty query returns ``[]`` without a request.
    """
    if not query:
        return []
    url = f"{http_base_url.rstrip('/')}/search?q={quote(query)}"
    data = await asyncio.to_thread(_get_json_sync, url, access_token)
    hits = _require_list(data, "hits")
    ids: list[str] = []
    for hit in hits:
        if isinstance(hit, dict):
            hit_id = cast("Mapping[str, object]", hit).get("id")
            if isinstance(hit_id, str):
                ids.append(hit_id)
    return ids


async def fetch_mentions(http_base_url: str, access_token: str | None = None) -> list[Mention]:
    """GET ``/mentions`` (M-003); return all mentions (unread + recent)."""
    url = f"{http_base_url.rstrip('/')}/mentions"
    data = await asyncio.to_thread(_get_json_sync, url, access_token)
    rows = _require_list(data, "mentions")
    out: list[Mention] = []
    for row in rows:
        if not isinstance(row, dict):
            raise NotesApiError("mentions[] entry must be an object")
        obj = cast("Mapping[str, object]", row)
        read_at = obj.get("read_at")
        source = obj.get("source")
        out.append(
            Mention(
                id=_require_str(obj, "id"),
                note_id=_require_str(obj, "note_id"),
                note_title=_require_str(obj, "note_title"),
                source=source if isinstance(source, str) else "",
                read_at=read_at if isinstance(read_at, str) else None,
            )
        )
    return out


async def mark_mention_read(
    http_base_url: str, mention_id: str, access_token: str | None = None
) -> None:
    """POST ``/mentions/:id/read`` (M-004) — idempotent mark-as-read."""
    url = f"{http_base_url.rstrip('/')}/mentions/{quote(mention_id)}/read"
    await asyncio.to_thread(_request_json_sync, "POST", url, None, access_token)


async def fetch_trash(http_base_url: str, access_token: str | None = None) -> list[Note]:
    """GET ``/notes/trash`` (S-003); return the trashed notes."""
    url = f"{http_base_url.rstrip('/')}/notes/trash"
    data = await asyncio.to_thread(_get_json_sync, url, access_token)
    raw_notes = _require_list(data, "notes")
    return [_parse_note(item) for item in raw_notes]


async def delete_note_forever(
    http_base_url: str, note_id: str, access_token: str | None = None
) -> None:
    """DELETE ``/notes/:id?forever=true`` — hard-delete a trashed note (S-005)."""
    url = f"{http_base_url.rstrip('/')}/notes/{quote(note_id)}?forever=true"
    await asyncio.to_thread(_request_json_sync, "DELETE", url, None, access_token)


async def fetch_backlinks(
    http_base_url: str, note_id: str, access_token: str | None = None
) -> list[Backlink]:
    """GET ``/notes/:id/backlinks`` (S-007); return inbound links.

    Server shape: ``{"backlinks": [{source_id, source_title, link_text}, ...]}``.
    """
    url = f"{http_base_url.rstrip('/')}/notes/{quote(note_id)}/backlinks"
    data = await asyncio.to_thread(_get_json_sync, url, access_token)
    rows = _require_list(data, "backlinks")
    out: list[Backlink] = []
    for row in rows:
        if not isinstance(row, dict):
            raise NotesApiError("backlinks[] entry must be an object")
        obj = cast("Mapping[str, object]", row)
        out.append(
            Backlink(
                source_id=_require_str(obj, "source_id"),
                source_title=_require_str(obj, "source_title"),
                link_text=_require_str(obj, "link_text"),
            )
        )
    return out


async def create_note(
    http_base_url: str, title: str = "Untitled", access_token: str | None = None
) -> str:
    """POST ``/notes`` with ``{title}`` (S-001); return the new note id."""
    url = f"{http_base_url.rstrip('/')}/notes"
    data = await asyncio.to_thread(_request_json_sync, "POST", url, {"title": title}, access_token)
    return _require_str(data, "id")


async def rename_note(
    http_base_url: str, note_id: str, title: str, access_token: str | None = None
) -> None:
    """PATCH ``/notes/:id`` with a new ``{title}`` (S-004)."""
    url = f"{http_base_url.rstrip('/')}/notes/{quote(note_id)}"
    await asyncio.to_thread(_request_json_sync, "PATCH", url, {"title": title}, access_token)


async def delete_note(http_base_url: str, note_id: str, access_token: str | None = None) -> None:
    """DELETE ``/notes/:id`` — soft-delete into the trash (S-005)."""
    url = f"{http_base_url.rstrip('/')}/notes/{quote(note_id)}"
    await asyncio.to_thread(_request_json_sync, "DELETE", url, None, access_token)


async def restore_note(http_base_url: str, note_id: str, access_token: str | None = None) -> None:
    """POST ``/notes/:id/restore`` — clear ``trashed_at`` (S-006)."""
    url = f"{http_base_url.rstrip('/')}/notes/{quote(note_id)}/restore"
    await asyncio.to_thread(_request_json_sync, "POST", url, None, access_token)


def _request_json_sync(
    method: str, url: str, body: dict[str, Any] | None, access_token: str | None
) -> dict[str, Any]:
    headers = {"accept": "application/json"}
    payload: bytes | None = None
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["content-type"] = "application/json"
    if access_token is not None:
        headers["authorization"] = f"Bearer {access_token}"
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as res:
        raw = res.read().decode("utf-8")
    if not raw:
        return {}
    decoded = json.loads(raw)
    return decoded if isinstance(decoded, dict) else {}


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
