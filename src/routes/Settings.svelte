<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../lib/components/Icon.svelte';
  import { boardCatalogs, syncRows } from '../lib/home';
  import { detectPlayers, type DetectedPlayer } from '../lib/player';
  import { clearCache } from '../lib/stremio/client';
  import type { Quality } from '../lib/stremio/streams';
  import { addons } from '../lib/stores/addons.svelte';
  import { exportAll, importAll } from '../lib/stores/persist';
  import { resetSettings, settings } from '../lib/stores/settings.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { checkForUpdate, installUpdate, updater } from '../lib/stores/updater.svelte';

  const ACCENTS = ['#5b8cff', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#14b8a6', '#e8ebf2'];
  const QUALITIES: Quality[] = ['4K', '1080p', '720p', '480p', 'SD'];

  let detected: DetectedPlayer[] = $state([]);
  let fileInput: HTMLInputElement;

  onMount(async () => {
    detected = await detectPlayers().catch(() => []);
  });

  const available = $derived(boardCatalogs(addons.list, settings.hideAdultAddons));
  const rows = $derived(syncRows(settings.homeRows, available).map((r) => ({ ...r, cat: available.find((b) => b.key === r.key)! })));

  function moveRow(i: number, dir: -1 | 1) {
    const next = syncRows($state.snapshot(settings.homeRows), available);
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    settings.homeRows = next;
  }
  function toggleRow(i: number) {
    const next = syncRows($state.snapshot(settings.homeRows), available);
    next[i].enabled = !next[i].enabled;
    settings.homeRows = next;
  }
  function toggleQuality(q: Quality) {
    settings.qualities = settings.qualities.includes(q) ? settings.qualities.filter((x) => x !== q) : [...settings.qualities, q];
  }

  function backup() {
    const blob = new Blob([exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ripple-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function restore(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      importAll(await file.text());
      toast('Backup restored — reloading', 'success');
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }
</script>

<div class="page">
  <h1 class="page-title">Settings</h1>

  <section class="card">
    <h2>Appearance</h2>
    <div class="field">
      <span>Theme</span>
      <div class="seg">
        {#each [['dark', 'Dark'], ['oled', 'OLED black'], ['light', 'Light']] as [v, l] (v)}
          <button class:on={settings.theme === v} onclick={() => (settings.theme = v as typeof settings.theme)}>{l}</button>
        {/each}
      </div>
    </div>
    <div class="field">
      <span>Accent color</span>
      <div class="swatches">
        {#each ACCENTS as c (c)}
          <button class="sw" class:on={settings.accent === c} style:background={c} aria-label={c} onclick={() => (settings.accent = c)}></button>
        {/each}
        <input type="color" bind:value={settings.accent} title="Custom color" />
      </div>
    </div>
    <div class="field">
      <span>Poster size</span>
      <div class="seg">
        {#each [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] as [v, l] (v)}
          <button class:on={settings.posterSize === v} onclick={() => (settings.posterSize = v as typeof settings.posterSize)}>{l}</button>
        {/each}
      </div>
    </div>
    <div class="field">
      <span>Start page</span>
      <select class="select w" bind:value={settings.startPage}>
        <option value="home">Home</option>
        <option value="discover">Discover</option>
        <option value="library">Library</option>
      </select>
    </div>
    <label class="toggle"><input type="checkbox" bind:checked={settings.showTitles} />Show titles under posters</label>
    <label class="toggle"><input type="checkbox" bind:checked={settings.showRatings} />Show IMDb ratings on posters</label>
    <label class="toggle"><input type="checkbox" bind:checked={settings.compactSidebar} />Compact sidebar (icons only)</label>
    <label class="toggle"><input type="checkbox" bind:checked={settings.reduceMotion} />Reduce motion</label>
  </section>

  <section class="card">
    <h2>Home screen</h2>
    <label class="toggle"><input type="checkbox" bind:checked={settings.showContinueWatching} />Show “Continue watching”</label>
    <label class="toggle"><input type="checkbox" bind:checked={settings.hideAdultAddons} />Hide catalogs from 18+ addons</label>
    <div class="field">
      <span>Items per row</span>
      <input class="input w" type="number" min="5" max="100" bind:value={settings.rowItemLimit} />
    </div>
    <p class="faint small">Choose which catalogs appear on Home and in what order.</p>
    <div class="rows">
      {#each rows as r, i (r.key)}
        <div class="rowitem" class:off={!r.enabled}>
          <label class="toggle inline"><input type="checkbox" checked={r.enabled} onchange={() => toggleRow(i)} />{r.cat.title}</label>
          <span class="faint small">{r.cat.addon.manifest.name}</span>
          <button class="icon-btn" disabled={i === 0} onclick={() => moveRow(i, -1)} aria-label="Move up"><Icon name="up" size={16} /></button>
          <button class="icon-btn" disabled={i === rows.length - 1} onclick={() => moveRow(i, 1)} aria-label="Move down"><Icon name="down" size={16} /></button>
        </div>
      {/each}
    </div>
  </section>

  <section class="card">
    <h2>Playback</h2>
    <div class="field">
      <span>Player</span>
      <div class="seg">
        {#each [['mpv', 'mpv'], ['vlc', 'VLC'], ['custom', 'Custom']] as [v, l] (v)}
          <button class:on={settings.player === v} onclick={() => (settings.player = v as typeof settings.player)}>{l}</button>
        {/each}
      </div>
    </div>
    <div class="field">
      <span>Player path</span>
      <input class="input" bind:value={settings.playerPath} placeholder={detected.find((d) => d.player === settings.player)?.path ?? 'Auto-detect (leave empty)'} />
    </div>
    {#if detected.length}
      <p class="faint small">Found: {detected.map((d) => `${d.player} (${d.path})`).join(' · ')}</p>
    {:else}
      <p class="faint small">No player detected yet. mpv is recommended (install with <code>winget install mpv</code> or <code>scoop install mpv</code>).</p>
    {/if}
    <div class="field">
      <span>Extra arguments</span>
      <input class="input" bind:value={settings.playerArgs} placeholder='e.g. --fullscreen --volume=80' spellcheck="false" />
    </div>
    <div class="field">
      <span>Subtitle languages</span>
      <input class="input" bind:value={settings.subtitleLangs} placeholder="eng, spa (ISO 639-2, comma-separated)" />
    </div>
    <div class="field">
      <span>Streaming server</span>
      <input class="input" bind:value={settings.streamingServer} spellcheck="false" />
    </div>
    <p class="faint small">Needed only for torrent (P2P) streams. Stremio Service runs one at http://127.0.0.1:11470. Debrid and HTTP streams play directly.</p>
    <label class="toggle"><input type="checkbox" bind:checked={settings.autoPlayBest} />Auto-play the top stream when all addons have answered</label>
  </section>

  <section class="card">
    <h2>Streams</h2>
    <div class="field">
      <span>Default sort</span>
      <select class="select w" bind:value={settings.streamSort}>
        <option value="quality">Best quality</option>
        <option value="addon">Addon order</option>
        <option value="size-desc">Largest first</option>
        <option value="size-asc">Smallest first</option>
      </select>
    </div>
    <div class="field">
      <span>Only show</span>
      <div class="seg multi">
        {#each QUALITIES as q (q)}
          <button class:on={settings.qualities.includes(q)} onclick={() => toggleQuality(q)}>{q}</button>
        {/each}
      </div>
    </div>
    <p class="faint small">Leave all off to show every quality.</p>
    <div class="field">
      <span>Hide keywords</span>
      <input class="input" bind:value={settings.excludeKeywords} placeholder="e.g. 3D, HDTS, dubbed" />
    </div>
    <label class="toggle"><input type="checkbox" bind:checked={settings.hideCam} />Hide CAM / telesync releases</label>
    <label class="toggle"><input type="checkbox" bind:checked={settings.onlyDirect} />Only direct links (hide torrents)</label>
  </section>

  <section class="card">
    <h2>Network &amp; data</h2>
    <div class="field">
      <span>Addon timeout (sec)</span>
      <input class="input w" type="number" min="3" max="60" bind:value={settings.requestTimeoutSec} />
    </div>
    <div class="btns">
      <button class="btn" onclick={() => { clearCache(); toast('Cache cleared', 'success'); }}><Icon name="refresh" size={16} />Clear cache</button>
      <button class="btn" onclick={backup}>Export backup</button>
      <button class="btn" onclick={() => fileInput.click()}>Restore backup</button>
      <input type="file" accept="application/json" bind:this={fileInput} onchange={restore} hidden />
      <button class="btn danger" onclick={() => confirm('Reset all settings to defaults?') && resetSettings()}>Reset settings</button>
    </div>
  </section>

  <section class="card">
    <h2>Updates</h2>
    <div class="field">
      <span>Version</span>
      <div class="upd">
        <strong>{updater.version || 'dev'}</strong>
        {#if updater.status === 'available' && updater.info}
          <span class="chip accent">{updater.info.version} available</span>
          <button class="btn primary sm" onclick={installUpdate}>Update now</button>
        {:else if updater.status === 'installing'}
          <span class="faint">Downloading… Ripple will restart</span>
        {:else}
          <button class="btn sm" disabled={updater.status === 'checking'} onclick={async () => {
            await checkForUpdate();
            if (updater.status === 'none') toast("You're on the latest version", 'success');
          }}>
            <Icon name="refresh" size={14} />{updater.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          {#if updater.status === 'error'}<span class="faint small">{updater.error}</span>{/if}
        {/if}
      </div>
    </div>
    <label class="toggle"><input type="checkbox" bind:checked={settings.checkUpdates} />Check for updates when Ripple starts</label>
  </section>

  <p class="faint small about">Works with any Stremio addon. Ripple doesn't host or provide any content.</p>
</div>

<style>
  section { padding: 20px 22px; margin-bottom: 16px; max-width: 860px; }
  h2 { margin: 0 0 14px; font-size: 16px; }
  .field { display: grid; grid-template-columns: 180px 1fr; align-items: center; gap: 12px; margin-bottom: 12px; }
  .field > span { color: var(--text-2); font-weight: 600; font-size: 13px; }
  .w { width: 200px; }
  .seg { display: inline-flex; background: var(--bg-3); border-radius: 9px; padding: 3px; gap: 2px; width: fit-content; }
  .seg button { border: 0; background: none; padding: 6px 14px; border-radius: 7px; cursor: pointer; color: var(--text-2); font-weight: 600; }
  .seg button.on { background: var(--accent); color: #fff; }
  .swatches { display: flex; gap: 8px; align-items: center; }
  .sw { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
  .sw.on { border-color: var(--text); box-shadow: 0 0 0 2px var(--bg-2) inset; }
  input[type='color'] { width: 30px; height: 30px; border: 0; padding: 0; background: none; cursor: pointer; }
  .toggle { display: flex; align-items: center; gap: 10px; padding: 6px 0; cursor: pointer; }
  .toggle input { accent-color: var(--accent); width: 16px; height: 16px; }
  .toggle.inline { flex: 1; padding: 0; }
  .small { font-size: 12.5px; }
  .rows { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; max-height: 360px; overflow-y: auto; }
  .rowitem { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 8px; }
  .rowitem:hover { background: var(--bg-3); }
  .rowitem.off { opacity: 0.55; }
  .btns { display: flex; gap: 8px; flex-wrap: wrap; }
  code { background: var(--bg-3); padding: 1px 5px; border-radius: 4px; }
  .about { margin-top: 10px; }
  .upd { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
</style>
