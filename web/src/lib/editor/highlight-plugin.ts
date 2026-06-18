// W-011 Shiki syntax-highlighting plugin for code_block nodes.
//
// Architecture:
//   - A ProseMirror Plugin holds a DecorationSet (one inline Decoration
//     per Shiki token, carrying class="shiki-tok-<type>" plus an inline
//     color style).
//   - On doc change, a debounced microtask re-tokenizes every code_block
//     with a non-'text' language and dispatches a meta-only transaction
//     that swaps the DecorationSet wholesale.
//   - We use ProseMirror Decorations (not contentDOM rewrites) so the
//     editable text stays a plain <code> text node — pasting, undo, and
//     y-prosemirror's diff all keep working.
//
// Shiki cost:
//   - The full Shiki engine + grammars are dynamic-imported the first
//     time a code_block needs highlighting, so an editor with no code
//     blocks never pays the bundle cost.
//   - We create exactly one Highlighter (module-level promise) and
//     preload our curated language list.
//
// Token-class strategy:
//   - Shiki tokens carry `explanation[].scopes[].scopeName` (TextMate
//     scopes like 'keyword.control.ts'). We coarse-classify the first
//     matching scope to a small fixed taxonomy (keyword, string,
//     number, comment, function, …) and emit `shiki-tok-<type>` as the
//     class. The W-011 spec test asserts on the presence of these
//     classes — fine-grained scopes would force the test into knowing
//     Shiki grammar internals.
//   - We also carry Shiki's resolved color as an inline style so the
//     block is visibly highlighted without us shipping a stylesheet
//     per theme.

import type { Plugin as PMPlugin, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView, DecorationSet as DecorationSetType } from 'prosemirror-view';
import type { Schema } from 'prosemirror-model';
import { SUPPORTED_CODE_LANGUAGES, DEFAULT_CODE_LANGUAGE } from './code-languages.js';

// Lazy-loaded references — populated on first `ensureHighlighter()`.
// Module-level so the editor only pays the Shiki bundle cost once even
// across multiple EditorViews / re-mounts.
let highlighterPromise: Promise<unknown> | null = null;

interface ShikiToken {
  content: string;
  offset: number;
  color?: string;
  explanation?: { scopes: { scopeName: string }[] }[];
}

interface ShikiHighlighter {
  codeToTokens(
    code: string,
    options: { lang: string; theme: string; includeExplanation?: boolean },
  ): { tokens: ShikiToken[][] };
}

async function ensureHighlighter(): Promise<ShikiHighlighter> {
  if (highlighterPromise === null) {
    highlighterPromise = (async (): Promise<ShikiHighlighter> => {
      const { createHighlighter } = await import('shiki');
      const langs = SUPPORTED_CODE_LANGUAGES.filter((l) => l.id !== DEFAULT_CODE_LANGUAGE).map(
        (l) => l.id,
      );
      const hl = await createHighlighter({ themes: ['light-plus'], langs });
      return hl as unknown as ShikiHighlighter;
    })();
  }
  return highlighterPromise as Promise<ShikiHighlighter>;
}

// Coarse TextMate-scope → class-suffix classifier. The order matters
// — more-specific scopes come first so e.g. `entity.name.function`
// wins over the generic `entity` bucket. The classes are intentionally
// stable (independent of Shiki version) so the spec test can assert on
// them.
function classifyScope(scopes: readonly string[]): string {
  for (const s of scopes) {
    if (s.startsWith('comment')) return 'comment';
    if (s.startsWith('string')) return 'string';
    if (s.startsWith('constant.numeric')) return 'number';
    if (s.startsWith('constant.language')) return 'constant';
    if (s.startsWith('constant')) return 'constant';
    if (s.startsWith('keyword')) return 'keyword';
    if (s.startsWith('storage')) return 'keyword';
    if (s.startsWith('entity.name.function')) return 'function';
    if (s.startsWith('entity.name.class')) return 'class';
    if (s.startsWith('entity.name.type')) return 'type';
    if (s.startsWith('support.function')) return 'function';
    if (s.startsWith('support.type')) return 'type';
    if (s.startsWith('variable')) return 'variable';
    if (s.startsWith('punctuation')) return 'punctuation';
    if (s.startsWith('meta.tag')) return 'tag';
  }
  return 'plain';
}

function deepestScopeNames(token: ShikiToken): string[] {
  const last = token.explanation?.[token.explanation.length - 1];
  if (last === undefined) return [];
  // Reverse so the most-specific (deepest) scope is first.
  return last.scopes
    .map((s) => s.scopeName)
    .slice()
    .reverse();
}

