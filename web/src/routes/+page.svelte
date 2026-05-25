<script lang="ts">
  import Editor from '$lib/Editor.svelte';
</script>

<main>
  <h1>Bartleby</h1>
  <p data-testid="bootstrap">Vertical slice (V-005). Type below; edits sync via Hocuspocus.</p>
  <Editor />
</main>

<style>
  main {
    font-family: system-ui, sans-serif;
    max-width: 48rem;
    margin: 4rem auto;
    padding: 0 1rem;
  }
</style>
