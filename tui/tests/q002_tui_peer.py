"""Q-002 helper: a y-py TUI peer, driven from the Playwright web↔TUI e2e.

Not a pytest module (no ``test_`` prefix) — it's a standalone script the
Playwright test spawns via ``uv --project tui run python``.

Usage:
    q002_tui_peer.py <ws_url> <room> <bearer> <tui_marker> <web_marker>

Connects to the same Hocuspocus room the web client uses (the bare note id),
types ``<tui_marker>`` into the ``prosemirror`` fragment, waits for the web
peer's ``<web_marker>`` to converge, prints the final fragment text, and exits
0 iff BOTH markers are present (no data loss).
"""

from __future__ import annotations

import asyncio
import sys

import y_py as Y

from bartleby_tui.connection import HocuspocusConnection


def _fragment_text(doc: Y.YDoc) -> str:
    parts: list[str] = []
    node = doc.get_xml_element("prosemirror").first_child
    while node is not None:
        parts.append(str(node))
        node = node.next_sibling
    return " ".join(parts)


def _log(msg: str) -> None:
    print(f"[q002-peer] {msg}", file=sys.stderr, flush=True)


async def _run(ws_url: str, room: str, bearer: str, tui_marker: str, web_marker: str) -> int:
    _log(f"connecting url={ws_url} room={room} bearer={'yes' if bearer else 'no'}")
    doc = Y.YDoc()
    async with HocuspocusConnection(
        url=ws_url, doc_name=room, document=doc, bearer_token=bearer or None
    ) as conn:
        await asyncio.wait_for(conn.wait_synced(), timeout=15.0)
        _log(f"synced; initial fragment={_fragment_text(doc)!r}")

        # Type the TUI marker into the shared prosemirror fragment.
        xml = doc.get_xml_element("prosemirror")
        with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
            para = xml.push_xml_element(txn, "paragraph")
            para.push_xml_text(txn).push(txn, tui_marker)
        _log(f"typed {tui_marker!r}; fragment now={_fragment_text(doc)!r}")

        # Keep the connection OPEN until the test signals it has confirmed the
        # web side (by closing our stdin) — otherwise we'd exit before this
        # edit flushes to the server. The web marker is already present from
        # the initial sync, so we can't use it as a wait condition. A 30s cap
        # guards against the test dying without closing stdin.
        try:
            await asyncio.wait_for(asyncio.to_thread(sys.stdin.readline), timeout=30.0)
        except TimeoutError:
            _log("stdin wait timed out")

        text = _fragment_text(doc)
        _log(f"final fragment={text!r}")
        print(text, flush=True)
        return 0 if (tui_marker in text and web_marker in text) else 1


def main() -> None:
    ws_url, room, bearer, tui_marker, web_marker = sys.argv[1:6]
    sys.exit(asyncio.run(_run(ws_url, room, bearer, tui_marker, web_marker)))


if __name__ == "__main__":
    main()
