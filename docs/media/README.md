# Media assets

Demo assets embedded in the root [`README.md`](../../README.md) live here.

## `two-interface-demo.gif`

The flagship asset: a short looping GIF showing the **web editor and the terminal UI editing the same note at the same time**, with text propagating both ways.

It was captured against the real seeded demo stack. To replace it:

1. Bring up the full stack: `make demo`.
2. Open the printed URL, use the prefilled dev sign-in, and leave the TUI on the seeded note.
3. Arrange the browser and a terminal running the TUI side by side.
4. Screen-record ~5–10 seconds of typing in each client, showing edits appearing live in the other.
5. Export as a GIF named exactly `two-interface-demo.gif`. Keep it under ~5 MB so GitHub renders it inline (trim length / frame rate / dimensions as needed; `gifski` or `ffmpeg` work well).

Replacing the file here updates the root README automatically.

## `tui-demo.cast` (optional, nice-to-have)

An [asciinema](https://asciinema.org) cast of the TUI alone, for a crisp terminal-only recording:

```sh
asciinema rec docs/media/tui-demo.cast
```
