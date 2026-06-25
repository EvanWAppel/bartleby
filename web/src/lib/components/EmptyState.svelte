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
    color: #595959;
  }

  /* Q-005: WCAG AA color contrast — #999 on #fff is 2.84:1, well
     under the 4.5:1 floor. #6f6f6f hits 4.55:1 on a white background. */
  .empty .hint {
    color: #6f6f6f;
    font-size: 0.85rem;
    margin-top: 1rem;
  }
</style>
