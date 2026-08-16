# Media assets

Demo assets embedded in the root [`README.md`](../../README.md) live here.

## `two-interface-demo.gif` (required)

The flagship asset: a short looping GIF showing the **web editor and the terminal UI editing the same note at the same time**, with text propagating both ways.

How to record it:

1. Bring up the full stack: `make dev` (server + web + TUI).
2. Sign in locally (see [`../LAUNCH-CHECKLIST.md`](../LAUNCH-CHECKLIST.md) Part 0 for the dev sign-in) and open the same note in the browser and the TUI.
3. Arrange the browser and a terminal running the TUI side by side.
4. Screen-record ~5–10 seconds of typing in each client, showing edits appearing live in the other.
5. Export as a GIF named exactly `two-interface-demo.gif`. Keep it under ~5 MB so GitHub renders it inline (trim length / frame rate / dimensions as needed; `gifski` or `ffmpeg` work well).

Drop the file here and it renders automatically in the root README — no other change needed.

## `tui-demo.cast` (optional, nice-to-have)

An [asciinema](https://asciinema.org) cast of the TUI alone, for a crisp terminal-only recording:

```sh
asciinema rec docs/media/tui-demo.cast
```
