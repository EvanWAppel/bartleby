<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import EditorToolbar from '$lib/components/EditorToolbar.svelte';
  import LinkPopover from '$lib/components/LinkPopover.svelte';
  import CodeLangPopover from '$lib/components/CodeLangPopover.svelte';
  import BacklinkPickerPopover from '$lib/components/BacklinkPickerPopover.svelte';
  import MentionPickerPopover from '$lib/components/MentionPickerPopover.svelte';
  import CommentComposerPopover from '$lib/components/CommentComposerPopover.svelte';
  import { NotesStore } from '$lib/state/notes-store.svelte';
  import { UsersStore } from '$lib/state/users-store.svelte';
  import { getCommentsStore } from '$lib/state/comments-store.svelte';
  import { createComment } from '$lib/api/comments';
  import type { ToolbarActions } from '$lib/editor/actions';

  // W-014 / C-001: the current user's identity flows from
  // +layout.server.ts (via JWT decode in hooks.server.ts) so the editor
  // can publish { name, color } over Yjs awareness without a /auth/me
  // round-trip. Optional because callers without a signed-in session
  // (e.g. Phase 0's hardcoded vertical-slice fixture) still mount the
  // editor; their cursor just renders to other clients with the
  // y-prosemirror defaults (orange caret, "User: <clientId>" label).
  interface UserProp {
    id: string;
    display_name: string;
    color: string;
  }

  interface Props {
    room?: string;
    serverUrl?: string;
    user?: UserProp;
  }

  let { room, serverUrl = 'ws://127.0.0.1:1234', user }: Props = $props();

  let editorEl: HTMLDivElement | null = $state(null);
  let actions: ToolbarActions | null = $state(null);
  // Q-006: explicit readiness flag the editor surfaces on the DOM via
  // `data-editor-ready`. Tests (and any caller that needs to know the
  // editor is truly ready to receive input) wait on this attribute.
  // It only flips to true once BOTH (a) the EditorView is mounted with
  // the toolbar-actions bag wired up AND (b) the HocuspocusProvider has
  // finished its initial sync handshake with the server. Typing before
  // (b) is dangerous: the local edit can race the inbound sync state
  // and either get clobbered by a remote replace or land in a CRDT
  // state that y-prosemirror re-renders out from under us.
  let ready: boolean = $state(false);

  // W-012 backlink picker. The trigger plugin reports an active
  // `[[<query>` state via its onChange callback; we mirror that into
  // Svelte $state so the popover mounts/unmounts and re-filters as the
  // user types. The NotesStore polls /notes every 1s so the candidate
  // list is the same one the sidebar shows — no extra server roundtrip.
  let backlinkOpen: boolean = $state(false);
  let backlinkQuery: string = $state('');
  let onBacklinkApply: ((targetId: string, title: string) => void) | null = $state(null);
  let onBacklinkCancel: (() => void) | null = $state(null);
  const notesStore = new NotesStore();

  // W-013 mention picker. Same shape as the backlink picker — the
  // trigger plugin reports an active `@<query>` and we mirror that into
  // Svelte $state so MentionPickerPopover mounts/unmounts. UsersStore
  // fetches /users on a slow poll (operator-edited allowlist, no need
  // for sub-second freshness).
  let mentionOpen: boolean = $state(false);
  let mentionQuery: string = $state('');
  let onMentionApply: ((email: string, displayName: string) => void) | null = $state(null);
  let onMentionCancel: (() => void) | null = $state(null);
  const usersStore = new UsersStore();

  // Link-popover state. Editor.svelte owns the open/closed flag and
  // the captured ProseMirror selection range; the LinkPopover
  // component only knows about a URL string + apply/cancel callbacks
  // that Editor.svelte hands it. The selection has to be captured
  // BEFORE the popover mounts because focusing the URL input would
  // otherwise drop ProseMirror's text selection.
  let linkOpen: boolean = $state(false);
  let onLinkApply: ((href: string) => void) | null = $state(null);
  let onLinkCancel: (() => void) | null = $state(null);

  // W-011 code-block language picker. The NodeView for code_block
  // surfaces a "Lang: <id> ▾" button per block; clicking it asks
  // Editor.svelte to open this popover with the captured block
  // position. Apply dispatches setNodeMarkup against that pos. Same
  // pattern as LinkPopover — Svelte component lives at this layer
  // because the NodeView is plain DOM and can't host Svelte UI.
  let codeLangOpen: boolean = $state(false);
  let codeLangCurrent: string = $state('text');
  let onCodeLangApply: ((lang: string) => void) | null = $state(null);
  let onCodeLangCancel: (() => void) | null = $state(null);

  // W-018 comment floating-toolbar + composer. The selection plugin
  // reports whenever the user has a non-empty selection in a normal
  // textblock; we mirror that into Svelte $state so a "Comment" button
  // can mount near the selection's bottom edge. Clicking it captures
  // the current range + text, hides the toolbar, and shows the
  // composer. The CommentsStore singleton is shared with CommentsPane
  // so a post here lights up the right pane without a refetch.
  let commentToolbarOpen = $state(false);
  let commentSel: { from: number; to: number; text: string } | null = $state(null);
  let commentToolbarPos: { left: number; top: number } | null = $state(null);
  let commentComposerOpen = $state(false);
  let commentComposerQuote = $state('');
  let commentComposerPos: { left: number; top: number } | null = $state(null);
  let onCommentSubmit: ((body: string) => void) | null = $state(null);
  let onCommentCancel: (() => void) | null = $state(null);
  // `room` is treated as stable for the lifetime of the Editor mount
  // (the page's `{#key data.id}` pattern ensures children of a changed
  // note are remounted; we follow the same contract for the editor).
  // Reading the prop once at $derived time captures the live value
  // while silencing the state-referenced-locally compiler warning.
  const commentsStore = $derived(room !== undefined ? getCommentsStore(room) : null);

  // Phase 0: heavy editor modules are dynamically imported so SvelteKit's
  // SSR pass doesn't try to load the DOM-dependent ProseMirror code.
  // The schema/keymap/inputrules modules themselves are pure data
  // structures (safe in SSR) but we keep them under the same dynamic-
  // import umbrella for consistency.
  let cleanup: (() => void) | null = null;

  onMount(async () => {
    const [
      Y,
      { HocuspocusProvider },
      { EditorState },
      { EditorView },
      { schema, markTypes, nodeTypes },
      { keymap },
      { baseKeymap, toggleMark, setBlockType, wrapIn },
      { wrapInList },
      { buildEditorKeymap },
      { buildInputRules },
      { createTaskItemNodeView },
      { createCodeBlockNodeViewFactory },
      { buildHighlightPlugin },
      { buildBacklinkTriggerPlugin, buildApplyTransaction: buildBacklinkApplyTx },
      { createBacklinkNodeViewFactory },
      { buildMentionTriggerPlugin, buildApplyTransaction: buildMentionApplyTx },
      { createMentionNodeView },
      { buildCommentSelectionPlugin },
      { buildCommentMarkersPlugin, refreshCommentMarkers },
      { buildAnchor, serializeAnchor },
      yProsemirror,
    ] = await Promise.all([
      import('yjs'),
      import('@hocuspocus/provider'),
      import('prosemirror-state'),
      import('prosemirror-view'),
      import('$lib/editor/schema'),
      import('prosemirror-keymap'),
      import('prosemirror-commands'),
      import('prosemirror-schema-list'),
      import('$lib/editor/keymap'),
      import('$lib/editor/input-rules'),
      import('$lib/editor/task-item-node-view'),
      import('$lib/editor/code-block-node-view'),
      import('$lib/editor/highlight-plugin'),
      import('$lib/editor/backlink-trigger-plugin'),
      import('$lib/editor/backlink-node-view'),
      import('$lib/editor/mention-trigger-plugin'),
      import('$lib/editor/mention-node-view'),
      import('$lib/editor/comment-selection-plugin'),
      import('$lib/editor/comment-markers-plugin'),
      import('$lib/editor/comment-anchor'),
      import('y-prosemirror'),
    ]);

    const { ySyncPlugin, yUndoPlugin, yCursorPlugin, undo, redo } = yProsemirror;

    const resolvedRoom =
      room ?? new URLSearchParams(window.location.search).get('room') ?? 'vertical-slice';

    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: serverUrl,
      name: resolvedRoom,
      document: ydoc,
    });

    // Q-006: surface provider sync as the second half of the editor
    // readiness signal (see `ready` declaration above). The provider
    // can already be synced by the time we attach (synchronous local
    // provider in tests, or a very fast WebSocket round-trip), so we
    // initialize from the live flag AND register a listener for the
    // event in case sync hasn't happened yet.
    let providerSynced = provider.synced;
    function maybeMarkReady(): void {
      if (providerSynced && actions !== null) ready = true;
    }
    provider.on('synced', () => {
      providerSynced = true;
      maybeMarkReady();
    });

    // W-014 / C-001: publish { name, color } via the provider's Yjs
    // awareness so other clients (yCursorPlugin) render us as a colored
    // caret with a name label. Hocuspocus relays awareness updates over
    // the same WebSocket; no server changes needed beyond the existing
    // provider setup.
    if (user !== undefined) {
      provider.awareness?.setLocalStateField('user', {
        name: user.display_name,
        color: user.color,
      });
    }

    const yXmlFragment = ydoc.getXmlFragment('prosemirror');

    // Captured selection for the link popover. We grab the live view's
    // selection at the moment the popover opens and replay it onto an
    // addMark transaction when the user submits.
    let savedSelection: { from: number; to: number } | null = null;

    function captureSelection(): void {
      const sel = view.state.selection;
      if (sel.empty) return;
      savedSelection = { from: sel.from, to: sel.to };
      linkOpen = true;
    }

    const editorKeymap = buildEditorKeymap({
      schema,
      onLinkRequested: captureSelection,
    });

    // W-011 code-block language picker. The NodeView signals which
    // code_block the user clicked via its pos; we capture that here so
    // apply/cancel can dispatch against the right node even if the
    // selection drifts in the meantime.
    let codeLangSavedPos: number | null = null;
    function requestCodeLang(pos: number, currentLang: string): void {
      codeLangSavedPos = pos;
      codeLangCurrent = currentLang;
      codeLangOpen = true;
    }

    // W-011 highlight plugin is async (it dynamic-imports Shiki on
    // first use). We await it BEFORE creating EditorState so it sits
    // in the plugin list from the start; the alternative — reconfigure
    // mid-flight — would require dispatching a state.reconfigure tx
    // that y-prosemirror's ySyncPlugin doesn't tolerate well.
    const highlightPlugin = await buildHighlightPlugin({ schema });

    // W-012 backlink trigger plugin. The plugin watches doc state for
    // an active `[[<query>` typing session and signals via onChange;
    // we mirror that into Svelte $state so the popover mounts and
    // re-filters as the user types. `backlinkTriggerStart` is captured
    // here so the apply transaction can replace the right range even
    // if the cursor wanders before the user clicks a candidate.
    let backlinkTriggerStart: number | null = null;
    const backlinkTriggerPlugin = await buildBacklinkTriggerPlugin({
      schema,
      onChange(status) {
        if (status === null) {
          backlinkTriggerStart = null;
          backlinkOpen = false;
          backlinkQuery = '';
          return;
        }
        backlinkTriggerStart = status.triggerStart;
        backlinkQuery = status.query;
        backlinkOpen = true;
      },
      onEscape() {
        // Closing only — the plugin handles the suppression bookkeeping
        // so the popover stays closed until the user types a fresh
        // `[[`. Per W-012 cancel mode the doc is left untouched.
        backlinkOpen = false;
      },
    });

    // W-013 mention trigger plugin. Same shape as the backlink plugin —
    // the plugin reports `@<query>` activity via onChange; we mirror it
    // into Svelte $state for the popover to consume. mentionTriggerStart
    // is captured so the apply transaction can replace the right range
    // even if the cursor moves.
    let mentionTriggerStart: number | null = null;
    const mentionTriggerPlugin = await buildMentionTriggerPlugin({
      schema,
      onChange(status) {
        if (status === null) {
          mentionTriggerStart = null;
          mentionOpen = false;
          mentionQuery = '';
          return;
        }
        mentionTriggerStart = status.triggerStart;
        mentionQuery = status.query;
        mentionOpen = true;
      },
      onEscape() {
        // Closing only; the plugin's suppression bookkeeping keeps the
        // popover dormant until the user types a fresh `@`. No doc
        // mutation — the literal `@query` text stays.
        mentionOpen = false;
      },
    });

    // W-014 / C-001: yCursorPlugin renders remote awareness states as
    // PM decorations — a colored caret + a label span carrying user.name.
    // We deliberately leave the cursorBuilder + selectionBuilder as
    // defaults (style-via-CSS classes `ProseMirror-yjs-cursor` /
    // `ProseMirror-yjs-selection`), which is what the y-prosemirror
    // defaults emit. Only render cursors when we actually have a
    // provider awareness — Phase 0's hardcoded fixture might miss it.
    const remoteCursorPlugins =
      provider.awareness !== undefined && provider.awareness !== null
        ? [yCursorPlugin(provider.awareness)]
        : [];

    // W-018 comment-selection plugin. Reports selection state so the
    // floating "Comment" toolbar can mount near the selection's bottom
    // edge. Positioning happens after the plugin fires, using the
    // live view's `coordsAtPos(to)` — we wait until `view` is defined
    // (below) before reading coords.
    const commentSelectionPlugin = await buildCommentSelectionPlugin({
      schema,
      onChange(status) {
        if (status === null) {
          commentToolbarOpen = false;
          commentSel = null;
          commentToolbarPos = null;
          return;
        }
        if (commentComposerOpen) return; // composer wins until it closes
        commentSel = status;
        commentToolbarPos = computeAnchorPos(status.to);
        commentToolbarOpen = true;
      },
    });

    // W-018 in-body comment markers. Reads the shared CommentsStore
    // (so a post in the toolbar's composer + a post from the pane both
    // light up the body decoration) and renders one numbered marker
    // per top-level non-resolved comment with a resolvable anchor.
    const markersPlugin = await buildCommentMarkersPlugin({
      getComments: () => (commentsStore !== null ? commentsStore.comments : []),
      onMarkerClick(commentId) {
        // Switch the right pane to Comments and write the marker's id
        // into a localStorage cell that CommentsPane reads to highlight
        // the corresponding thread. W-015's localStorage key is
        // already per-note; this one tags the thread to focus.
        if (room !== undefined) {
          try {
            window.localStorage.setItem(`bartleby:rightpane:tab:${room}`, 'comments');
            window.localStorage.setItem(`bartleby:comments:focus:${room}`, commentId);
          } catch {
            // localStorage failures are non-fatal — the marker click
            // still works in-memory via the events below.
          }
        }
        window.dispatchEvent(
          new CustomEvent('bartleby:focus-comment', {
            detail: { noteId: room, commentId },
          }),
        );
      },
    });

    const state = EditorState.create({
      schema,
      plugins: [
        buildInputRules(schema),
        ySyncPlugin(yXmlFragment),
        yUndoPlugin(),
        ...remoteCursorPlugins,
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Mod-Shift-z': redo,
        }),
        keymap(editorKeymap),
        keymap(baseKeymap),
        highlightPlugin,
        backlinkTriggerPlugin,
        mentionTriggerPlugin,
        commentSelectionPlugin,
        markersPlugin,
      ],
    });

    // computeAnchorPos uses the live view (defined below). Implemented
    // here as a closure that captures `view` once it's set; the
    // commentSelectionPlugin's onChange fires AFTER view construction
    // so the reference is safe at call time.
    function computeAnchorPos(pos: number): { left: number; top: number } | null {
      try {
        const coords = view.coordsAtPos(pos);
        const rootRect = editorEl?.getBoundingClientRect();
        if (rootRect === undefined) return null;
        return {
          left: coords.left - rootRect.left,
          top: coords.bottom - rootRect.top + 4,
        };
      } catch {
        return null;
      }
    }

    if (editorEl === null) {
      throw new Error('editor mount point missing');
    }

    const view = new EditorView(editorEl, {
      state,
      nodeViews: {
        task_item: createTaskItemNodeView,
        code_block: createCodeBlockNodeViewFactory({ onRequest: requestCodeLang }),
        backlink: createBacklinkNodeViewFactory({
          navigate: (path) => {
            void goto(path);
          },
        }),
        mention: createMentionNodeView,
      },
    });

    // Every toolbar action follows the same shape: read the live view
    // state, dispatch the resulting transaction (if the command was
    // applicable), and re-focus the editor so the user can keep
    // typing. ProseMirror commands return false when not applicable;
    // we deliberately ignore that — a no-op click is fine, the spec
    // is only "produces the right node/mark when applicable".
    type EditorCommand = (s: typeof view.state, dispatch?: typeof view.dispatch) => boolean;
    function run(cmd: EditorCommand): void {
      cmd(view.state, view.dispatch);
      view.focus();
    }

    actions = {
      toggleBold: () => run(toggleMark(markTypes.strong)),
      toggleItalic: () => run(toggleMark(markTypes.em)),
      toggleStrike: () => run(toggleMark(markTypes.strike)),
      openLinkPopover: captureSelection,
      setHeading: (level) => run(setBlockType(nodeTypes.heading, { level })),
      toggleBulletList: () => run(wrapInList(nodeTypes.bullet_list)),
      toggleOrderedList: () => run(wrapInList(nodeTypes.ordered_list)),
      toggleBlockquote: () => run(wrapIn(nodeTypes.blockquote)),
      toggleCodeBlock: () => run(setBlockType(nodeTypes.code_block)),
    };

    // Q-006: with the actions bag wired up, the editor is half-ready —
    // re-evaluate the combined readiness flag now that `actions` is set.
    maybeMarkReady();

    onLinkApply = (href) => {
      if (savedSelection !== null) {
        const { from, to } = savedSelection;
        const tr = view.state.tr.addMark(from, to, markTypes.link.create({ href }));
        view.dispatch(tr);
      }
      linkOpen = false;
      savedSelection = null;
      view.focus();
    };

    onLinkCancel = () => {
      linkOpen = false;
      savedSelection = null;
      view.focus();
    };

    onCodeLangApply = (lang) => {
      if (codeLangSavedPos !== null) {
        const pos = codeLangSavedPos;
        const node = view.state.doc.nodeAt(pos);
        if (node !== null && node.type === nodeTypes.code_block) {
          const tr = view.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            language: lang,
          });
          view.dispatch(tr);
        }
      }
      codeLangOpen = false;
      codeLangSavedPos = null;
      view.focus();
    };

    onCodeLangCancel = () => {
      codeLangOpen = false;
      codeLangSavedPos = null;
      view.focus();
    };

    onBacklinkApply = (targetId, title) => {
      if (backlinkTriggerStart !== null) {
        const tr = buildBacklinkApplyTx(view.state, backlinkTriggerStart, targetId, title);
        if (tr !== null) {
          view.dispatch(tr);
        }
      }
      // Closing/clearing state is handled by the trigger plugin's
      // onChange (the replace makes the [[…] vanish), but reset
      // optimistically in case the tx was a no-op.
      backlinkOpen = false;
      backlinkTriggerStart = null;
      backlinkQuery = '';
      view.focus();
    };

    onBacklinkCancel = () => {
      // W-012 cancel mode: leave the literal `[[query` in place. The
      // S-009 backlink extractor will still resolve it server-side
      // once the user types `]]`. We only close the popover and stop
      // tracking; deliberately do NOT mutate the doc.
      backlinkOpen = false;
      view.focus();
    };

    onMentionApply = (email, displayName) => {
      if (mentionTriggerStart !== null) {
        const tr = buildMentionApplyTx(view.state, mentionTriggerStart, email, displayName);
        if (tr !== null) {
          view.dispatch(tr);
        }
      }
      mentionOpen = false;
      mentionTriggerStart = null;
      mentionQuery = '';
      view.focus();
    };

    onMentionCancel = () => {
      // Same cancel-mode pattern as backlinks: close the popover, leave
      // the literal `@query` text in place. No derived-state extractor
      // cares about loose `@`s in v1 — M-001 only acts on mention nodes,
      // not raw `@email` strings.
      mentionOpen = false;
      view.focus();
    };

    // W-018: clicking "Comment" in the floating toolbar captures the
    // current selection, swaps toolbar → composer, and locks the
    // selection coords (the composer doesn't move if the user clicks
    // elsewhere afterwards).
    function openComposerForSelection(): void {
      if (commentSel === null) return;
      commentComposerQuote = commentSel.text;
      commentComposerPos = commentToolbarPos;
      commentToolbarOpen = false;
      commentComposerOpen = true;
    }

    onCommentSubmit = (body) => {
      const sel = commentSel;
      if (sel === null || room === undefined) {
        commentComposerOpen = false;
        return;
      }
      const anchor = buildAnchor(view.state, { from: sel.from, to: sel.to });
      const serialized = anchor === null ? '' : serializeAnchor(anchor);
      void (async () => {
        try {
          const created = await createComment(room, {
            anchor: serialized,
            originalQuote: sel.text,
            body,
          });
          commentsStore?.insertLocal(created);
          // Force the markers plugin to rebuild — the comments list
          // changed but the PM doc didn't.
          refreshCommentMarkers(view);
        } catch (e) {
          console.error('comment create failed', e);
        } finally {
          commentComposerOpen = false;
          commentSel = null;
          commentComposerPos = null;
          view.focus();
        }
      })();
    };

    onCommentCancel = () => {
      commentComposerOpen = false;
      commentSel = null;
      commentComposerPos = null;
      view.focus();
    };

    // Stash the openComposer helper for the toolbar's onclick (defined
    // in the template). Use a property to bridge the closure across the
    // <script>'s onMount and the markup.
    handleCommentToolbarClick = openComposerForSelection;

    // Refresh markers whenever the store's comment list changes from
    // elsewhere (CommentsPane created a comment, resolved a thread,
    // etc.). $effect tracks `commentsStore.comments` reactively.
    const stopWatch = $effect.root(() => {
      $effect(() => {
        if (commentsStore === null) return;
        // Touch the reactive field so the effect re-runs on change.
        void commentsStore.comments.length;
        refreshCommentMarkers(view);
      });
    });

    if (commentsStore !== null) {
      commentsStore.attach();
    }
    notesStore.start();
    usersStore.start();

    cleanup = () => {
      stopWatch();
      view.destroy();
      provider.destroy();
      ydoc.destroy();
      notesStore.stop();
      usersStore.stop();
      if (commentsStore !== null) commentsStore.detach();
    };
  });

  // Bridge for the template's onclick — assigned inside onMount once
  // the closure (over `view`) is built.
  let handleCommentToolbarClick: (() => void) | null = $state(null);

  onDestroy(() => {
    cleanup?.();
  });
