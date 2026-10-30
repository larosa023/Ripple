<script lang="ts">
  import Icon from '../lib/components/Icon.svelte';
  import { fetchAddonCollection, login, logout } from '../lib/stremio/account';
  import { configureUrl, clearCache } from '../lib/stremio/client';
  import type { InstalledAddon } from '../lib/stremio/types';
  import { openExternal } from '../lib/player';
  import {
    addons,
    installAddon,
    mergeAddons,
    moveAddon,
    refreshAddons,
    removeAddon,
    toggleAddon,
  } from '../lib/stores/addons.svelte';
  import { toast } from '../lib/stores/toast.svelte';

  let url = $state('');
  let installing = $state(false);
  let refreshing = $state(false);
  let showImport = $state(false);
  let email = $state('');
  let password = $state('');
  let importing = $state(false);
  let dragFrom = $state<number | null>(null);
  let filter = $state('');

  const shown = $derived(
    addons.list
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => !filter || (a.manifest.name + ' ' + (a.manifest.description ?? '')).toLowerCase().includes(filter.toLowerCase())),
  );

  async function install(e?: Event) {
    e?.preventDefault();
    if (!url.trim()) return;
    installing = true;
    try {
      const a = await installAddon(url);
      toast(`Installed ${a.manifest.name}`, 'success');
      url = '';
      clearCache();
    } catch (err) {
      toast(`Couldn't install: ${(err as Error).message}`, 'error', 6000);
    } finally {
      installing = false;
    }
  }

  async function refresh() {
    refreshing = true;
    const failed = await refreshAddons();
    clearCache();
    refreshing = false;
    toast(failed ? `Updated, ${failed} addon(s) unreachable` : 'All addons up to date', failed ? 'error' : 'success');
  }

  async function importAccount(e: Event) {
    e.preventDefault();
    importing = true;
    try {
      const key = await login(email.trim(), password);
      const list = await fetchAddonCollection(key);
      await logout(key);
      const added = mergeAddons(list);
      toast(`Imported ${added} new addon${added === 1 ? '' : 's'} from Stremio`, 'success');
      showImport = false;
      clearCache();
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, 'error', 6000);
    } finally {
      password = '';
      importing = false;
    }
  }

  function remove(a: InstalledAddon) {
    if (confirm(`Remove ${a.manifest.name}?`)) {
      removeAddon(a.transportUrl);
      clearCache();
    }
  }

  function resources(a: InstalledAddon): string[] {
    return a.manifest.resources.map((r) => (typeof r === 'string' ? r : r.name)).filter((r) => r !== 'addon_catalog');
  }

  // Paste-anywhere: a stremio:// or manifest link on the clipboard drops straight into the field.
  function onPaste(e: ClipboardEvent) {
    const t = e.clipboardData?.getData('text') ?? '';
    if (/^(stremio|https?):\/\/\S+$/i.test(t.trim()) && document.activeElement?.tagName !== 'INPUT') {
      url = t.trim();
    }
  }
</script>

<svelte:window onpaste={onPaste} />

