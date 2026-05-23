"""Hocuspocus wire-format codec.

Hocuspocus wraps every WebSocket frame as
``<doc_name:varstring><msg_type:varuint><payload>``. Sync messages then carry
``<sync_subtype:varuint><sync_data>`` where ``sync_data`` is a varbytes
update or state-vector, per the Yjs sync protocol.

This module implements the lib0 varint/varstring/varbytes codecs and a thin
framing layer. All higher-level sync logic lives in ``connection.py``.
"""

from __future__ import annotations

from dataclasses import dataclass

# Hocuspocus message types — mirrors @hocuspocus/provider/src/types.ts.
MESSAGE_TYPE_SYNC = 0
MESSAGE_TYPE_AWARENESS = 1
MESSAGE_TYPE_AUTH = 2
MESSAGE_TYPE_QUERY_AWARENESS = 3
MESSAGE_TYPE_STATELESS = 5
MESSAGE_TYPE_CLOSE = 7
MESSAGE_TYPE_SYNC_STATUS = 8
MESSAGE_TYPE_PING = 9
MESSAGE_TYPE_PONG = 10

# Yjs sync sub-types — mirrors y-protocols/sync.js.
SYNC_STEP_1 = 0
SYNC_STEP_2 = 1
SYNC_UPDATE = 2

# Auth sub-types — mirrors @hocuspocus/common AuthMessageType.
AUTH_TOKEN = 0
AUTH_PERMISSION_DENIED = 1
AUTH_AUTHENTICATED = 2

# Identifier the server stores for log/metric purposes. Not a security boundary.
TUI_CLIENT_VERSION = "bartleby-tui/0.0.1"


def encode_varuint(value: int) -> bytes:
    """LEB128-style unsigned varint as used by lib0."""
    if value < 0:
        raise ValueError(f"varuint cannot encode negative value: {value}")
    parts = bytearray()
    while value >= 0x80:
        parts.append((value & 0x7F) | 0x80)
        value >>= 7
    parts.append(value & 0x7F)
    return bytes(parts)


def decode_varuint(data: bytes, offset: int = 0) -> tuple[int, int]:
    """Decode a lib0 varuint starting at ``offset``; return (value, next_offset)."""
    value = 0
    shift = 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if (byte & 0x80) == 0:
            return value, offset
        shift += 7


def encode_varstring(s: str) -> bytes:
    encoded = s.encode("utf-8")
    return encode_varuint(len(encoded)) + encoded


def decode_varstring(data: bytes, offset: int = 0) -> tuple[str, int]:
    length, offset = decode_varuint(data, offset)
    end = offset + length
    return data[offset:end].decode("utf-8"), end


def encode_varbytes(b: bytes) -> bytes:
    return encode_varuint(len(b)) + b


def decode_varbytes(data: bytes, offset: int = 0) -> tuple[bytes, int]:
    length, offset = decode_varuint(data, offset)
    end = offset + length
    return bytes(data[offset:end]), end


def build_message(doc_name: str, msg_type: int, payload: bytes) -> bytes:
    """Construct a Hocuspocus-framed message."""
    return encode_varstring(doc_name) + encode_varuint(msg_type) + payload


@dataclass(frozen=True)
class ParsedMessage:
    doc_name: str
    msg_type: int
    payload: bytes


def parse_message(data: bytes) -> ParsedMessage:
    doc_name, offset = decode_varstring(data, 0)
    msg_type, offset = decode_varuint(data, offset)
    return ParsedMessage(doc_name=doc_name, msg_type=msg_type, payload=bytes(data[offset:]))


def build_sync_step_1(doc_name: str, state_vector: bytes) -> bytes:
    """Outgoing SyncStep1 carrying the current state vector."""
    payload = encode_varuint(SYNC_STEP_1) + encode_varbytes(state_vector)
    return build_message(doc_name, MESSAGE_TYPE_SYNC, payload)


def build_sync_step_2(doc_name: str, update: bytes) -> bytes:
    """Outgoing SyncStep2 carrying the missing structs/diff."""
    payload = encode_varuint(SYNC_STEP_2) + encode_varbytes(update)
    return build_message(doc_name, MESSAGE_TYPE_SYNC, payload)


def build_sync_update(doc_name: str, update: bytes) -> bytes:
    """Outgoing live Update message."""
    payload = encode_varuint(SYNC_UPDATE) + encode_varbytes(update)
    return build_message(doc_name, MESSAGE_TYPE_SYNC, payload)


def build_auth_token(doc_name: str, token: str = "", client_version: str | None = None) -> bytes:
    """Initial auth message Hocuspocus expects before forwarding any sync traffic.

    Servers without an ``onAuthenticate`` hook accept any token (including the
    empty string) and respond with an Authenticated message.
    """
    version = client_version if client_version is not None else TUI_CLIENT_VERSION
    payload = encode_varuint(AUTH_TOKEN) + encode_varstring(token) + encode_varstring(version)
    return build_message(doc_name, MESSAGE_TYPE_AUTH, payload)
