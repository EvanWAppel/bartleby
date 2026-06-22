// M-001 / M-002: scan a markdown string for `@<email>` mentions.
//
// The W-013 mention node serializes as `@<email>` in markdown. We
// extract those occurrences here for both the body-mention pipeline
// (S-009 hook → M-001) and comment-mention pipeline (M-002).
//
// Match rules:
//   - The leading `@` must be at start-of-string or preceded by
//     whitespace — matches the W-013 mention-trigger-plugin's
//     start-boundary check so the extractor and the editor agree on
//     what counts as a mention.
//   - The body of the email is a permissive `local@domain.tld` shape
//     (RFC 5321 allows funky characters; we deliberately stay narrow:
//     letters/digits/`._%+-` for local, letters/digits/`.-` for the
//     hostname, and a 2+ char top-level domain).
//   - Emails are lowercased on extraction so `@Alice@…` and
//     `@alice@…` dedupe in the mentions table.

const MENTION_REGEX =
  /(?:^|[\s\n])@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,})/g;

export function extractMentionEmails(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(MENTION_REGEX)) {
    out.add(m[1]!.toLowerCase());
  }
  return [...out];
}
