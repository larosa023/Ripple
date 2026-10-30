<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../lib/components/Icon.svelte';
  import { detectPlayers, type DetectedPlayer } from '../lib/player';
  import { clearCache } from '../lib/stremio/client';
  import type { Quality } from '../lib/stremio/streams';
  import { exportAll, importAll } from '../lib/stores/persist';
  import { resetSettings, settings } from '../lib/stores/settings.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { openStudio } from '../lib/stores/ui.svelte';
  import { checkForUpdate, installUpdate, updater } from '../lib/stores/updater.svelte';

  const QUALITIES: Quality[] = ['4K', '1080p', '720p', '480p', 'SD'];

  let detected: DetectedPlayer[] = $state([]);
  let fileInput: HTMLInputElement;

  onMount(async () => {
    detected = await detectPlayers().catch(() => []);
  });

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
    <h2>Appearance &amp; layout</h2>
    <p class="faint small">Themes, colors, fonts, navigation style, cards, hero banner, home rows and custom CSS all live in the Customize panel, where changes preview live.</p>
    <div class="btns">
      <button class="btn primary" onclick={() => openStudio('look')}><Icon name="brush" size={16} />Open Customize</button>
      <button class="btn" onclick={() => openStudio('home')}>Edit home rows</button>
      <button class="btn" onclick={() => openStudio('themes')}>Themes</button>
    </div>
    <p class="faint small">Shortcut: Ctrl+Shift+C</p>
  </section>

  <section class="card">
    <h2>General</h2>
    <div class="field">
      <span>Start page</span>
      <select class="select w" bind:value={settings.startPage}>
        <option value="home">Home</option>
        <option value="discover">Discover</option>
        <option value="library">Library</option>
      </select>
    </div>
    <label class="toggle"><input type="checkbox" bind:checked={settings.hideAdultAddons} />Hide catalogs from 18+ addons</label>
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
  .toggle { display: flex; align-items: center; gap: 10px; padding: 6px 0; cursor: pointer; }
  .toggle input { accent-color: var(--accent); width: 16px; height: 16px; }
  .small { font-size: 12.5px; }
  .btns { display: flex; gap: 8px; flex-wrap: wrap; }
  code { background: var(--bg-3); padding: 1px 5px; border-radius: 4px; }
  .about { margin-top: 10px; }
  .upd { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
</style>
