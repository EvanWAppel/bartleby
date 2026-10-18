from __future__ import annotations

from typing import Any

import bartleby_tui.app as app_module
from bartleby_tui.auth import TokenSet


def test_main_opens_the_note_selected_by_the_environment(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    class FakeApp:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

        def run(self) -> None:
            captured["ran"] = True

    monkeypatch.setattr(app_module, "BartlebyApp", FakeApp)
    monkeypatch.setenv("BARTLEBY_HTTP_URL", "http://127.0.0.1:3000")
    monkeypatch.setenv("BARTLEBY_NOTE_ID", "demo-note-id")
    monkeypatch.delenv("BARTLEBY_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("BARTLEBY_WS_URL", raising=False)

    app_module.main()

    assert captured == {
        "server_url": app_module.DEFAULT_SERVER_URL,
        "doc_name": "demo-note-id",
        "http_base_url": "http://127.0.0.1:3000",
        "token_store": None,
        "ran": True,
    }


def test_main_uses_an_environment_access_token(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    class FakeApp:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

        def run(self) -> None:
            return

    monkeypatch.setattr(app_module, "BartlebyApp", FakeApp)
    monkeypatch.setenv("BARTLEBY_ACCESS_TOKEN", "demo-access-token")
    monkeypatch.delenv("BARTLEBY_NOTE_ID", raising=False)

    app_module.main()

    token_store = captured["token_store"]
    assert token_store is not None
    tokens = token_store.load()
    assert isinstance(tokens, TokenSet)
    assert tokens.access_token == "demo-access-token"


def test_main_connects_to_the_collaboration_url_from_the_environment(monkeypatch) -> None:
    """A deployed server is reached via BARTLEBY_WS_URL, not the localhost default."""
    captured: dict[str, Any] = {}

    class FakeApp:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

        def run(self) -> None:
            return

    monkeypatch.setattr(app_module, "BartlebyApp", FakeApp)
    monkeypatch.setenv("BARTLEBY_WS_URL", "wss://bartleby.example.com/collaboration")
    monkeypatch.setenv("BARTLEBY_HTTP_URL", "https://bartleby.example.com")
    monkeypatch.delenv("BARTLEBY_ACCESS_TOKEN", raising=False)

    app_module.main()

    assert captured["server_url"] == "wss://bartleby.example.com/collaboration"
    assert captured["http_base_url"] == "https://bartleby.example.com"
