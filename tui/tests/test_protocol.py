"""Tests for the lib0 / Hocuspocus wire codec."""

from __future__ import annotations

import pytest

from bartleby_tui.protocol import (
    MESSAGE_TYPE_AUTH,
    MESSAGE_TYPE_AWARENESS,
    MESSAGE_TYPE_SYNC,
    SYNC_STEP_1,
    SYNC_STEP_2,
    SYNC_UPDATE,
    build_message,
    decode_varbytes,
    decode_varstring,
    decode_varuint,
    encode_varbytes,
    encode_varstring,
    encode_varuint,
    parse_message,
)


class TestVaruint:
    def test_zero(self) -> None:
        assert encode_varuint(0) == b"\x00"

    def test_127(self) -> None:
        assert encode_varuint(127) == b"\x7f"

    def test_128_uses_two_bytes(self) -> None:
        # lib0 / LEB128: 128 = 0b10000000 -> 0x80, 0x01
        assert encode_varuint(128) == b"\x80\x01"

    def test_300(self) -> None:
        # 300 = 0b100101100 -> 0xac, 0x02
        assert encode_varuint(300) == b"\xac\x02"

    def test_negative_rejected(self) -> None:
        with pytest.raises(ValueError):
            encode_varuint(-1)

    @pytest.mark.parametrize("value", [0, 1, 127, 128, 255, 256, 16383, 16384, 1 << 32])
    def test_roundtrip(self, value: int) -> None:
        encoded = encode_varuint(value)
        decoded, offset = decode_varuint(encoded, 0)
        assert decoded == value
        assert offset == len(encoded)

    def test_decode_offset(self) -> None:
        # Prefix some junk, then encode 42 at offset 3.
        data = b"junk" + encode_varuint(42)
        value, offset = decode_varuint(data, 4)
        assert value == 42
        assert offset == len(data)


class TestVarstring:
    def test_empty(self) -> None:
        assert encode_varstring("") == b"\x00"

    @pytest.mark.parametrize("s", ["", "a", "hello", "héllo", "🦀", "vertical-slice"])
    def test_roundtrip(self, s: str) -> None:
        encoded = encode_varstring(s)
        decoded, offset = decode_varstring(encoded, 0)
        assert decoded == s
        assert offset == len(encoded)


class TestVarbytes:
    @pytest.mark.parametrize("b", [b"", b"\x00", b"hello", bytes(range(255))])
    def test_roundtrip(self, b: bytes) -> None:
        encoded = encode_varbytes(b)
        decoded, offset = decode_varbytes(encoded, 0)
        assert decoded == b
        assert offset == len(encoded)


class TestMessageFraming:
    def test_build_message_layout(self) -> None:
        # Hocuspocus wire format: <docname:varstring><type:varuint><payload>
        msg = build_message("my-doc", MESSAGE_TYPE_SYNC, b"PAYLOAD")
        name, offset = decode_varstring(msg, 0)
        msg_type, offset = decode_varuint(msg, offset)
        assert name == "my-doc"
        assert msg_type == MESSAGE_TYPE_SYNC
        assert msg[offset:] == b"PAYLOAD"

    def test_parse_message_roundtrip(self) -> None:
        msg = build_message("vertical-slice", MESSAGE_TYPE_SYNC, b"\x01\x02\x03")
        parsed = parse_message(msg)
        assert parsed.doc_name == "vertical-slice"
        assert parsed.msg_type == MESSAGE_TYPE_SYNC
        assert parsed.payload == b"\x01\x02\x03"


class TestConstants:
    def test_message_types(self) -> None:
        # Mirrors @hocuspocus/provider/src/types.ts MessageType enum.
        assert MESSAGE_TYPE_SYNC == 0
        assert MESSAGE_TYPE_AWARENESS == 1
        assert MESSAGE_TYPE_AUTH == 2

    def test_sync_subtypes(self) -> None:
        # Mirrors y-protocols/sync.js.
        assert SYNC_STEP_1 == 0
        assert SYNC_STEP_2 == 1
        assert SYNC_UPDATE == 2
