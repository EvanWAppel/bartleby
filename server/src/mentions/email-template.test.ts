// M-006: pure-function tests for the rendered mention-email template.
//
// The template is a no-IO function — given a recipient and a list of
// items, it returns `{ subject, html, text }`. Tests cover:
//   - single-mention subject vs multi-mention subject
//   - the HTML contains the recipient, the mentioner, the note title,
//     a snippet, and a deep link
//   - the plain-text variant contains the same fields
//   - deep links are built off the supplied PUBLIC_BASE_URL

import { describe, expect, test } from 'vitest';
import { renderMentionBatch, type MentionEmailItem } from './email-template.js';

const PUBLIC_BASE_URL = 'https://bartleby.example';

function item(overrides: Partial<MentionEmailItem> = {}): MentionEmailItem {
  return {
    mentionerName: 'Bob',
    mentionerEmail: 'bob@example.com',
    noteId: 'note-abc',
    noteTitle: 'Trip notes',
    source: 'note',
    snippet: 'hey @alice@example.com check this out',
    mentionedAt: '2026-06-22T12:00:00.000Z',
    ...overrides,
  };
}

describe('renderMentionBatch (M-006)', () => {
  test('subject for one mention names the mentioner', () => {
    const out = renderMentionBatch({
      recipientName: 'Alice',
      recipientEmail: 'alice@example.com',
      publicBaseUrl: PUBLIC_BASE_URL,
      items: [item()],
    });
    expect(out.subject).toBe('Bob mentioned you in Bartleby');
  });

  test('subject for multiple mentions reports the count', () => {
    const out = renderMentionBatch({
      recipientName: 'Alice',
      recipientEmail: 'alice@example.com',
      publicBaseUrl: PUBLIC_BASE_URL,
      items: [item(), item({ noteTitle: 'Other' }), item({ noteTitle: 'Third' })],
    });
    expect(out.subject).toBe('3 new mentions in Bartleby');
  });

  test('html contains recipient name, note title, snippet, and deep link', () => {
    const out = renderMentionBatch({
      recipientName: 'Alice',
      recipientEmail: 'alice@example.com',
      publicBaseUrl: PUBLIC_BASE_URL,
      items: [
        item({
          mentionerName: 'Bob',
          noteId: 'note-xyz',
          noteTitle: 'Spain',
          snippet: 'hey @alice@example.com take a look',
        }),
      ],
    });
    expect(out.html).toContain('Alice');
    expect(out.html).toContain('Bob');
    expect(out.html).toContain('Spain');
    expect(out.html).toContain('hey @alice@example.com take a look');
    expect(out.html).toContain('https://bartleby.example/n/note-xyz');
  });

  test('html escapes title/snippet to prevent HTML injection', () => {
    const out = renderMentionBatch({
      recipientName: 'Alice',
      recipientEmail: 'alice@example.com',
      publicBaseUrl: PUBLIC_BASE_URL,
      items: [
        item({
          noteTitle: '<script>alert(1)</script>',
          snippet: 'inline <img src=x onerror=alert(1)>',
        }),
      ],
    });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  test('text variant contains the deep link and the snippet', () => {
    const out = renderMentionBatch({
      recipientName: 'Alice',
      recipientEmail: 'alice@example.com',
      publicBaseUrl: PUBLIC_BASE_URL,
      items: [
        item({
          noteId: 'note-xyz',
          noteTitle: 'Spain',
          snippet: 'hey @alice@example.com take a look',
        }),
      ],
    });
    expect(out.text).toContain('https://bartleby.example/n/note-xyz');
    expect(out.text).toContain('hey @alice@example.com take a look');
    expect(out.text).toContain('Spain');
  });

  test('lists every item in multi-mention batches', () => {
    const out = renderMentionBatch({
      recipientName: 'Alice',
      recipientEmail: 'alice@example.com',
      publicBaseUrl: PUBLIC_BASE_URL,
      items: [
        item({ noteId: 'n1', noteTitle: 'First', snippet: 'one' }),
        item({ noteId: 'n2', noteTitle: 'Second', snippet: 'two' }),
        item({ noteId: 'n3', noteTitle: 'Third', snippet: 'three' }),
      ],
    });
    expect(out.html).toContain('First');
    expect(out.html).toContain('Second');
    expect(out.html).toContain('Third');
    expect(out.html).toContain('https://bartleby.example/n/n1');
    expect(out.html).toContain('https://bartleby.example/n/n2');
    expect(out.html).toContain('https://bartleby.example/n/n3');
    expect(out.text).toContain('https://bartleby.example/n/n1');
    expect(out.text).toContain('https://bartleby.example/n/n2');
    expect(out.text).toContain('https://bartleby.example/n/n3');
  });

  test('source "comment" is surfaced distinctly from "note"', () => {
    const out = renderMentionBatch({
      recipientName: 'Alice',
      recipientEmail: 'alice@example.com',
      publicBaseUrl: PUBLIC_BASE_URL,
      items: [item({ source: 'comment' })],
    });
    expect(out.html.toLowerCase()).toContain('comment');
    expect(out.text.toLowerCase()).toContain('comment');
  });

  test('throws on empty items array (caller bug)', () => {
    expect(() =>
      renderMentionBatch({
        recipientName: 'Alice',
        recipientEmail: 'alice@example.com',
        publicBaseUrl: PUBLIC_BASE_URL,
        items: [],
      }),
    ).toThrow();
  });
});
