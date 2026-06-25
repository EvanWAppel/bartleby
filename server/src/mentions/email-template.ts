// M-006: pure renderer for a batched-mention email.
//
// Given a recipient and a non-empty list of mention items, returns the
// `{ subject, html, text }` triple the sender hands to Resend. No IO,
// no logging — straightforward string assembly with HTML escaping so a
// hostile note title or snippet can't inject scripts into the email.
//
// Deep-link format: `${PUBLIC_BASE_URL}/n/{noteId}`. The web app's
// auth middleware redirects unauthed visitors to /login, so the link
// is auth-gated without needing a signed magic-link in v1.

export type MentionEmailSource = 'note' | 'comment';

export interface MentionEmailItem {
  /** Display name of the person who mentioned the recipient. */
  mentionerName: string;
  /** Email of the mentioner — shown when the display name is generic. */
  mentionerEmail: string;
  noteId: string;
  noteTitle: string;
  /** Whether the mention lived in the note body or a comment. */
  source: MentionEmailSource;
  /** A short context string (a sentence or two around the mention). */
  snippet: string;
  /** ISO timestamp of the mention. Surfaced in logs, not the body. */
  mentionedAt: string;
}

export interface RenderMentionBatchInput {
  recipientName: string;
  recipientEmail: string;
  publicBaseUrl: string;
  items: MentionEmailItem[];
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function deepLink(publicBaseUrl: string, noteId: string): string {
  // Trim a trailing slash so we don't produce `//n/...`.
  const base = publicBaseUrl.replace(/\/+$/, '');
  return `${base}/n/${encodeURIComponent(noteId)}`;
}

function sourceLabel(source: MentionEmailSource): string {
  return source === 'comment' ? 'in a comment on' : 'in';
}

export function renderMentionBatch(input: RenderMentionBatchInput): RenderedEmail {
  const { recipientName, publicBaseUrl, items } = input;
  if (items.length === 0) {
    throw new Error('renderMentionBatch: items must not be empty');
  }

  const subject =
    items.length === 1
      ? `${items[0]!.mentionerName} mentioned you in Bartleby`
      : `${items.length} new mentions in Bartleby`;

  // HTML body. Inline styles only — most email clients strip <style>
  // blocks and external sheets. Keep markup boring (table-less; modern
  // clients render flexbox + block fine for simple notifications).
  const itemHtml = items
    .map((it) => {
      const link = deepLink(publicBaseUrl, it.noteId);
      const noteTitle = escapeHtml(it.noteTitle);
      const snippet = escapeHtml(it.snippet);
      const mentionerName = escapeHtml(it.mentionerName);
      const sourceText = sourceLabel(it.source);
      return [
        '<div style="margin: 0 0 24px 0; padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px;">',
        `<p style="margin: 0 0 8px 0; color: #374151;">`,
        `<strong>${mentionerName}</strong> mentioned you ${sourceText} `,
        `<a href="${link}" style="color: #2563eb; text-decoration: none;">${noteTitle}</a>`,
        `</p>`,
        `<blockquote style="margin: 8px 0 12px 0; padding: 8px 12px; border-left: 3px solid #d1d5db; color: #4b5563; font-style: italic;">`,
        snippet,
        `</blockquote>`,
        `<p style="margin: 0;"><a href="${link}" style="color: #2563eb;">Open note</a></p>`,
        '</div>',
      ].join('');
    })
    .join('\n');

  const html = [
    '<!doctype html>',
    '<html><body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 640px; margin: 24px auto; padding: 0 16px; color: #111827;">',
    `<p style="margin: 0 0 16px 0;">Hi ${escapeHtml(recipientName)},</p>`,
    `<p style="margin: 0 0 24px 0;">${
      items.length === 1
        ? 'You were mentioned in Bartleby:'
        : `You have ${items.length} new mentions in Bartleby:`
    }</p>`,
    itemHtml,
    '<p style="margin: 24px 0 0 0; color: #6b7280; font-size: 12px;">You received this email because you were @-mentioned in a Bartleby note or comment.</p>',
    '</body></html>',
  ].join('\n');

  // Plain-text variant. One bullet per item; the deep link sits on its
  // own line so clients that auto-linkify URLs can do their thing.
  const textItems = items
    .map((it) => {
      const link = deepLink(publicBaseUrl, it.noteId);
      const sourceText = sourceLabel(it.source);
      return [
        `- ${it.mentionerName} mentioned you ${sourceText} "${it.noteTitle}":`,
        `  "${it.snippet}"`,
        `  ${link}`,
      ].join('\n');
    })
    .join('\n\n');

  const text = [
    `Hi ${recipientName},`,
    '',
    items.length === 1
      ? 'You were mentioned in Bartleby:'
      : `You have ${items.length} new mentions in Bartleby:`,
    '',
    textItems,
    '',
    'You received this email because you were @-mentioned in a Bartleby note or comment.',
  ].join('\n');

  return { subject, html, text };
}
