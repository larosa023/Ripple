<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../lib/components/Icon.svelte';
  import SettingRow from '../lib/components/SettingRow.svelte';
  import Switch from '../lib/components/Switch.svelte';
  import { detectPlayers, openExternal, type DetectedPlayer } from '../lib/player';
  import { clearCache } from '../lib/stremio/client';
  import type { Quality } from '../lib/stremio/streams';
  import { exportAll, importAll } from '../lib/stores/persist';
  import { go, router } from '../lib/stores/router.svelte';
  import { resetSettings, settings } from '../lib/stores/settings.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { openStudio } from '../lib/stores/ui.svelte';
  import { checkForUpdate, installUpdate, updater } from '../lib/stores/updater.svelte';

  type Section = 'general' | 'playback' | 'streams' | 'appearance' | 'data' | 'about';
  const SECTIONS: { id: Section; label: string; icon: string; blurb: string }[] = [
    { id: 'general', label: 'General', icon: 'settings', blurb: 'Startup and content filtering' },
    { id: 'playback', label: 'Playback', icon: 'play', blurb: 'Player, subtitles and the streaming server' },
    { id: 'streams', label: 'Streams', icon: 'filter', blurb: 'How stream lists are sorted and filtered' },
    { id: 'appearance', label: 'Appearance', icon: 'brush', blurb: 'Themes, layouts and the home screen' },
    { id: 'data', label: 'Data & network', icon: 'download', blurb: 'Backups, cache and addon timeouts' },
    { id: 'about', label: 'About & updates', icon: 'refresh', blurb: 'Version and updates' },
  ];

  const section = $derived((SECTIONS.find((s) => s.id === router.route.query.get('tab'))?.id ?? 'general') as Section);
  const current = $derived(SECTIONS.find((s) => s.id === section)!);
  const QUALITIES: Quality[] = ['4K', '1080p', '720p', '480p', 'SD'];

  let detected: DetectedPlayer[] = $state([]);
  let fileInput: HTMLInputElement | undefined = $state();

  onMount(async () => {
    detected = await detectPlayers().catch(() => []);
  });

  const found = $derived(detected.find((d) => d.player === settings.player));

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
  async function manualCheck() {
    await checkForUpdate();
    if (updater.status === 'none') toast("You're on the latest version", 'success');
  }
</script>