// Build the decoration list for a single code_block.
// `contentStart` is the doc position of the first character INSIDE
// the code_block (i.e., pos + 1 where pos is the block's start).
function decorationsForBlock(
  Decoration: typeof import('prosemirror-view').Decoration,
  highlighter: ShikiHighlighter,
  lang: string,
  text: string,
  contentStart: number,
): import('prosemirror-view').Decoration[] {
  const out: import('prosemirror-view').Decoration[] = [];
  const result = highlighter.codeToTokens(text, {
    lang,
    theme: 'light-plus',
    includeExplanation: true,
  });
  for (const line of result.tokens) {
    for (const token of line) {
      if (token.content.length === 0) continue;
      const scopes = deepestScopeNames(token);
      const type = classifyScope(scopes);
      const from = contentStart + token.offset;
      const to = from + token.content.length;
      const attrs: { class: string; style?: string } = { class: `shiki-tok-${type}` };
      if (token.color !== undefined) {
        attrs.style = `color: ${token.color};`;
      }
      out.push(Decoration.inline(from, to, attrs));
    }
  }
  return out;
}

export interface HighlightPluginDeps {
  schema: Schema;
}

export async function buildHighlightPlugin(deps: HighlightPluginDeps): Promise<PMPlugin> {
  const { schema } = deps;
  // Dynamic-import the PM bits to keep them off the Editor.svelte hot
  // path until a highlight plugin is actually needed.
  const [{ Plugin, PluginKey }, { Decoration, DecorationSet }] = await Promise.all([
    import('prosemirror-state'),
    import('prosemirror-view'),
  ]);

  const codeBlockType = schema.nodes['code_block']!;
  const key = new PluginKey<DecorationSetType>('shiki-highlight');

  function computeFromDoc(view: EditorView): Promise<DecorationSetType> {
    return (async () => {
      const doc = view.state.doc;
      type Block = { lang: string; text: string; contentStart: number };
      const blocks: Block[] = [];
      doc.descendants((node, pos) => {
        if (node.type !== codeBlockType) return true;
        const lang = String(node.attrs['language'] ?? DEFAULT_CODE_LANGUAGE);
        if (lang === DEFAULT_CODE_LANGUAGE) return false;
        blocks.push({ lang, text: node.textContent, contentStart: pos + 1 });
        return false;
      });
      if (blocks.length === 0) return DecorationSet.empty;
      const highlighter = await ensureHighlighter();
      const decos: import('prosemirror-view').Decoration[] = [];
      for (const b of blocks) {
        decos.push(...decorationsForBlock(Decoration, highlighter, b.lang, b.text, b.contentStart));
      }
      return DecorationSet.create(doc, decos);
    })();
  }

  return new Plugin<DecorationSetType>({
    key,
    state: {
      init(): DecorationSetType {
        return DecorationSet.empty;
      },
      apply(
        tr: Transaction,
        decos: DecorationSetType,
        _old: EditorState,
        _new: EditorState,
      ): DecorationSetType {
        const meta = tr.getMeta(key);
        if (meta !== undefined) {
          return meta as DecorationSetType;
        }
        if (tr.docChanged) {
          return decos.map(tr.mapping, tr.doc);
        }
        return decos;
      },
    },
    props: {
      decorations(state: EditorState): DecorationSetType | undefined {
        return key.getState(state);
      },
    },
    view(view: EditorView) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let lastDoc = view.state.doc;
      // Generation counter guards against stale highlight runs racing
      // a newer doc: if the user keeps typing while Shiki tokenizes
      // the previous snapshot, we drop the older result.
      let runId = 0;

      function schedule(): void {
        if (timer !== null) clearTimeout(timer);
        const myId = ++runId;
        timer = setTimeout(async () => {
          const decoSet = await computeFromDoc(view);
          if (myId !== runId) return;
          if (view.isDestroyed) return;
          view.dispatch(view.state.tr.setMeta(key, decoSet));
        }, 60);
      }

      // Kick off an initial pass for any code_blocks already in the
      // initial document (loaded from YDoc on mount).
      schedule();

      return {
        update(view: EditorView, prevState: EditorState): void {
          if (view.state.doc === lastDoc) return;
          // Only re-highlight if the doc actually contains any
          // non-text code_block. We still re-run on every doc change
          // because content edits inside a block need re-tokenizing.
          void prevState;
          lastDoc = view.state.doc;
          schedule();
        },
        destroy(): void {
          if (timer !== null) clearTimeout(timer);
          // Bump runId so any in-flight tokenization result is dropped.
          runId++;
        },
      };
    },
  });
}
