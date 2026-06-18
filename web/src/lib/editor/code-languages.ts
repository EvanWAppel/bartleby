// W-011 supported code-block languages. Kept deliberately narrow so
// the lazy-loaded Shiki bundle stays small (each language grammar adds
// ~50–100KB) and the picker is scannable. `id` is what Shiki expects
// in its `langs` config; `label` is what we show in the picker.
//
// `text` is the default sentinel for "no syntax highlighting" — the
// server markdown serializer drops the language tag when language is
// 'text' so the round-tripped fence is plain ```. The Shiki highlighter
// special-cases it as a no-op (no tokens emitted).
//
// To add a language: append below AND import it in highlight-plugin.ts's
// getHighlighter call. The picker is rendered straight from this array
// so the UI updates automatically.

export interface CodeLanguage {
  /** Shiki language id (e.g., 'typescript'). */
  id: string;
  /** Display label in the picker + on the NodeView button. */
  label: string;
}

export const SUPPORTED_CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: 'text', label: 'text' },
  { id: 'bash', label: 'bash' },
  { id: 'css', label: 'css' },
  { id: 'go', label: 'go' },
  { id: 'html', label: 'html' },
  { id: 'js', label: 'js' },
  { id: 'json', label: 'json' },
  { id: 'md', label: 'md' },
  { id: 'py', label: 'py' },
  { id: 'rs', label: 'rs' },
  { id: 'sql', label: 'sql' },
  { id: 'ts', label: 'ts' },
  { id: 'yaml', label: 'yaml' },
] as const;

export const DEFAULT_CODE_LANGUAGE: string = 'text';

export function isSupportedLanguage(id: string): boolean {
  return SUPPORTED_CODE_LANGUAGES.some((lang) => lang.id === id);
}

export function labelForLanguage(id: string): string {
  const match = SUPPORTED_CODE_LANGUAGES.find((lang) => lang.id === id);
  return match?.label ?? id;
}
