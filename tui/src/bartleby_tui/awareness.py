"""Yjs awareness wire codec.

Hocuspocus relays awareness updates as ``MESSAGE_TYPE_AWARENESS`` frames
whose payload is a varbytes blob containing a y-protocols/awareness update.
That inner blob is laid out as::

    <num_clients:varuint>
    repeat num_clients:
        <client_id:varuint>
        <clock:varuint>
        <state_json:varstring>   # "" when the client cleared its state

Each ``state_json`` is the JSON-stringified awareness state object the
peer's local code set (web client publishes ``{"user": {"name", "color"}}``
via ``provider.awareness.setLocalStateField('user', ...)``). The clock is
a monotonic counter the publishing client maintains for itself; consumers
must keep the *latest* clock per ``client_id`` and ignore older messages.

This module exposes just enough to read peer awareness off the wire for
T-018 (status-bar presence). The full Y.Awareness state machine — local
timers, "online" tracking, GC of dropped clients — is heavier than what
the TUI status bar needs, so we keep this layer thin.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from bartleby_tui.protocol import (
    decode_varbytes,
    decode_varstring,
    decode_varuint,
    encode_varbytes,
    encode_varstring,
    encode_varuint,
)


@dataclass(frozen=True)
class AwarenessEntry:
    """A single peer's awareness slot at a given clock."""

    client_id: int
    clock: int
    state: dict[str, Any] | None


def decode_awareness_payload(payload: bytes) -> list[AwarenessEntry]:
    """Parse the *inner* awareness blob (after stripping varbytes framing).

    ``payload`` is the bytes between the ``<num_clients:varuint>`` header
    and the end of the awareness update — i.e. ``data[offset:]`` from the
    caller that already decoded the outer varbytes.
    """
    entries: list[AwarenessEntry] = []
    n, offset = decode_varuint(payload, 0)
    for _ in range(n):
        client_id, offset = decode_varuint(payload, offset)
        clock, offset = decode_varuint(payload, offset)
        state_json, offset = decode_varstring(payload, offset)
        # y-protocols emits the literal string "null" when a state was
        # cleared; treat both "null" and "" as cleared.
        if state_json == "" or state_json == "null":
            state: dict[str, Any] | None = None
        else:
            decoded = json.loads(state_json)
            state = decoded if isinstance(decoded, dict) else None
        entries.append(AwarenessEntry(client_id=client_id, clock=clock, state=state))
    return entries


def decode_awareness_message_payload(message_payload: bytes) -> list[AwarenessEntry]:
    """Decode the payload of a full ``MESSAGE_TYPE_AWARENESS`` frame.

    The outer Hocuspocus framing has already been stripped — what's left
    is ``<varbytes:awareness_update>``.
    """
    inner, _ = decode_varbytes(message_payload, 0)
    return decode_awareness_payload(inner)


def encode_awareness_payload(entries: list[AwarenessEntry]) -> bytes:
    """Encode a list of awareness entries into the *inner* awareness blob."""
    out = bytearray()
    out += encode_varuint(len(entries))
    for entry in entries:
        out += encode_varuint(entry.client_id)
        out += encode_varuint(entry.clock)
        if entry.state is None:
            # y-protocols writes the literal "null" string when clearing.
            out += encode_varstring("null")
        else:
            out += encode_varstring(json.dumps(entry.state, separators=(",", ":")))
    return bytes(out)


def encode_awareness_message_payload(entries: list[AwarenessEntry]) -> bytes:
    """Wrap an awareness blob in its outer varbytes envelope."""
    return encode_varbytes(encode_awareness_payload(entries))
