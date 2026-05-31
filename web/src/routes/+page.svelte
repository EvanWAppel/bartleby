<script lang="ts">
  // Root route — empty state for authed users when no note is open.
  // (Until W-004's sidebar+list ships, every signed-in user lands here
  // first.) The shell is rendered by +layout.svelte; this slot is the
  // main pane only.
  import EmptyState from '$lib/components/EmptyState.svelte';
</script>

<EmptyState />
