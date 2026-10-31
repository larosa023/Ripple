<script lang="ts">
  import { dismiss, toasts } from '../stores/toast.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.list as t (t.id)}
    <div class="toast {t.kind}" class:has-action={!!t.action}>
      <span>{t.text}</span>
      {#if t.action}
        <button class="btn primary sm" onclick={() => { const a = t.action!; dismiss(t.id); a.run(); }}>{t.action.label}</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 100;
    pointer-events: none;
  }
  :global(:root[data-nav='dock']) .toasts { bottom: 100px; }
  .toast {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 14px; border-radius: 10px; background: var(--bg-3); border: 1px solid var(--line);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35); max-width: 420px; font-size: 13px;
  }
  .has-action { pointer-events: auto; padding-right: 8px; }
  .error { border-color: var(--danger); }
  .success { border-color: var(--ok); }
</style>
