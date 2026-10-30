<script lang="ts">
  import { toasts } from '../stores/toast.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.list as t (t.id)}
    <div class="toast {t.kind}">{t.text}</div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 100;
    pointer-events: none;
  }
  .toast {
    padding: 10px 14px; border-radius: 10px; background: var(--bg-3); border: 1px solid var(--line);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35); max-width: 380px; font-size: 13px;
  }
  .error { border-color: var(--danger); }
  .success { border-color: var(--ok); }
</style>
