<script lang="ts">
  import { onMount } from 'svelte';
  import { isTauri } from '../stremio/http';

  type Win = import('@tauri-apps/api/window').Window;
  let win: Win | null = $state(null);
  let maximized = $state(false);

  onMount(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let gone = false;
    import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      win = w;
      maximized = await w.isMaximized();
      const off = await w.onResized(async () => {
        maximized = await w.isMaximized();
      });
      if (gone) off(); // unmounted while we were setting up (e.g. nav layout changed)
      else unlisten = off;
    });
    return () => {
      gone = true;
      unlisten?.();
    };
  });
</script>

{#if win}
  <div class="controls">
    <button class="wc" aria-label="Minimize" title="Minimize" onclick={() => win?.minimize()}>
      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1" /></svg>
    </button>
    <button class="wc" aria-label={maximized ? 'Restore' : 'Maximize'} title={maximized ? 'Restore' : 'Maximize'} onclick={() => win?.toggleMaximize()}>
      {#if maximized}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M2.5 2.5V.5h7v7h-2" /><rect x=".5" y="2.5" width="7" height="7" />
        </svg>
      {:else}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x=".5" y=".5" width="9" height="9" /></svg>
      {/if}
    </button>
    <button class="wc close" aria-label="Close" title="Close" onclick={() => win?.close()}>
      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1.1" /></svg>
    </button>
  </div>
{/if}

<style>
  .controls { display: flex; height: 100%; align-self: stretch; }
  .wc {
    width: 46px; height: 100%; min-height: 32px; display: grid; place-items: center; border: 0; background: transparent;
    color: var(--text-2); cursor: default; transition: background 120ms, color 120ms;
  }
  .wc:hover { background: color-mix(in srgb, var(--text) 10%, transparent); color: var(--text); }
  .wc:active { background: color-mix(in srgb, var(--text) 16%, transparent); }
  .close:hover { background: #e81123; color: #fff; }
  .close:active { background: #c50f1f; color: #fff; }
</style>
