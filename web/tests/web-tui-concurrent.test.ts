// Q-002: web + TUI on the same note, simultaneous typing, no data loss.
//
// The web client is a real browser running y-prosemirror; the "TUI client" is
// a real y-py peer (the actual TUI connection layer) spawned as a subprocess
// via `uv --project ../tui run python tests/q002_tui_peer.py`. Both join the
// SAME Hocuspocus room — the bare note id, which is what the web
// (`room={data.id}`) and the server (`findById(documentName)`) use, and what
// the TUI was fixed to use here.
//
// The peer authenticates with the session JWT minted by /auth/dev/sign-in
// (the WS onAuthenticate verifies the bearer as a session JWT). Each side
// types a distinct marker; "no data loss" = both markers converge into both
// the web editor's DOM and the peer's YDoc.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TUI_DIR = path.resolve(__dirname, '..', '..', 'tui');
const PEER = path.resolve(TUI_DIR, 'tests', 'q002_tui_peer.py');
const WS_URL = 'ws://127.0.0.1:1234';

const WEB_MARKER = 'WEBEDIT';
const TUI_MARKER = 'TUIEDIT';

async function readEditorText(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const editor = document.querySelector('[data-testid="editor"] .ProseMirror');
    if (!editor) return '';
    const clone = editor.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('.ProseMirror-yjs-cursor, .ProseMirror-yjs-selection')
      .forEach((n) => n.remove());
    return Array.from(clone.children)
      .map((c) => (c as HTMLElement).textContent ?? '')
      .join('\n');
  });
}

interface Peer {
  exit: Promise<number>;
  output: () => string;
  // Signal the peer it may exit (it stays connected until then, so its edit
  // has time to reach the web). Closing stdin is the signal.
  done: () => void;
}

function spawnTuiPeer(room: string, bearer: string): Peer {
  const proc = spawn(
    'uv',
    ['--project', TUI_DIR, 'run', 'python', PEER, WS_URL, room, bearer, TUI_MARKER, WEB_MARKER],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '';
  proc.stdout.on('data', (d: Buffer) => (output += d.toString()));
  proc.stderr.on('data', (d: Buffer) => process.stderr.write(d));
  const exit = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? -1)));
  return { exit, output: () => output, done: () => proc.stdin?.end() };
}

test('web + TUI on the same note converge with no data loss (Q-002)', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `q002-${Date.now()}`);

  // The WS peer authenticates with the session JWT from the dev sign-in.
  const cookies = await context.cookies();
  const jwt = cookies.find((c) => c.name === 'bartleby_session')?.value ?? '';
  expect(jwt, 'expected a bartleby_session cookie from dev sign-in').not.toBe('');

  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.waitFor({ state: 'visible' });
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });

  // Spawn the TUI peer on the same room; it types its marker, then waits for
  // the web's marker to converge before exiting 0.
  const peer = spawnTuiPeer(note.id, jwt);

  // Web types its marker concurrently.
  await editor.click();
  await page.keyboard.type(WEB_MARKER, { delay: 0 });

  // No data loss: the web editor must show the TUI peer's marker too. The
  // peer stays connected until we close its stdin below, so its edit has time
  // to converge here.
  try {
    await expect
      .poll(async () => await readEditorText(page), { timeout: 20_000 })
      .toContain(TUI_MARKER);
    expect(await readEditorText(page)).toContain(WEB_MARKER);
  } finally {
    peer.done(); // let the peer flush + exit
  }

  // And the peer must have seen both markers in its own YDoc (exit 0).
  const code = await peer.exit;
  expect(code, `tui peer output: ${peer.output()}`).toBe(0);

  await context.close();
});
