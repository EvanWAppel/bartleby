@agents.md

<!-- factotum:blocked-protocol -->
**Blockers → `BLOCKED.md` (system standard).** Anything only Evan can resolve — a credential, a deploy, external access, or a decision — goes in a root `BLOCKED.md`: one `- [ ]` per blocker, prefixed 🔴 blocking / 🟡 nice-to-have, **each with the specific steps a human takes to unblock it** (the action, where, any URL / path / env-var). Factotum's blocked-router scans every `BLOCKED.md` under `~/Documents` and mirrors open items into Evan's todo dashboard, so nothing waits on him invisibly. Keep the file even when nothing is blocked — heading plus "nothing blocked right now" and zero `- [ ]` lines. Full rule: Evan's global `~/.claude/CLAUDE.md`.
<!-- /factotum:blocked-protocol -->