<div class="page">
  <div class="head">
    <h1 class="page-title">Addons</h1>
    <div class="head-actions">
      <button class="btn" onclick={() => (showImport = !showImport)}><Icon name="user" size={16} />Import from Stremio</button>
      <button class="btn" onclick={refresh} disabled={refreshing}>
        <Icon name="refresh" size={16} />{refreshing ? 'Updating…' : 'Update all'}
      </button>
    </div>
  </div>

  <form class="install card" onsubmit={install}>
    <Icon name="link" size={18} />
    <input class="bare" bind:value={url} placeholder="Paste an addon URL (https://…/manifest.json or stremio://…)" spellcheck="false" />
    <button class="btn primary" disabled={installing || !url.trim()}>{installing ? 'Installing…' : 'Install'}</button>
  </form>

  {#if showImport}
    <form class="import card" onsubmit={importAccount}>
      <p class="muted">
        Sign in once to copy every addon from your Stremio account. Your password goes only to Stremio's servers and isn't
        saved.
      </p>
      <div class="row2">
        <input class="input" type="email" placeholder="Email" bind:value={email} autocomplete="username" required />
        <input class="input" type="password" placeholder="Password" bind:value={password} autocomplete="current-password" required />
        <button class="btn primary" disabled={importing}>{importing ? 'Importing…' : 'Import'}</button>
      </div>
    </form>
  {/if}

  <div class="list-head">
    <span class="faint">{addons.list.length} installed · drag to set priority (top = first for details and streams)</span>
    <input class="input filter" placeholder="Filter" bind:value={filter} />
  </div>

  <div class="list">
    {#each shown as { a, i } (a.transportUrl)}
      <div
        class="addon card"
        class:off={!a.enabled}
        class:dragging={dragFrom === i}
        draggable={!filter}
        role="listitem"
        ondragstart={() => (dragFrom = i)}
        ondragend={() => (dragFrom = null)}
        ondragover={(e) => e.preventDefault()}
        ondrop={() => {
          if (dragFrom !== null) moveAddon(dragFrom, i);
          dragFrom = null;
        }}
      >
        <div class="logo">
          {#if a.manifest.logo}<img src={a.manifest.logo} alt="" loading="lazy" />{:else}<Icon name="puzzle" />{/if}
        </div>
        <div class="body">
          <div class="name">
            {a.manifest.name}
            <span class="faint ver">v{a.manifest.version}</span>
            {#if a.protected}<span class="chip">Core</span>{/if}
            {#if a.manifest.behaviorHints?.adult}<span class="chip">18+</span>{/if}
          </div>
          {#if a.manifest.description}<div class="desc">{a.manifest.description}</div>{/if}
          <div class="chips">
            {#each resources(a) as r (r)}<span class="chip accent">{r}</span>{/each}
            {#each a.manifest.types as t (t)}<span class="chip">{t}</span>{/each}
            {#if a.manifest.catalogs.length}<span class="chip">{a.manifest.catalogs.length} catalogs</span>{/if}
          </div>
        </div>
        <div class="actions">
          <button class="icon-btn" title="Move up" disabled={i === 0} onclick={() => moveAddon(i, i - 1)}><Icon name="up" size={16} /></button>
          <button class="icon-btn" title="Move down" disabled={i === addons.list.length - 1} onclick={() => moveAddon(i, i + 1)}><Icon name="down" size={16} /></button>
          {#if a.manifest.behaviorHints?.configurable}
            <button class="icon-btn" title="Configure" onclick={() => openExternal(configureUrl(a))}><Icon name="gear" size={16} /></button>
          {/if}
          <button class="icon-btn" title="Copy manifest URL" onclick={() => navigator.clipboard.writeText(a.transportUrl).then(() => toast('Copied', 'success', 1500))}>
            <Icon name="copy" size={16} />
          </button>
          <label class="switch" title={a.enabled ? 'Disable' : 'Enable'}>
            <input type="checkbox" checked={a.enabled} onchange={() => toggleAddon(a.transportUrl)} />
            <span></span>
          </label>
          {#if !a.protected}
            <button class="icon-btn danger" title="Remove" onclick={() => remove(a)}><Icon name="trash" size={16} /></button>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <p class="faint tip">
    Tip: on an addon's website, right-click “Install” and copy the link, then paste it anywhere on this page. Configurable
    addons (Torrentio, Comet, AIOStreams, etc.) give you a personal URL after you configure them.
  </p>
</div>

<style>
  .head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
  .head-actions { display: flex; gap: 8px; margin-bottom: 20px; }
  .install { display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 16px; color: var(--text-2); margin-bottom: 14px; }
  .install:focus-within { border-color: var(--accent); }
  .bare { flex: 1; border: 0; background: none; outline: none; height: 36px; color: var(--text); }
  .import { padding: 16px; margin-bottom: 14px; }
  .import p { margin: 0 0 12px; font-size: 13px; }
  .row2 { display: flex; gap: 8px; }
  .list-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: 22px 0 10px; font-size: 12.5px; }
  .filter { width: 200px; height: 32px; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .addon { display: flex; gap: 14px; align-items: center; padding: 12px 14px; transition: opacity var(--dur), border-color var(--dur); }
  .addon[draggable='true'] { cursor: grab; }
  .addon.dragging { opacity: 0.4; }
  .addon.off .logo, .addon.off .body { opacity: 0.45; }
  .logo { width: 44px; height: 44px; border-radius: 10px; background: var(--bg-3); display: grid; place-items: center; overflow: hidden; flex-shrink: 0; color: var(--text-3); }
  .logo img { width: 100%; height: 100%; object-fit: contain; }
  .body { flex: 1; min-width: 0; }
  .name { font-weight: 700; display: flex; gap: 8px; align-items: center; }
  .ver { font-weight: 500; font-size: 12px; }
  .desc { font-size: 12.5px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .actions { display: flex; align-items: center; gap: 2px; }
  .danger:hover { color: var(--danger); }
  .switch { position: relative; width: 38px; height: 22px; margin: 0 6px; cursor: pointer; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .switch span { position: absolute; inset: 0; background: var(--line); border-radius: 11px; transition: background var(--dur); }
  .switch span::after {
    content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff;
    transition: transform var(--dur) var(--ease);
  }
  .switch input:checked + span { background: var(--accent); }
  .switch input:checked + span::after { transform: translateX(16px); }
  .switch input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tip { font-size: 12.5px; margin-top: 18px; max-width: 80ch; }
</style>
