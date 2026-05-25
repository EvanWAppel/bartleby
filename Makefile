# Bartleby monorepo Makefile.
#
# `make dev`       — run server, web, and TUI concurrently
# `make test`      — run server + web + tui test suites (no e2e)
# `make test-e2e`  — run Playwright e2e in web (slow; spawns server + vite)
# `make lint`      — lint all three components
# `make typecheck` — typecheck all three components
# `make install`   — install deps in all three components + root hooks
# `make clean`     — remove node_modules + .venv + build artifacts

.PHONY: dev test test-e2e lint typecheck install clean

# Default target prints help.
.DEFAULT_GOAL := help

help:
	@echo "Bartleby make targets:"
	@echo "  make install     Install all deps (root hooks + server + web + tui)"
	@echo "  make dev         Run server + web + tui concurrently"
	@echo "  make test        Run all unit/integration test suites"
	@echo "  make test-e2e    Run Playwright e2e (web)"
	@echo "  make lint        Lint all three components"
	@echo "  make typecheck   Typecheck all three components"
	@echo "  make clean       Remove deps and build artifacts"

install:
	npm install
	npm --prefix server install
	npm --prefix web install
	cd tui && uv sync

dev:
	npm run dev

test:
	npm --prefix server test
	npm --prefix web test
	cd tui && uv run pytest

test-e2e:
	npm --prefix web run test:e2e

lint:
	npm --prefix server run lint
	npm --prefix web run lint
	cd tui && uv run ruff check

typecheck:
	npm --prefix server run typecheck
	npm --prefix web run typecheck
	cd tui && uv run ty check

clean:
	rm -rf node_modules server/node_modules web/node_modules
	rm -rf web/.svelte-kit web/build server/dist
	rm -rf tui/.venv tui/.pytest_cache tui/.ruff_cache tui/.ty_cache
	find . -type d -name __pycache__ -exec rm -rf {} +
