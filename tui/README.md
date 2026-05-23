# @bartleby/tui

Python + textual + y-py terminal client. Full real-time peer to the web client
via the Hocuspocus server. See top-level [`PRD.md`](../PRD.md) §7.6.

## Quick start

```sh
uv sync
uv run bartleby-tui
uv run pytest
uv run ruff check
uv run ty check
uv run prek run --all-files
```

## Tooling

Per `agents.md`:
- `uv` for env + deps. **Never edit `pyproject.toml` dependencies directly** —
  always `uv add LIB` / `uv add --dev LIB`.
- `pytest` for TDD, with shared fixtures in `tests/conftest.py`.
- `ruff` for lint + format.
- `ty` for typechecking.
- `prek` for pre-commit hooks.
- Use `logging` for debug output; **do not hide or wrap errors**.

## Phase 0 status

V-006 done: project scaffold + smoke test passes; ruff and ty clean.
V-007 will stand up the textual app and connect it to Hocuspocus.
