from __future__ import annotations

import io

import pytest

from bartleby_tui.auth import (
    DeviceAuthError,
    TokenSet,
    ensure_access_token,
    fetch_user_info,
)


class MemoryTokenStore:
    def __init__(self, tokens: TokenSet | None = None) -> None:
        self.tokens = tokens
        self.saved: TokenSet | None = None

    def load(self) -> TokenSet | None:
        return self.tokens

    def save(self, tokens: TokenSet) -> None:
        self.saved = tokens
        self.tokens = tokens


async def no_sleep(_seconds: float) -> None:
    return


async def test_ensure_access_token_reuses_unexpired_keychain_token() -> None:
    store = MemoryTokenStore(
        TokenSet(access_token="cached-access", refresh_token="cached-refresh", expires_at=10_000)
    )
    output = io.StringIO()

    token = await ensure_access_token(
        "http://127.0.0.1:1",
        store=store,
        output=output,
        now=lambda: 100,
    )

    assert token == "cached-access"
    assert output.getvalue() == ""
    assert store.saved is None


async def test_device_code_first_run_prints_code_polls_and_stores_token(
    mock_device_auth_server,
) -> None:
    store = MemoryTokenStore()
    output = io.StringIO()

    async def approve_after_first_pending(_seconds: float) -> None:
        mock_device_auth_server.approve()

    token = await ensure_access_token(
        mock_device_auth_server.base_url,
        store=store,
        output=output,
        sleep=approve_after_first_pending,
        now=lambda: 1_000,
    )

    assert token == mock_device_auth_server.access_token
    assert mock_device_auth_server.poll_count == 2
    assert mock_device_auth_server.base_url in output.getvalue()
    assert mock_device_auth_server.user_code in output.getvalue()
    assert store.saved is not None
    assert store.saved.access_token == mock_device_auth_server.access_token
    assert store.saved.refresh_token == mock_device_auth_server.refresh_token
    assert store.saved.expires_at == 1_900


async def test_device_code_expiry_raises_and_does_not_store_token(mock_device_auth_server) -> None:
    mock_device_auth_server.expire()
    store = MemoryTokenStore()

    with pytest.raises(DeviceAuthError, match="expired"):
        await ensure_access_token(
            mock_device_auth_server.base_url,
            store=store,
            output=io.StringIO(),
            sleep=no_sleep,
        )

    assert store.saved is None


# T-024: TUI consumes GET /auth/me to learn the server-assigned color.


async def test_fetch_user_info_returns_color_and_identity(mock_device_auth_server) -> None:
    info = await fetch_user_info(
        mock_device_auth_server.base_url,
        mock_device_auth_server.access_token,
    )

    assert info.id == mock_device_auth_server.user_id
    assert info.email == mock_device_auth_server.user_email
    assert info.display_name == mock_device_auth_server.user_display_name
    assert info.color == mock_device_auth_server.user_color
    assert info.color.startswith("#")
    assert (
        mock_device_auth_server.last_authorization
        == f"Bearer {mock_device_auth_server.access_token}"
    )
    assert mock_device_auth_server.me_count == 1


async def test_fetch_user_info_rejects_bad_token(mock_device_auth_server) -> None:
    # Wrong token → 401 → urllib HTTPError; we don't wrap, per agents.md.
    import urllib.error

    with pytest.raises(urllib.error.HTTPError):
        await fetch_user_info(mock_device_auth_server.base_url, "not-a-real-token")


async def test_two_users_have_distinct_colors_from_auth_me(mock_device_auth_server) -> None:
    """Acceptance for T-024: two users surface distinct palette entries."""
    # Round 1: default state (Alice / palette entry A).
    alice = await fetch_user_info(
        mock_device_auth_server.base_url,
        mock_device_auth_server.access_token,
    )

    # Round 2: flip the server to a different user.
    mock_device_auth_server.user_id = "user-2"
    mock_device_auth_server.user_email = "bob@example.com"
    mock_device_auth_server.user_display_name = "Bob"
    mock_device_auth_server.user_color = "#e6194b"
    bob = await fetch_user_info(
        mock_device_auth_server.base_url,
        mock_device_auth_server.access_token,
    )

    assert alice.color != bob.color
    assert alice.email != bob.email