</script>

{#if actions}
  <EditorToolbar {actions} />
{/if}
{#if linkOpen && onLinkApply && onLinkCancel}
  <LinkPopover onApply={onLinkApply} onCancel={onLinkCancel} />
{/if}
{#if codeLangOpen && onCodeLangApply && onCodeLangCancel}
  <CodeLangPopover
    currentLanguage={codeLangCurrent}
    onApply={onCodeLangApply}
    onCancel={onCodeLangCancel}
  />
{/if}
{#if backlinkOpen && onBacklinkApply && onBacklinkCancel}
  <BacklinkPickerPopover
    query={backlinkQuery}
    notes={notesStore.notes}
    excludeNoteId={room ?? ''}
    onApply={onBacklinkApply}
    onCancel={onBacklinkCancel}
  />
{/if}
{#if mentionOpen && onMentionApply && onMentionCancel}
  <MentionPickerPopover
    query={mentionQuery}
    users={usersStore.users}
    onApply={onMentionApply}
    onCancel={onMentionCancel}
  />
{/if}
<div class="editor-wrap">
  {#if commentToolbarOpen && commentToolbarPos !== null && handleCommentToolbarClick !== null}
    <div
      class="comment-floating-toolbar"
      data-testid="comment-floating-toolbar"
      style="left: {commentToolbarPos.left}px; top: {commentToolbarPos.top}px;"
    >
      <button
        type="button"
        class="comment-button"
        data-testid="comment-floating-toolbar-button"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => handleCommentToolbarClick?.()}
      >
        💬 Comment
      </button>
    </div>
  {/if}
  {#if commentComposerOpen && commentComposerPos !== null && onCommentSubmit && onCommentCancel}
    <div
      class="comment-composer-anchor"
      style="left: {commentComposerPos.left}px; top: {commentComposerPos.top}px;"
    >
      <CommentComposerPopover
        quote={commentComposerQuote}
        onSubmit={onCommentSubmit}
        onCancel={onCommentCancel}
      />
    </div>
  {/if}
  <div
    bind:this={editorEl}
    data-testid="editor"
    data-editor-ready={ready ? 'true' : 'false'}
    class="editor"
    role="textbox"
    aria-label="Note body"
    tabindex="0"
  ></div>
</div>

<style>
  .editor-wrap {
    position: relative;
  }

  /* W-018 floating "Comment" toolbar. Positioned absolutely off the
     editor-wrap's origin using coords computed from view.coordsAtPos. */
  .comment-floating-toolbar {
    position: absolute;
    z-index: 5;
    transform: translateX(-50%);
  }

  .comment-button {
    appearance: none;
    border: 1px solid #5b8def;
    background: #5b8def;
    color: #fff;
    padding: 0.2rem 0.55rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-family: inherit;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  }

  .comment-button:hover {
    background: #4a7bd8;
  }

  .comment-composer-anchor {
    position: absolute;
    z-index: 6;
    transform: translateX(-50%);
  }

  /* W-018 in-body comment markers. Numbered chips emitted by
     buildCommentMarkersPlugin as PM widget decorations after each
     anchored range. Click-handlers live on the button itself. */
  .editor :global(.ProseMirror button[data-comment-marker]) {
    appearance: none;
    border: 1px solid #f59e0b;
    background: #fff7ed;
    color: #a0571c;
    border-radius: 999px;
    width: 1.4em;
    height: 1.4em;
    line-height: 1;
    font-size: 0.7rem;
    font-family: inherit;
    margin-left: 0.15rem;
    cursor: pointer;
    padding: 0;
    vertical-align: super;
  }

  .editor :global(.ProseMirror button[data-comment-marker]:hover) {
    background: #f59e0b;
    color: #fff;
  }

  .editor {
    border: 1px solid #ccc;
    border-radius: 0 0 6px 6px;
    padding: 1rem;
    min-height: 12rem;
    background: #fff;
    font-family: system-ui, sans-serif;
    line-height: 1.5;
  }

  .editor :global(.ProseMirror) {
    outline: none;
    min-height: 10rem;
  }

  /* W-014 / C-001 presence cursors. y-prosemirror's defaultCursorBuilder
     emits <span class="ProseMirror-yjs-cursor" style="border-color: …">
     containing a nested <div style="background-color: …">{name}</div>.
     We give the caret a thin colored border on the left to read as a
     vertical bar, and the inner <div> rides above the caret as a
     readable name pill. defaultSelectionBuilder paints remote
     selections via a translucent background (the alpha suffix `70`
     is supplied by the builder), so we only style the class for
     readability tweaks. */
  .editor :global(.ProseMirror-yjs-cursor) {
    position: relative;
    margin-left: -1px;
    margin-right: -1px;
    border-left: 2px solid;
    border-right: none;
    word-break: normal;
    pointer-events: none;
  }

  /* Q-005: presence cursor labels (W-014). y-prosemirror sets
     background-color from the user's assigned color (auth/store.ts's
     PRESENCE_PALETTE); some palette entries (e.g. #46f0f0 cyan,
     #f032e6 magenta) are too light for #fff text to clear WCAG AA
     contrast. A 1px black text-shadow halo gives the white text a
     readable edge against any palette entry — light or dark — without
     us having to compute per-color luminance at runtime. */
  .editor :global(.ProseMirror-yjs-cursor > div) {
    position: absolute;
    top: -1.1em;
    left: -2px;
    font-size: 0.7rem;
    line-height: 1;
    color: #fff;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    white-space: nowrap;
    font-family: system-ui, sans-serif;
    font-weight: 600;
    user-select: none;
    text-shadow:
      0 0 2px rgba(0, 0, 0, 0.9),
      0 1px 1px rgba(0, 0, 0, 0.85);
  }

  /* .ProseMirror-yjs-selection styling is delivered inline by
     y-prosemirror's defaultSelectionBuilder (background-color with an
     alpha suffix). No CSS rules needed here. */

  .editor :global(.ProseMirror p) {
    margin: 0 0 0.5rem;
  }

  .editor :global(.ProseMirror h1) {
    font-size: 1.6rem;
    margin: 0.5rem 0;
  }

  .editor :global(.ProseMirror h2) {
    font-size: 1.35rem;
    margin: 0.5rem 0;
  }

  .editor :global(.ProseMirror h3) {
    font-size: 1.15rem;
    margin: 0.5rem 0;
  }

  .editor :global(.ProseMirror blockquote) {
    border-left: 3px solid #ccc;
    margin: 0.5rem 0;
    padding-left: 0.75rem;
    color: #555;
  }

  /* W-011 code block. The NodeView nests a <button class="code-lang-button">
     + a <code> contentDOM inside the <pre>; we relative-position the
     pre so the button can absolute-position itself in the corner
     without escaping the block. The button text is rendered by the
     NodeView (not a Svelte component) so the user sees "ts ▾" etc. */
  .editor :global(.ProseMirror pre) {
    position: relative;
    background: #f5f5f5;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    overflow-x: auto;
  }

  .editor :global(.ProseMirror pre > .code-lang-button) {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    appearance: none;
    border: 1px solid #ddd;
    background: #fff;
    color: #555;
    border-radius: 4px;
    padding: 0.05rem 0.4rem;
    font-size: 0.75rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    cursor: pointer;
    z-index: 1;
  }

  .editor :global(.ProseMirror pre > .code-lang-button:hover) {
    border-color: #5b8def;
    color: #333;
  }

  .editor :global(.ProseMirror ul),
  .editor :global(.ProseMirror ol) {
    padding-left: 1.5rem;
    margin: 0.5rem 0;
  }

  .editor :global(.ProseMirror s) {
    text-decoration: line-through;
  }

  /* W-012 backlink. Renders as a brackety-blue clickable link with no
     underline by default — Notion/Obsidian convention. cursor:pointer
     reinforces that plain click navigates rather than positions the
     cursor (the NodeView intercepts the click). */
  .editor :global(.ProseMirror a[data-backlink]) {
    color: #5b8def;
    background: rgba(91, 141, 239, 0.08);
    padding: 0 0.15rem;
    border-radius: 3px;
    text-decoration: none;
    cursor: pointer;
  }

  .editor :global(.ProseMirror a[data-backlink]:hover) {
    background: rgba(91, 141, 239, 0.18);
    text-decoration: underline;
  }

  /* W-013 mention. Inert chip — no click handler, just a styled span
     that reads as @-prefixed text. Slightly different palette from the
     backlink (warmer) so the two feel distinct at a glance. */
  .editor :global(.ProseMirror span[data-mention]) {
    color: #a0571c;
    background: rgba(160, 87, 28, 0.08);
    padding: 0 0.15rem;
    border-radius: 3px;
    font-weight: 500;
  }

  /* W-010 task list styling. The <li> renders a checkbox + content;
     the bullet is suppressed and the checkbox sits inline with the
     paragraph. Checked items get a strikethrough on the visible
     content so completed work reads as such. */
  .editor :global(.ProseMirror ul[data-type='task-list']) {
    list-style: none;
    padding-left: 0.5rem;
  }

  .editor :global(.ProseMirror li[data-type='task-item']) {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    margin: 0.2rem 0;
  }

  .editor :global(.ProseMirror li[data-type='task-item'] > input[type='checkbox']) {
    flex: 0 0 auto;
    margin-top: 0.25rem;
    cursor: pointer;
  }

  .editor :global(.ProseMirror li[data-type='task-item'] > [data-task-content]) {
    flex: 1;
  }

  .editor
    :global(.ProseMirror li[data-type='task-item'][data-checked='true'] > [data-task-content]) {
    text-decoration: line-through;
    color: #888;
  }
</style>
