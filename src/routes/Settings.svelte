<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../lib/components/Icon.svelte';
  import SettingRow from '../lib/components/SettingRow.svelte';
  import Switch from '../lib/components/Switch.svelte';
  import { detectPlayers, errorText, installMpv, openExternal, type DetectedPlayer } from '../lib/player';
  import { clearCache } from '../lib/stremio/client';
  import { testTmdbKey } from '../lib/stremio/cast';
  import type { Quality } from '../lib/stremio/streams';
  import { exportAll, importAll } from '../lib/stores/persist';
  import { go, router } from '../lib/stores/router.svelte';
  import { resetSettings, settings } from '../lib/stores/settings.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { openStudio } from '../lib/stores/ui.svelte';
  import { checkForUpdate, installUpdate, updater } from '../lib/stores/updater.svelte';
  import { exportCsv, importDiary, profileUrl } from '../lib/letterboxd';
  import { sendDiscord } from '../lib/discord.svelte';
  import { shows } from '../lib/stores/shows.svelte';

  const SUB_FONTS = ['', 'Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Calibri', 'Georgia', 'Consolas'];
  const SUB_COLORS = ['#ffffff', '#fff3a8', '#ffe14d', '#a8f0ff', '#b6ffb0'];

  let lbBusy = $state(false);
  async function lbImport() {
    lbBusy = true;
    try {
      const r = await importDiary(settings.letterboxdUser);
      toast(r.found ? `Imported ${r.found} diary entries · ${r.added} newly marked watched` : 'Nothing in that diary yet', 'success', 5000);
    } catch (e) {
      toast((e as Error).message, 'error', 7000);
    } finally {
      lbBusy = false;
    }
  }
  function lbExport() {
    const { csv, count } = exportCsv();
    if (!count) {
      toast('No watched movies to export yet', 'info');
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `ripple-letterboxd-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Exported ${count} movies. Import the file at letterboxd.com/import`, 'success', 6000);
  }
  let discordState = $state<'' | 'checking' | 'ok' | string>('');
  async function testDiscord() {
    discordState = 'checking';
    const err = await sendDiscord(true);
    discordState = err ?? 'ok';
  }
  const showCount = $derived(Object.keys(shows).length);
  const subShadow = $derived(
    settings.subStyle === 'outline'
      ? '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 2px 0 #000, 0 -2px 0 #000, 2px 0 0 #000, -2px 0 0 #000'
      : settings.subStyle === 'shadow'
        ? '2px 3px 4px rgb(0 0 0 / 0.85)'
        : 'none',
  );

  type Section = 'general' | 'playback' | 'streams' | 'integrations' | 'appearance' | 'data' | 'about';
  const SECTIONS: { id: Section; label: string; icon: string; blurb: string }[] = [
    { id: 'general', label: 'General', icon: 'settings', blurb: 'Startup and content filtering' },
    { id: 'playback', label: 'Playback', icon: 'play', blurb: 'Player, subtitles and the streaming server' },
    { id: 'streams', label: 'Streams', icon: 'filter', blurb: 'How stream lists are sorted and filtered' },
    { id: 'integrations', label: 'Integrations', icon: 'link', blurb: 'TMDB, Letterboxd, Series Graph and Discord' },
    { id: 'appearance', label: 'Appearance', icon: 'brush', blurb: 'Themes, layouts and the home screen' },
    { id: 'data', label: 'Data & network', icon: 'download', blurb: 'Backups, cache and addon timeouts' },
    { id: 'about', label: 'About & updates', icon: 'refresh', blurb: 'Version and updates' },
  ];

  const section = $derived((SECTIONS.find((s) => s.id === router.route.query.get('tab'))?.id ?? 'general') as Section);
  const current = $derived(SECTIONS.find((s) => s.id === section)!);
  const QUALITIES: Quality[] = ['4K', '1080p', '720p', '480p', 'SD'];

  let detected: DetectedPlayer[] = $state([]);
  // 'mpv-embed' is the real mpv the built-in player needs (mpv.net doesn't count); the rest are external players.
  const externals = $derived(detected.filter((d) => d.player !== 'mpv-embed'));
  let fileInput: HTMLInputElement | undefined = $state();

  let detecting = $state(true);
  let installingMpv = $state(false);

  async function redetect() {
    detecting = true;
    detected = await detectPlayers().catch(() => []);
    detecting = false;
  }

  async function doInstallMpv() {
    installingMpv = true;
    try {
      await installMpv();
      await redetect();
      toast('mpv installed and ready', 'success');
    } catch (e) {
      toast(errorText(e), 'error', 9000);
    } finally {
      installingMpv = false;
    }
  }

  onMount(async () => {
    await redetect();
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
      location.reload(); // right away, before anything in memory can be saved over the backup
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }
  let tmdbDraft = $state(settings.tmdbKey);
  let tmdbState = $state<'' | 'checking' | 'ok' | 'bad'>(settings.tmdbKey ? 'ok' : '');
  async function saveTmdb() {
    const key = tmdbDraft.trim();
    if (!key) {
      settings.tmdbKey = '';
      tmdbState = '';
      return;
    }
    tmdbState = 'checking';
    if (await testTmdbKey(key)) {
      settings.tmdbKey = key;
      tmdbState = 'ok';
      toast('TMDB connected — cast photos are on', 'success');
    } else {
      tmdbState = 'bad';
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
          {@const mpvFound = detected.find((d) => d.player === 'mpv-embed')}
          <div class="group">
            <SettingRow title="Play videos" description={settings.playIn === 'ripple' ? 'Inside Ripple, with its own controls (uses mpv behind the scenes).' : 'In a separate player window.'}>
              <div class="seg">
                <button class:on={settings.playIn === 'ripple'} onclick={() => (settings.playIn = 'ripple')}>In Ripple</button>
                <button class:on={settings.playIn === 'external'} onclick={() => (settings.playIn = 'external')}>External player</button>
              </div>
            </SettingRow>
            {#if settings.playIn === 'ripple'}
              <SettingRow title="Video engine" description={mpvFound ? `mpv · ${mpvFound.path}` : 'The built-in player uses mpv to decode video.'} wide={!detecting && !mpvFound}>
                {#if detecting}
                  <span class="spinner small-spin"></span>
                {:else if mpvFound}
                  <span class="ready"><span class="ok-dot static"></span>Ready</span>
                {:else}
                  <div class="missing">
                    <span>mpv isn't installed yet. It's free and installs in about a minute.</span>
                    <button class="btn primary sm" disabled={installingMpv} onclick={doInstallMpv}>
                      {#if installingMpv}<span class="spinner small-spin"></span>Installing…{:else}Install mpv{/if}
                    </button>
                    <button class="btn sm ghost" disabled={detecting} onclick={redetect}>Check again</button>
                  </div>
                {/if}
              </SettingRow>
              <SettingRow title="Resume where you left off" description="Pick up from your last position when you reopen something.">
                <Switch bind:checked={settings.resume} label="Resume where you left off" />
              </SettingRow>
            {/if}
          </div>

          {#if settings.playIn === 'external'}
          <div class="group">
            <SettingRow title="External player" description="Streams open in this app.">
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
              {#if !detecting && !found && settings.player !== 'custom' && !settings.playerPath}
                <div class="missing">
                  <span>
                    {settings.player === 'mpv' ? 'mpv' : 'VLC'} wasn't found on this PC.
                    {#if externals.length}Ripple will use {externals[0].player === 'mpv' ? 'mpv' : 'VLC'} instead until you install it.{/if}
                  </span>
                  {#if settings.player === 'mpv'}
                    <button class="btn primary sm" disabled={installingMpv} onclick={doInstallMpv}>
                      {#if installingMpv}<span class="spinner small-spin"></span>Installing…{:else}Install mpv{/if}
                    </button>
                  {:else}
                    <button class="btn sm" onclick={() => openExternal('https://www.videolan.org/vlc/')}>Get VLC</button>
                  {/if}
                  <button class="btn sm ghost" disabled={detecting} onclick={redetect}>Check again</button>
                </div>
              {/if}
            </SettingRow>
            <SettingRow title="Extra player arguments" description="Passed to the player every time, e.g. --fullscreen --volume=80" wide>
              <input class="input mono" bind:value={settings.playerArgs} placeholder="--fullscreen" spellcheck="false" />
            </SettingRow>
          </div>
          {/if}

          <div class="group">
            <SettingRow title="Next episode" description="Near the end of an episode, show the next one with a countdown. It uses the same source as the episode you're watching when it can.">
              <Switch bind:checked={settings.autoplayNext} label="Next episode" />
            </SettingRow>
            {#if settings.autoplayNext}
              <SettingRow title="Countdown" description="How long before the next episode starts by itself.">
                <div class="seg">
                  {#each [[0, 'Off'], [5, '5s'], [10, '10s'], [15, '15s'], [30, '30s']] as [v, l] (v)}
                    <button class:on={settings.nextCountdown === v} onclick={() => (settings.nextCountdown = v as number)}>{l}</button>
                  {/each}
                </div>
              </SettingRow>
            {/if}
            <SettingRow title="Skip intro and recap" description="Uses chapter marks in the file, and AniSkip for anime. Auto never skips credits.">
              <div class="seg">
                <button class:on={settings.skipIntro === 'button'} onclick={() => (settings.skipIntro = 'button')}>Show button</button>
                <button class:on={settings.skipIntro === 'auto'} onclick={() => (settings.skipIntro = 'auto')}>Auto skip</button>
                <button class:on={settings.skipIntro === 'off'} onclick={() => (settings.skipIntro = 'off')}>Off</button>
              </div>
            </SettingRow>
            <SettingRow title="Remember choices per show" description={`Audio language, subtitles and source you used last time${showCount ? ` · ${showCount} show${showCount === 1 ? '' : 's'} remembered` : ''}.`}>
              {#if showCount}<button class="btn sm ghost" onclick={() => confirm('Forget remembered choices for every show?') && Object.keys(shows).forEach((k) => delete shows[k])}>Forget all</button>{/if}
              <Switch bind:checked={settings.rememberPerShow} label="Remember choices per show" />
            </SettingRow>
            <SettingRow title="Mini player" description="Adds a button to the player that shrinks the video into a corner so you can keep browsing.">
              <Switch bind:checked={settings.miniPlayer} label="Mini player" />
            </SettingRow>
          </div>

          <div class="group">
            <SettingRow title="Subtitle style" description="Applies to plain subtitles (SRT, VTT). Styled anime subtitles keep their own look unless you override them below." wide>
              <div class="sub-preview" aria-hidden="true">
                <span
                  style:font-family={settings.subFont || 'Arial, sans-serif'}
                  style:color={settings.subColor}
                  style:font-weight={settings.subBold ? 700 : 500}
                  style:font-size="{Math.round(22 * settings.subScale)}px"
                  style:text-shadow={subShadow}
                  style:background={settings.subStyle === 'box' ? 'rgb(0 0 0 / 0.7)' : 'transparent'}
                  style:bottom="{Math.max(6, (100 - settings.subPos) * 1.4 + 12)}px"
                >The quick brown fox jumps over the lazy dog</span>
              </div>
              <div class="sub-grid">
                <label>Font
                  <select class="select" bind:value={settings.subFont}>
                    {#each SUB_FONTS as f (f)}<option value={f}>{f || 'Default'}</option>{/each}
                  </select>
                </label>
                <label>Size
                  <span class="range"><input type="range" min="0.5" max="2" step="0.05" bind:value={settings.subScale} /><b>{Math.round(settings.subScale * 100)}%</b></span>
                </label>
                <label>Style
                  <div class="seg">
                    <button class:on={settings.subStyle === 'outline'} onclick={() => (settings.subStyle = 'outline')}>Outline</button>
                    <button class:on={settings.subStyle === 'shadow'} onclick={() => (settings.subStyle = 'shadow')}>Shadow</button>
                    <button class:on={settings.subStyle === 'box'} onclick={() => (settings.subStyle = 'box')}>Box</button>
                  </div>
                </label>
                <label>Color
                  <span class="swatches">
                    {#each SUB_COLORS as c (c)}<button class="sw" class:on={settings.subColor === c} style:background={c} onclick={() => (settings.subColor = c)} aria-label={c}></button>{/each}
                    <input type="color" bind:value={settings.subColor} aria-label="Custom color" />
                  </span>
                </label>
                <label>Position
                  <span class="range"><input type="range" min="70" max="100" step="1" bind:value={settings.subPos} /><b>{settings.subPos === 100 ? 'Bottom' : `${100 - settings.subPos}% up`}</b></span>
                </label>
                <label class="checks">
                  <span><input type="checkbox" bind:checked={settings.subBold} /> Bold</span>
                  <span title="Also restyle subtitles that come with their own fonts and colors (common for anime). Signs and karaoke may look off."><input type="checkbox" bind:checked={settings.subOverride} /> Override styled subtitles</span>
                </label>
              </div>
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

        {:else if section === 'integrations'}
          <div class="group">
            <SettingRow
              title="TMDB"
              description="A free TMDB API key or read-access token adds full cast with photos for movies and the episode ratings graph for shows. Create an account, then Settings → API."
              wide
            >
              <div class="tmdb">
                <input
                  class="input mono"
                  type="password"
                  placeholder="Paste API key or read-access token"
                  bind:value={tmdbDraft}
                  onkeydown={(e) => e.key === 'Enter' && saveTmdb()}
                  spellcheck="false"
                  autocomplete="off"
                />
                <button class="btn sm primary" disabled={tmdbState === 'checking' || tmdbDraft.trim() === settings.tmdbKey} onclick={saveTmdb}>
                  {tmdbState === 'checking' ? 'Checking…' : tmdbDraft.trim() ? 'Save' : 'Remove'}
                </button>
                <button class="btn sm ghost" onclick={() => openExternal('https://www.themoviedb.org/settings/api')}>
                  <Icon name="external" size={14} />Get a free key
                </button>
              </div>
              {#if tmdbState === 'ok' && settings.tmdbKey}<span class="ready"><span class="ok-dot static"></span>Connected</span>{/if}
              {#if tmdbState === 'bad'}<span class="bad">TMDB didn't accept that key. Copy the "API Key" or "API Read Access Token" exactly.</span>{/if}
            </SettingRow>
          </div>

          <div class="group">
            <SettingRow
              title="Letterboxd"
              description="Letterboxd has no public API, so Ripple can't sync both ways. It can mark films from your public diary as watched, export your Ripple watch history for Letterboxd's importer, and link every movie to its Letterboxd page."
              wide
            >
              <div class="tmdb">
                <input class="input" placeholder="Letterboxd username" bind:value={settings.letterboxdUser} spellcheck="false" autocomplete="off" />
                <button class="btn sm primary" disabled={lbBusy || !settings.letterboxdUser.trim()} onclick={lbImport}>
                  {#if lbBusy}<span class="spinner small-spin"></span>Importing…{:else}Import diary{/if}
                </button>
                {#if settings.letterboxdUser.trim()}
                  <button class="btn sm ghost" onclick={() => openExternal(profileUrl(settings.letterboxdUser))}><Icon name="external" size={14} />Profile</button>
                {/if}
              </div>
            </SettingRow>
            <SettingRow title="Export to Letterboxd" description="A CSV of the movies you've watched in Ripple. Upload it at letterboxd.com/import.">
              <button class="btn sm" onclick={lbExport}><Icon name="download" size={14} />Export CSV</button>
            </SettingRow>
          </div>

          <div class="group">
            <SettingRow
              title="Series Graph"
              description={settings.tmdbKey ? 'Shows get a Ratings view in their episode list, colored like Series Graph, plus a link to the show on seriesgraph.com.' : 'Add a TMDB key above to get the Series Graph-style episode ratings view on show pages.'}
            >
              <button class="btn sm ghost" onclick={() => openExternal('https://seriesgraph.com')}><Icon name="external" size={14} />seriesgraph.com</button>
            </SettingRow>
          </div>

          <div class="group">
            <SettingRow title="Discord status" description="Show what you're watching on your Discord profile while Discord is open.">
              <Switch bind:checked={settings.discord} label="Discord status" />
            </SettingRow>
            {#if settings.discord}
              <SettingRow
                title="Discord application ID"
                description="Discord shows the app's name as “Watching …”. Create an application named Ripple at discord.com/developers/applications and paste its Application ID."
                wide
              >
                <div class="tmdb">
                  <input class="input mono" placeholder="e.g. 1234567890123456789" bind:value={settings.discordAppId} spellcheck="false" inputmode="numeric" />
                  <button class="btn sm primary" disabled={!settings.discordAppId.trim() || discordState === 'checking'} onclick={testDiscord}>Test</button>
                  <button class="btn sm ghost" onclick={() => openExternal('https://discord.com/developers/applications')}><Icon name="external" size={14} />Developer portal</button>
                </div>
                {#if discordState === 'ok'}<span class="ready"><span class="ok-dot static"></span>Connected to Discord</span>{/if}
                {#if discordState && discordState !== 'ok' && discordState !== 'checking'}<span class="bad">{discordState}</span>{/if}
              </SettingRow>
            {/if}
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
                <input class="input" type="number" min="3" max="60" bind:value={settings.requestTimeoutSec} onchange={() => (settings.requestTimeoutSec = Math.min(60, Math.max(3, Math.round(Number(settings.requestTimeoutSec) || 12))))} />
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
  .tmdb { display: flex; gap: 8px; align-items: center; }
  .tmdb .input { flex: 1; }
  .bad { font-size: 12.5px; color: var(--danger); }
  .ready { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--ok); }
  .ok-dot.static { position: static; }
  .ok-dot { position: absolute; left: 12px; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .missing {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 12px; border-radius: 10px; font-size: 12.5px;
    background: color-mix(in srgb, var(--danger) 10%, transparent); border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  }
  .missing span { flex: 1; min-width: 200px; color: var(--text); }
  .small-spin { width: 13px; height: 13px; border-width: 2px; }

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

  .sub-preview {
    position: relative; height: 150px; border-radius: 10px; overflow: hidden;
    background: linear-gradient(135deg, #24324a, #4a3a2a 55%, #1d2a22); box-shadow: inset 0 0 60px rgb(0 0 0 / 0.5);
  }
  .sub-preview span { position: absolute; left: 50%; transform: translateX(-50%); white-space: nowrap; padding: 2px 8px; border-radius: 4px; line-height: 1.25; }
  .sub-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; }
  .sub-grid label { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--text-2); }
  .sub-grid .select { width: 100%; }
  .range { display: flex; align-items: center; gap: 10px; }
  .range input { flex: 1; accent-color: var(--accent); }
  .range b { min-width: 64px; font-size: 12.5px; color: var(--text); font-variant-numeric: tabular-nums; }
  .swatches { display: flex; align-items: center; gap: 6px; }
  .sw { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--line); cursor: pointer; padding: 0; }
  .sw.on { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent); }
  .swatches input[type='color'] { width: 28px; height: 28px; border: 0; padding: 0; background: none; cursor: pointer; }
  .checks { flex-direction: row !important; flex-wrap: wrap; gap: 8px 16px !important; align-items: center; align-self: end; }
  .checks span { display: flex; align-items: center; gap: 6px; color: var(--text); cursor: pointer; }
  @media (max-width: 720px) { .sub-grid { grid-template-columns: 1fr; } }
  .about { display: flex; align-items: center; gap: 16px; padding: 18px; margin-bottom: 14px; }
  .app { font-family: var(--font-display); font-size: 22px; font-weight: 800; }
  .fine { font-size: 12.5px; }

  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; gap: 16px; }
    .side { position: static; }
    .side nav { flex-direction: row; flex-wrap: wrap; }
  }
</style>
