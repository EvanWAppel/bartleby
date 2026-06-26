"""Device-code authentication for the TUI.

T-002 first-run flow:
1. Reuse a non-expired access token from the token store when present.
2. Otherwise call ``POST /auth/device/start``.
3. Print the verification URL + user code for the operator.
4. Poll ``POST /auth/device/poll`` until approved.
5. Store the access/refresh token pair in the OS keyring.
"""

from __future__ import annotations

import asyncio
import json
import time
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol, TextIO, cast

import keyring

SERVICE_NAME = "bartleby-tui"
ACCOUNT_NAME = "default"
TOKEN_EXPIRY_SKEW_SECONDS = 30


@dataclass(frozen=True)
class TokenSet:
    access_token: str
    refresh_token: str
    expires_at: float


class TokenStore(Protocol):
    def load(self) -> TokenSet | None: ...

    def save(self, tokens: TokenSet) -> None: ...


class KeyringTokenStore:
    """Store the TUI token pair in the OS keyring."""

    def __init__(self, service_name: str = SERVICE_NAME, account_name: str = ACCOUNT_NAME) -> None:
        self._service_name = service_name
        self._account_name = account_name

    def load(self) -> TokenSet | None:
        raw = keyring.get_password(self._service_name, self._account_name)
        if raw is None:
            return None
        data = json.loads(raw)
        return TokenSet(
            access_token=_require_str(data, "access_token"),
            refresh_token=_require_str(data, "refresh_token"),
            expires_at=_require_number(data, "expires_at"),
        )

    def save(self, tokens: TokenSet) -> None:
        keyring.set_password(
            self._service_name,
            self._account_name,
            json.dumps(
                {
                    "access_token": tokens.access_token,
                    "refresh_token": tokens.refresh_token,
                    "expires_at": tokens.expires_at,
                },
            ),
        )


class DeviceAuthError(RuntimeError):
    """Raised when the device-code flow cannot complete."""


async def ensure_access_token(
    http_base_url: str,
    *,
    store: TokenStore | None = None,
    output: TextIO,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    now: Callable[[], float] = time.time,
) -> str:
    """Return a usable access token, running device-code auth on first use."""

    token_store = store if store is not None else KeyringTokenStore()
    existing = token_store.load()
    if existing is not None and existing.expires_at - TOKEN_EXPIRY_SKEW_SECONDS > now():
        return existing.access_token

    client = DeviceAuthClient(http_base_url)
    started = await client.start()
    output.write(
        "Open this URL to authorize Bartleby TUI:\n"
        f"{started.verification_uri}\n\n"
        f"Enter code: {started.user_code}\n",
    )
    output.flush()

    while True:
        polled = await client.poll(started.device_code)
        if polled.status == "pending":
            await sleep(started.interval)
            continue
        if polled.status == "expired":
            raise DeviceAuthError("device code expired before approval")

        expires_at = now() + polled.expires_in
        tokens = TokenSet(
            access_token=polled.access_token,
            refresh_token=polled.refresh_token,
            expires_at=expires_at,
        )
        token_store.save(tokens)
        return tokens.access_token


@dataclass(frozen=True)
class DeviceStartResponse:
    device_code: str
    user_code: str
    verification_uri: str
    interval: int
    expires_in: int


@dataclass(frozen=True)
class DevicePollResponse:
    status: str
    access_token: str = ""
    refresh_token: str = ""
    expires_in: int = 0


class DeviceAuthClient:
    def __init__(self, http_base_url: str) -> None:
        self._base = http_base_url.rstrip("/")

    async def start(self) -> DeviceStartResponse:
        data = await _post_json(f"{self._base}/auth/device/start", {})
        return DeviceStartResponse(
            device_code=_require_str(data, "device_code"),
            user_code=_require_str(data, "user_code"),
            verification_uri=_require_str(data, "verification_uri"),
            interval=int(_require_number(data, "interval")),
            expires_in=int(_require_number(data, "expires_in")),
        )

    async def poll(self, device_code: str) -> DevicePollResponse:
        try:
            data = await _post_json(f"{self._base}/auth/device/poll", {"device_code": device_code})
        except urllib.error.HTTPError as exc:
            if exc.code == 428:
                return DevicePollResponse(status="pending")
            if exc.code == 410:
                return DevicePollResponse(status="expired")
            raise
        return DevicePollResponse(
            status="approved",
            access_token=_require_str(data, "access_token"),
            refresh_token=_require_str(data, "refresh_token"),
            expires_in=int(_require_number(data, "expires_in")),
        )


async def _post_json(url: str, payload: dict[str, object]) -> dict[str, Any]:
    return await asyncio.to_thread(_post_json_sync, url, payload)


def _post_json_sync(url: str, payload: dict[str, object]) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"content-type": "application/json", "accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        decoded = json.loads(res.read().decode("utf-8"))
    if not isinstance(decoded, dict):
        raise DeviceAuthError("expected JSON object response")
    return decoded


def _require_str(data: object, field: str) -> str:
    if not isinstance(data, dict):
        raise DeviceAuthError("expected JSON object")
    obj = cast("Mapping[str, object]", data)
    value = obj.get(field)
    if not isinstance(value, str):
        raise DeviceAuthError(f"expected string field {field}")
    return value


def _require_number(data: object, field: str) -> float:
    if not isinstance(data, dict):
        raise DeviceAuthError("expected JSON object")
    obj = cast("Mapping[str, object]", data)
    value = obj.get(field)
    if not isinstance(value, (int, float)):
        raise DeviceAuthError(f"expected number field {field}")
    return float(value)
