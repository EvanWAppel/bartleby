import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { schema } from 'prosemirror-schema-basic';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { extractMarkdown } from './markdown.js';

function buildYDoc(buildDoc: () => ReturnType<typeof schema.node>): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('prosemirror');
  prosemirrorToYXmlFragment(buildDoc(), fragment);
  return doc;
}

describe('extractMarkdown (S-009)', () => {
  it('returns empty string for an empty YDoc', () => {
    const doc = new Y.Doc();
    doc.getXmlFragment('prosemirror'); // initialize empty fragment
    expect(extractMarkdown(doc)).toBe('');
  });

  it('serializes a plain paragraph', () => {
    const doc = buildYDoc(() =>
      schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello world')])]),
    );
    expect(extractMarkdown(doc)).toBe('hello world');
  });

  it('serializes a heading', () => {
    const doc = buildYDoc(() =>
      schema.node('doc', null, [
        schema.node('heading', { level: 2 }, [schema.text('chapter one')]),
      ]),
    );
    expect(extractMarkdown(doc)).toContain('## chapter one');
  });

  it('serializes bold inline marks', () => {
    const strong = schema.marks['strong']!;
    const doc = buildYDoc(() =>
      schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('be '),
          schema.text('bold', [strong.create()]),
        ]),
      ]),
    );
    expect(extractMarkdown(doc)).toBe('be **bold**');
  });

  it('serializes [[backlink]] inline (via plain text)', () => {
    // Until we ship a real backlink node, [[link]] is just literal text
    // in the markdown — the backlink extractor (separate module) regexes
    // for it.
    const doc = buildYDoc(() =>
      schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('see [[Trip to Spain]] for details')]),
      ]),
    );
    expect(extractMarkdown(doc)).toContain('[[Trip to Spain]]');
  });
});