<div class="page settings">
  <div class="layout">
    <aside class="side">
      <h1 class="page-title">Settings</h1>
      <nav>
        {#each SECTIONS as s (s.id)}
          <button class="cat" class:on={section === s.id} onclick={() => go('settings', [], { tab: s.id })}>
            <Icon name={s.icon} size={18} />{s.label}
            {#if s.id === 'about' && updater.status === 'available'}<span class="badge"></span>{/if}
          </button>
        {/each}
      </nav>
    </aside>

    <div class="content">
      {#key section}
        <header>
          <h2>{current.label}</h2>
          <p class="muted">{current.blurb}</p>
        </header>

        {#if section === 'general'}
          <div class="group">
            <SettingRow title="Start page" description="What Ripple opens to.">
              <select class="select" bind:value={settings.startPage}>
                <option value="home">Home</option>
                <option value="discover">Discover</option>
                <option value="library">Library</option>
              </select>
            </SettingRow>
            <SettingRow title="Windows title bar" description="Use the standard Windows title bar instead of Ripple's themed one. Turn on if you want Windows 11 snap layouts on the maximize button.">
              <Switch bind:checked={settings.nativeTitleBar} label="Windows title bar" />
            </SettingRow>
            <SettingRow title="Hide 18+ catalogs" description="Skip catalogs from addons that mark themselves as adult on Home, Discover and Search.">
              <Switch bind:checked={settings.hideAdultAddons} label="Hide 18+ catalogs" />
            </SettingRow>
          </div>

        {:else if section === 'playback'}
          <div class="group">
            <SettingRow title="Player" description="Streams open in this app.">
              <div class="seg">
                {#each [['mpv', 'mpv'], ['vlc', 'VLC'], ['custom', 'Custom']] as [v, l] (v)}
                  <button class:on={settings.player === v} onclick={() => (settings.player = v as typeof settings.player)}>{l}</button>
                {/each}
              </div>
            </SettingRow>
            <SettingRow
              title="Player location"
              description={found && !settings.playerPath ? 'Found automatically. Set a path only to override it.' : settings.player === 'custom' ? 'Path to the player .exe.' : 'Leave empty to auto-detect.'}
              wide
            >
              <div class="status-input">
                {#if found && !settings.playerPath}<span class="ok-dot" title="Detected"></span>{/if}
                <input class="input" bind:value={settings.playerPath} placeholder={found?.path ?? 'Auto-detect'} spellcheck="false" />
              </div>
              {#if !found && settings.player !== 'custom' && !settings.playerPath}
                <p class="hint">{settings.player} wasn't found. Install it with <code>winget install {settings.player === 'vlc' ? 'VideoLAN.VLC' : 'mpv'}</code> or set its path.</p>
              {/if}
            </SettingRow>
            <SettingRow title="Extra player arguments" description="Passed to the player every time, e.g. --fullscreen --volume=80" wide>
              <input class="input mono" bind:value={settings.playerArgs} placeholder="--fullscreen" spellcheck="false" />
            </SettingRow>
          </div>

          <div class="group">
            <SettingRow title="Subtitle languages" description="Comma-separated 3-letter codes, in order of preference (eng, spa, fre…).">
              <input class="input short" bind:value={settings.subtitleLangs} placeholder="eng" spellcheck="false" />
            </SettingRow>
            <SettingRow title="Auto-play top stream" description="Start playing the best stream as soon as every addon has answered.">
              <Switch bind:checked={settings.autoPlayBest} label="Auto-play top stream" />
            </SettingRow>
          </div>

          <div class="group">
            <SettingRow title="Streaming server" description="Only needed for torrent (P2P) streams. Stremio Service runs one at http://127.0.0.1:11470. Debrid and direct links don't use it." wide>
              <input class="input mono" bind:value={settings.streamingServer} spellcheck="false" />
            </SettingRow>
          </div>

        {:else if section === 'streams'}
          <div class="group">
            <SettingRow title="Default sort" description="You can still change it per title in the stream list.">
              <select class="select" bind:value={settings.streamSort}>
                <option value="quality">Best quality</option>
                <option value="addon">Addon order</option>
                <option value="size-desc">Largest first</option>
                <option value="size-asc">Smallest first</option>
              </select>
            </SettingRow>
            <SettingRow title="Qualities to show" description={settings.qualities.length ? 'Only the selected qualities are shown.' : 'None selected: every quality is shown.'}>
              <div class="seg">
                {#each QUALITIES as q (q)}
                  <button class:on={settings.qualities.includes(q)} onclick={() => toggleQuality(q)}>{q}</button>
                {/each}
              </div>
            </SettingRow>
          </div>

          <div class="group">
            <SettingRow title="Hide CAM releases" description="Filter out camcorder and telesync copies.">
              <Switch bind:checked={settings.hideCam} label="Hide CAM releases" />
            </SettingRow>
            <SettingRow title="Direct links only" description="Hide torrent streams that need the streaming server.">
              <Switch bind:checked={settings.onlyDirect} label="Direct links only" />
            </SettingRow>
            <SettingRow title="Hide streams containing" description="Comma-separated words. Any match hides the stream." wide>
              <input class="input" bind:value={settings.excludeKeywords} placeholder="3D, HDTS, dubbed" />
            </SettingRow>
          </div>

        {:else if section === 'appearance'}
          <button class="hero-card" onclick={() => openStudio('look')}>
            <span class="hc-icon"><Icon name="brush" size={22} /></span>
            <span class="hc-text">
              <strong>Open Customize</strong>
              <span class="muted">Themes, colors, fonts, navigation, cards, hero banner and custom CSS, with live preview.</span>
            </span>
            <span class="kbd">Ctrl Shift C</span>
          </button>
          <div class="group">
            <SettingRow title="Home rows" description="Reorder, rename and restyle the catalogs on Home.">
              <button class="btn sm" onclick={() => openStudio('home')}>Edit<Icon name="chevronRight" size={14} /></button>
            </SettingRow>
            <SettingRow title="Layout" description="Navigation style, card style, title page layout.">
              <button class="btn sm" onclick={() => openStudio('layout')}>Edit<Icon name="chevronRight" size={14} /></button>
            </SettingRow>
            <SettingRow title="Saved themes" description="Save your look, share it as a .ripplestyle file, or import one.">
              <button class="btn sm" onclick={() => openStudio('themes')}>Manage<Icon name="chevronRight" size={14} /></button>
            </SettingRow>
          </div>

        {:else if section === 'data'}
          <div class="group">
            <SettingRow title="Addon timeout" description="How long to wait for a slow addon before giving up.">
              <div class="num">
                <input class="input" type="number" min="3" max="60" bind:value={settings.requestTimeoutSec} />
                <span class="muted">sec</span>
              </div>
            </SettingRow>
            <SettingRow title="Clear cache" description="Forget cached catalogs, details and streams so everything reloads fresh.">
              <button class="btn sm" onclick={() => { clearCache(); toast('Cache cleared', 'success'); }}>Clear</button>
            </SettingRow>
          </div>

          <div class="group">
            <SettingRow title="Back up" description="Save settings, addons, library and themes to a file.">
              <button class="btn sm" onclick={backup}><Icon name="download" size={14} />Export</button>
            </SettingRow>
            <SettingRow title="Restore" description="Load a Ripple backup file. Replaces your current data.">
              <button class="btn sm" onclick={() => fileInput?.click()}><Icon name="upload" size={14} />Import</button>
              <input type="file" accept="application/json" bind:this={fileInput} onchange={restore} hidden />
            </SettingRow>
          </div>

          <div class="group danger-zone">
            <SettingRow title="Reset settings" description="Restore playback, stream and general settings to defaults. Addons, library and your look are kept.">
              <button class="btn sm danger" onclick={() => confirm('Reset all settings to defaults?') && resetSettings()}>Reset</button>
            </SettingRow>
          </div>

        {:else if section === 'about'}
          <div class="about card">
            <svg viewBox="0 0 32 32" width="56" height="56" aria-hidden="true">
              <circle cx="16" cy="16" r="4" fill="var(--accent)" />
              <circle cx="16" cy="16" r="9" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.6" />
              <circle cx="16" cy="16" r="14" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.3" />
            </svg>
            <div>
              <div class="app">Ripple</div>
              <div class="muted">Version {updater.version || 'dev'}</div>
            </div>
          </div>

          <div class="group">
            <SettingRow
              title={updater.status === 'available' && updater.info ? `Version ${updater.info.version} is available` : 'Updates'}
              description={updater.status === 'installing'
                ? 'Downloading… Ripple will restart when it finishes.'
                : updater.status === 'error'
                  ? updater.error
                  : updater.status === 'none'
                    ? "You're on the latest version."
                    : 'Ripple checks GitHub Releases for new versions.'}
            >
              {#if updater.status === 'available'}
                <button class="btn sm ghost" onclick={() => updater.info && openExternal(updater.info.pageUrl)}>What's new</button>
                <button class="btn primary sm" onclick={installUpdate}>Update now</button>
              {:else if updater.status !== 'installing'}
                <button class="btn sm" disabled={updater.status === 'checking'} onclick={manualCheck}>
                  <Icon name="refresh" size={14} />{updater.status === 'checking' ? 'Checking…' : 'Check now'}
                </button>
              {/if}
            </SettingRow>
            <SettingRow title="Check on startup" description="Look for a new version a few seconds after Ripple opens.">
              <Switch bind:checked={settings.checkUpdates} label="Check on startup" />
            </SettingRow>
            <SettingRow title="Source code & releases" description="github.com/larosa023/Ripple">
              <button class="btn sm ghost" onclick={() => openExternal('https://github.com/larosa023/Ripple')}><Icon name="external" size={14} />Open</button>
            </SettingRow>
          </div>
          <p class="faint fine">Ripple works with any Stremio addon. It doesn't host or provide any content.</p>
        {/if}
      {/key}
    </div>
  </div>
</div>

<style>
  .layout { display: grid; grid-template-columns: 220px minmax(0, 760px); gap: 40px; max-width: 1060px; margin: 0 auto; }
  .side { position: sticky; top: 0; align-self: start; }
  .side .page-title { margin-bottom: 18px; }
  .side nav { display: flex; flex-direction: column; gap: 2px; }
  .cat {
    position: relative; display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 0; background: none;
    border-radius: min(var(--btn-radius), 10px); cursor: pointer; color: var(--text-2); font-weight: 600; font-size: 14px; text-align: left;
    transition: background var(--dur), color var(--dur);
  }
  .cat:hover { background: var(--bg-3); color: var(--text); }
  .cat.on { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--text); }
  .cat.on :global(svg) { color: var(--accent); }
  .badge { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-left: auto; }

  .content { padding-top: 6px; animation: fade 180ms var(--ease); }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } }
  :global(:root[data-motion='reduce']) .content { animation: none; }
  header { margin-bottom: 18px; }
  header h2 { font-size: 22px; margin: 0; letter-spacing: -0.01em; }
  header p { margin: 4px 0 0; font-size: 13.5px; }

  .group { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); margin-bottom: 14px; overflow: hidden; }
  .danger-zone { border-color: color-mix(in srgb, var(--danger) 35%, var(--line)); }

  .select { width: 190px; }
  .input.short { width: 190px; }
  .mono { font-family: ui-monospace, 'JetBrains Mono', Consolas, monospace; font-size: 13px; }
  .num { display: flex; align-items: center; gap: 8px; }
  .num .input { width: 80px; }
  .status-input { position: relative; display: flex; align-items: center; }
  .status-input .input { padding-left: 30px; }
  .status-input:not(:has(.ok-dot)) .input { padding-left: 12px; }
  .ok-dot { position: absolute; left: 12px; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .hint { margin: 0; font-size: 12.5px; color: var(--text-2); }
  code { background: var(--bg-3); padding: 1px 6px; border-radius: 4px; font-size: 12px; }

  .hero-card {
    display: flex; align-items: center; gap: 16px; width: 100%; padding: 18px; margin-bottom: 14px; text-align: left; cursor: pointer;
    border-radius: var(--radius); border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line));
    background: linear-gradient(120deg, color-mix(in srgb, var(--accent) 18%, var(--bg-2)), var(--bg-2) 70%);
    transition: border-color var(--dur), transform var(--dur);
  }
  .hero-card:hover { border-color: var(--accent); }
  .hc-icon { width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center; background: var(--accent); color: var(--on-accent); flex-shrink: 0; }
  .hc-text { display: flex; flex-direction: column; gap: 3px; flex: 1; font-size: 13px; }
  .hc-text strong { font-size: 15px; }
  .kbd { font-size: 11px; font-weight: 700; color: var(--text-2); padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); white-space: nowrap; }

  .about { display: flex; align-items: center; gap: 16px; padding: 18px; margin-bottom: 14px; }
  .app { font-family: var(--font-display); font-size: 22px; font-weight: 800; }
  .fine { font-size: 12.5px; }

  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; gap: 16px; }
    .side { position: static; }
    .side nav { flex-direction: row; flex-wrap: wrap; }
  }
</style>
