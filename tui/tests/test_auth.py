from __future__ import annotations

import io

import pytest

from bartleby_tui.auth import DeviceAuthError, TokenSet, ensure_access_token


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
