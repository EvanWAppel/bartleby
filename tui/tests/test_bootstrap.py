"""Toolchain smoke test for V-006."""

from __future__ import annotations

from bartleby_tui import APP_NAME


def test_app_identity() -> None:
    assert APP_NAME == "bartleby-tui"
