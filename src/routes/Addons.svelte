<script lang="ts">
  import Icon from '../lib/components/Icon.svelte';
  import { fetchAddonCollection, login, logout } from '../lib/stremio/account';
  import { configureUrl, clearCache, getAddonCatalog, type DirectoryAddon } from '../lib/stremio/client';
  import { CINEMETA_URL } from '../lib/stores/addons.svelte';
  import { settings } from '../lib/stores/settings.svelte';
  import { router } from '../lib/stores/router.svelte';
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

  // ---------- Explore (addon directory) ----------
  let tab: 'installed' | 'explore' = $state(router.route.query.get('tab') === 'explore' ? 'explore' : 'installed');
  let dir = $state<(DirectoryAddon & { list: string })[]>([]);
  let dirState: 'idle' | 'loading' | 'done' | 'error' = $state('idle');
  let dirQuery = $state('');
  let dirType = $state('');
  let dirInstalling = $state('');

  /** Addon lists offered by installed addons (Cinemeta has Stremio's Official and Community lists). */
  function directorySources(): { url: string; type: string; id: string; name: string }[] {
    const out: { url: string; type: string; id: string; name: string }[] = [];
    for (const a of addons.list) {
      for (const c of a.manifest.addonCatalogs ?? []) {
        if (c.type !== 'all' && (a.manifest.addonCatalogs ?? []).some((x) => x.id === c.id && x.type === 'all')) continue;
        if (!out.some((o) => o.url === a.transportUrl && o.id === c.id)) out.push({ url: a.transportUrl, type: c.type, id: c.id, name: c.name ?? c.id });
      }
    }
    if (!out.length) {
      out.push({ url: CINEMETA_URL, type: 'all', id: 'official', name: 'Official' }, { url: CINEMETA_URL, type: 'all', id: 'community', name: 'Community' });
    }
    return out;
  }

  async function loadDirectory() {
    if (dirState === 'loading' || dirState === 'done') return;
    dirState = 'loading';
    const all: (DirectoryAddon & { list: string })[] = [];
    let ok = 0;
    await Promise.all(
      directorySources().map(async (s) => {
        try {
          for (const a of await getAddonCatalog(s.url, s.type, s.id)) {
            if (!all.some((x) => x.transportUrl === a.transportUrl)) all.push({ ...a, list: s.name });
          }
          ok++;
        } catch {
          /* one list failing shouldn't hide the others */
        }
      }),
    );
    // Official first, then the community list in the order Stremio ranks it.
    all.sort((a, b) => (a.list === 'Official' ? 0 : 1) - (b.list === 'Official' ? 0 : 1));
    dir = all;
    dirState = ok ? 'done' : 'error';
  }
  $effect(() => {
    if (tab === 'explore') void loadDirectory();
  });

  const installedUrls = $derived(new Set(addons.list.map((a) => a.transportUrl.replace(/^https?:/, ''))));
  const installedIds = $derived(new Set(addons.list.map((a) => a.manifest.id)));
  const dirTypes = $derived([...new Set(dir.flatMap((a) => a.manifest.types ?? []))].filter((t) => ['movie', 'series', 'tv', 'channel', 'anime', 'other'].includes(t)));
  const dirShown = $derived(
    dir.filter((a) => {
      if (settings.hideAdultAddons && a.manifest.behaviorHints?.adult) return false;
      if (dirType && !(a.manifest.types ?? []).includes(dirType)) return false;
      const q = dirQuery.trim().toLowerCase();
      return !q || `${a.manifest.name} ${a.manifest.description ?? ''}`.toLowerCase().includes(q);
    }),
  );
  const isInstalled = (a: DirectoryAddon) => installedUrls.has(a.transportUrl.replace(/^https?:/, '')) || installedIds.has(a.manifest.id);

  async function installFromDir(a: DirectoryAddon) {
    if (a.manifest.behaviorHints?.configurationRequired) {
      openExternal(configureUrl({ transportUrl: a.transportUrl, manifest: a.manifest, enabled: true }));
      toast('Set it up on its page, then paste the link it gives you here.', 'info', 7000);
      tab = 'installed';
      return;
    }
    dirInstalling = a.transportUrl;
    try {
      const added = await installAddon(a.transportUrl);
      toast(`Installed ${added.manifest.name}`, 'success');
      clearCache();
    } catch (err) {
      toast(`Couldn't install: ${(err as Error).message}`, 'error', 6000);
    } finally {
      dirInstalling = '';
    }
  }

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

  <div class="tabs" role="tablist">
    <button class="tab" class:active={tab === 'installed'} onclick={() => (tab = 'installed')}>Installed <b>{addons.list.length}</b></button>
    <button class="tab" class:active={tab === 'explore'} onclick={() => (tab = 'explore')}>Explore</button>
  </div>

  {#if tab === 'explore'}
    <div class="list-head">
      <div class="types">
        <button class="tchip" class:on={dirType === ''} onclick={() => (dirType = '')}>All</button>
        {#each dirTypes as t (t)}<button class="tchip" class:on={dirType === t} onclick={() => (dirType = t)}>{t}</button>{/each}
      </div>
      <input class="input filter" placeholder="Search addons" bind:value={dirQuery} />
    </div>
    {#if dirState === 'loading'}
      <div class="list">{#each Array(6) as _, i (i)}<div class="addon card ghost skeleton"></div>{/each}</div>
    {:else if dirState === 'error'}
      <div class="empty"><p>Couldn't load the addon list. Check your connection and try again.</p><button class="btn" onclick={() => { dirState = 'idle'; void loadDirectory(); }}>Try again</button></div>
    {:else}
      <div class="list">
        {#each dirShown as a (a.transportUrl)}
          {@const have = isInstalled(a)}
          <div class="addon card">
            <div class="logo">{#if a.manifest.logo}<img src={a.manifest.logo} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />{:else}<Icon name="puzzle" />{/if}</div>
            <div class="body">
              <div class="name">
                {a.manifest.name}
                {#if a.manifest.version}<span class="faint ver">v{a.manifest.version}</span>{/if}
                {#if a.list === 'Official'}<span class="chip accent">Official</span>{/if}
                {#if a.manifest.behaviorHints?.adult}<span class="chip">18+</span>{/if}
                {#if a.manifest.behaviorHints?.p2p}<span class="chip">P2P</span>{/if}
              </div>
              {#if a.manifest.description}<div class="desc wrap">{a.manifest.description}</div>{/if}
              <div class="chips">
                {#each resources({ transportUrl: a.transportUrl, manifest: a.manifest, enabled: true }) as r (r)}<span class="chip accent">{r}</span>{/each}
                {#each a.manifest.types ?? [] as t (t)}<span class="chip">{t}</span>{/each}
              </div>
            </div>
            <div class="actions">
              {#if have}
                <span class="installed"><Icon name="check" size={15} />Installed</span>
              {:else if a.manifest.behaviorHints?.configurationRequired}
                <button class="btn" onclick={() => installFromDir(a)}><Icon name="gear" size={15} />Set up</button>
              {:else}
                <button class="btn primary" disabled={dirInstalling === a.transportUrl} onclick={() => installFromDir(a)}><Icon name="plus" size={15} />{dirInstalling === a.transportUrl ? 'Installing…' : 'Install'}</button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty"><p>No addons match.</p></div>
        {/each}
      </div>
      <p class="faint tip">From Stremio's official and community addon lists. Addons are made by their own developers; Ripple doesn't review them.</p>
    {/if}
  {:else}

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
  {/if}
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
  .tabs { display: inline-flex; gap: 4px; background: var(--bg-2); border: 1px solid var(--line); padding: 3px; border-radius: 10px; margin-bottom: 16px; }
  .tab { border: 0; background: none; padding: 6px 14px; border-radius: 8px; cursor: pointer; color: var(--text-2); font-weight: 600; font-size: 13px; }
  .tab b { font-weight: 600; opacity: 0.7; margin-left: 3px; }
  .tab.active { background: var(--accent); color: var(--on-accent); }
  .types { display: flex; flex-wrap: wrap; gap: 6px; }
  .tchip { border: 1px solid var(--line); background: var(--bg-2); color: var(--text-2); border-radius: 999px; padding: 4px 12px; font: 600 12.5px var(--font); cursor: pointer; text-transform: capitalize; }
  .tchip.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .desc.wrap { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .installed { display: inline-flex; align-items: center; gap: 6px; color: var(--ok, #3ecf8e); font-weight: 600; font-size: 13px; padding: 0 10px; }
  .ghost { height: 74px; }
  .empty { text-align: center; padding: 30px; }
</style>
