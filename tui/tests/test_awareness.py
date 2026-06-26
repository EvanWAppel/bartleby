"""Tests for the Yjs awareness wire codec."""

from __future__ import annotations

import pytest

from bartleby_tui.awareness import (
    AwarenessEntry,
    decode_awareness_message_payload,
    decode_awareness_payload,
    encode_awareness_message_payload,
    encode_awareness_payload,
)


class TestRoundTripInner:
    def test_empty_list_round_trips(self) -> None:
        encoded = encode_awareness_payload([])
        assert decode_awareness_payload(encoded) == []

    def test_single_entry_round_trips(self) -> None:
        entry = AwarenessEntry(
            client_id=42,
            clock=7,
            state={"user": {"name": "alice", "color": "#abcdef"}},
        )
        encoded = encode_awareness_payload([entry])
        assert decode_awareness_payload(encoded) == [entry]

    def test_multiple_entries_round_trip_in_order(self) -> None:
        entries = [
            AwarenessEntry(client_id=1, clock=0, state={"user": {"name": "alice"}}),
            AwarenessEntry(client_id=2, clock=12, state={"user": {"name": "bob"}}),
            AwarenessEntry(client_id=3, clock=999, state=None),
        ]
        encoded = encode_awareness_payload(entries)
        assert decode_awareness_payload(encoded) == entries

    def test_cleared_state_decodes_to_none(self) -> None:
        """y-protocols uses the literal string "null" to mark a cleared state."""
        entry = AwarenessEntry(client_id=10, clock=4, state=None)
        encoded = encode_awareness_payload([entry])
        decoded = decode_awareness_payload(encoded)
        assert decoded == [entry]
        assert decoded[0].state is None


class TestOuterEnvelope:
    def test_outer_envelope_round_trips(self) -> None:
        entries = [
            AwarenessEntry(
                client_id=2920663547,
                clock=3,
                state={"user": {"name": "alice", "color": "#aabbcc"}},
            ),
        ]
        message_payload = encode_awareness_message_payload(entries)
        assert decode_awareness_message_payload(message_payload) == entries


class TestDecoderRejectsBadInput:
    def test_truncated_payload_raises(self) -> None:
        # claim 1 entry but provide nothing -> IndexError out of decode_varuint
        with pytest.raises((IndexError, ValueError)):
            decode_awareness_payload(b"\x01")
