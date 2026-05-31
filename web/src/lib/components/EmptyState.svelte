<script lang="ts">
  // W-028 empty state — what you see on `/` when no note is selected,
  // and the friendly hint for a first-time signed-in user.
</script>

<div class="empty" data-testid="empty-state">
  <h2>No note open</h2>
  <p>Pick a note from the sidebar, or create your first one.</p>
  <p class="hint">(The "create" button lands in W-005.)</p>
</div>

<style>
  .empty {
    max-width: 28rem;
    margin: 4rem auto;
    text-align: center;
    color: #333;
  }

  .empty h2 {
    margin: 0 0 0.5rem;
    font-size: 1.4rem;
    font-weight: 600;
  }

  .empty p {
    margin: 0.25rem 0;
    color: #666;
  }

  .empty .hint {
    color: #999;
    font-size: 0.85rem;
    margin-top: 1rem;
  }
</style>
