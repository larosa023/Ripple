<script lang="ts">
  import { installUpdate, updater } from '../stores/updater.svelte';
  import { openExternal } from '../player';
  import Icon from './Icon.svelte';

  const show = $derived(
    !updater.dismissed && (updater.status === 'available' || updater.status === 'installing') && !!updater.info,
  );
</script>

{#if show && updater.info}
  <div class="banner" role="status">
    <div class="dot"></div>
    <div class="text">
      <strong>Ripple {updater.info.version} is available</strong>
      <span class="muted">You have {updater.info.current}.</span>
      <button class="link" onclick={() => openExternal(updater.info!.pageUrl)}>What's new</button>
    </div>
    {#if updater.status === 'installing'}
      <span class="busy"><div class="spinner"></div>Downloading… Ripple will restart</span>
    {:else}
      <button class="btn primary sm" onclick={installUpdate}>Update now</button>
      <button class="icon-btn" aria-label="Later" title="Later" onclick={() => (updater.dismissed = true)}><Icon name="x" size={16} /></button>
    {/if}
  </div>
{/if}

<style>
  .banner {
    display: flex; align-items: center; gap: 12px; padding: 8px 12px 8px 16px; margin: 12px 16px 0;
    border-radius: 12px; background: color-mix(in srgb, var(--accent) 14%, var(--bg-2));
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
  .text { flex: 1; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 13px; }
  .link { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font-size: 13px; }
  .link:hover { text-decoration: underline; }
  .busy { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); }
</style>
