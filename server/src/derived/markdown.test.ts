import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { extractMarkdown } from './markdown.js';
import { schema } from './schema.js';

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

  it('serializes a bullet_list', () => {
    // W-008 schema extension. Two items so the renderList output is
    // unambiguous.
    const doc = buildYDoc(() =>
      schema.node('doc', null, [
        schema.node('bullet_list', null, [
          schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('first')])]),
          schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('second')])]),
        ]),
      ]),
    );
    const out = extractMarkdown(doc);
    expect(out).toContain('* first');
    expect(out).toContain('* second');
  });

  it('serializes an ordered_list', () => {
    const doc = buildYDoc(() =>
      schema.node('doc', null, [
        schema.node('ordered_list', { order: 1 }, [
          schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('first')])]),
          schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('second')])]),
        ]),
      ]),
    );
    const out = extractMarkdown(doc);
    expect(out).toContain('1. first');
    expect(out).toContain('2. second');
  });

  it('serializes a task_list with unchecked items (W-010)', () => {
    const doc = buildYDoc(() =>
      schema.node('doc', null, [
        schema.node('task_list', null, [
          schema.node('task_item', { checked: false }, [
            schema.node('paragraph', null, [schema.text('groceries')]),
          ]),
          schema.node('task_item', { checked: false }, [
            schema.node('paragraph', null, [schema.text('laundry')]),
          ]),
        ]),
      ]),
    );
    const out = extractMarkdown(doc);
    expect(out).toContain('- [ ] groceries');
    expect(out).toContain('- [ ] laundry');
  });

  it('serializes a task_list with mixed checked/unchecked items (W-010)', () => {
    const doc = buildYDoc(() =>
      schema.node('doc', null, [
        schema.node('task_list', null, [
          schema.node('task_item', { checked: true }, [
            schema.node('paragraph', null, [schema.text('done')]),
          ]),
          schema.node('task_item', { checked: false }, [
            schema.node('paragraph', null, [schema.text('still pending')]),
          ]),
        ]),
      ]),
    );
    const out = extractMarkdown(doc);
    expect(out).toContain('- [x] done');
    expect(out).toContain('- [ ] still pending');
  });

  it('serializes a code_block with a language as a fenced ```lang block (W-011)', () => {
    const doc = buildYDoc(() =>
      schema.node('doc', null, [
        schema.node('code_block', { language: 'ts' }, [schema.text('const x = 1;')]),
      ]),
    );
    const out = extractMarkdown(doc);
    expect(out).toContain('```ts');
    expect(out).toContain('const x = 1;');
  });

  it('serializes a code_block with language="text" as a bare fence (W-011)', () => {
    // 'text' is our default — markdown's fence is plain ``` (no language)
    // so unhighlighted blocks round-trip through standard tooling without
    // a fake `text` language tag leaking out.
    const doc = buildYDoc(() =>
      schema.node('doc', null, [
        schema.node('code_block', { language: 'text' }, [schema.text('plain content')]),
      ]),
    );
    const out = extractMarkdown(doc);
    expect(out).toContain('```\n');
    expect(out).not.toContain('```text');
    expect(out).toContain('plain content');
  });

  it('serializes the strike mark as ~~text~~', () => {
    const strike = schema.marks['strike']!;
    const doc = buildYDoc(() =>
      schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('keep '),
          schema.text('gone', [strike.create()]),
        ]),
      ]),
    );
    expect(extractMarkdown(doc)).toBe('keep ~~gone~~');
  });
});
