<script lang="ts">
  // Controls drawn over mpv's video. The page behind is transparent while
  // playing, so mpv's picture shows through everywhere this overlay is clear.
  import Icon from './Icon.svelte';
  import WindowControls from './WindowControls.svelte';
  import { errorText, openExternal, playExternal } from '../player';
  import { filmUrl } from '../letterboxd';
  import { isTauri } from '../stremio/http';
  import { backdropOf } from '../stremio/images';
  import { settings } from '../stores/settings.svelte';
  import { toast } from '../stores/toast.svelte';
  import { prefetchNext, playNext } from '../watch';
  import { SKIP_LABEL, type Segment } from '../skip';
  import {
    applySubStyle,
    chooseAudio,
    chooseSub,
    layoutMini,
    setMini,
    setSubDelay,
    closePlayer,
    cycleSubs,
    fmtTime,
    mpv,
    playback,
    seekBy,
    seekTo,
    setFullscreen,
    setSpeed,
    setVolume,
    toggleFullscreen,
    toggleMute,
    togglePause,
    trackLabel,
  } from '../stores/playback.svelte';

  let showUi = $state(true);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let menu: '' | 'subs' | 'audio' | 'speed' = $state('');
  let hoverX = $state<number | null>(null);
  let scrubbing = $state(false);
  let bar: HTMLDivElement | undefined = $state();
  let flash = $state<'' | 'play' | 'pause' | 'back' | 'fwd'>('');
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  // ---------- skip intro / recap ----------
  let skipped = new Set<Segment>();
  const activeSeg = $derived(
    settings.skipIntro === 'off'
      ? null
      : (playback.segments.find(
          (g) => playback.time >= g.start && playback.time < g.end - 1 && (g.kind !== 'credits' || !playback.next) && g.kind !== 'preview',
        ) ?? null),
  );
  $effect(() => {
    const g = activeSeg;
    // Auto-skip only intros and recaps; credits can hide post-credit scenes.
    if (g && settings.skipIntro === 'auto' && (g.kind === 'intro' || g.kind === 'recap') && !skipped.has(g) && playback.ready && !playback.paused) {
      skipped.add(g);
      seekTo(g.end);
    }
  });
  function skipSeg() {
    if (!activeSeg) return;
    skipped.add(activeSeg);
    seekTo(activeSeg.end);
    poke();
  }

  // ---------- next episode ----------
  const episodic = $derived(!!playback.meta && playback.meta.type !== 'movie');
  /** When the next-episode card appears: at the credits if known, else 35s before the end. */
  const nextAt = $derived.by(() => {
    const d = playback.duration;
    if (!episodic || !(d > 300)) return Infinity;
    const credits = playback.segments.find((g) => (g.kind === 'credits' || g.kind === 'preview') && g.start > d * 0.6);
    return credits ? credits.start : d - 35;
  });
  let dismissed = $state(false);
  let countdown = $state(0);
  let lastVideo = '';
  $effect(() => {
    // Reset per video.
    if (playback.videoId !== lastVideo) {
      lastVideo = playback.videoId;
      dismissed = false;
      skipped = new Set();
      countdown = settings.nextCountdown;
    }
  });
  $effect(() => {
    if (episodic && settings.autoplayNext && playback.time > nextAt - 120) prefetchNext();
  });
  const showNext = $derived(
    episodic && settings.autoplayNext && !dismissed && !playback.error && !!playback.next && playback.next.status !== 'none' &&
      (playback.time >= nextAt || playback.ended),
  );
  $effect(() => {
    if (!showNext) countdown = settings.nextCountdown; // seeked back out of the credits: start over next time
  });
  $effect(() => {
    if (!showNext || playback.paused || settings.nextCountdown <= 0) return;
    const t = setInterval(() => {
      countdown = Math.max(0, countdown - 1);
      if (countdown === 0) {
        clearInterval(t);
        void playNext();
      }
    }, 1000);
    return () => clearInterval(t);
  });
  // Reaching the very end with a next episode lined up: go straight to it.
  $effect(() => {
    if (playback.ended && showNext && settings.nextCountdown > 0 && countdown > 0) void playNext();
  });

  // ---------- subtitles ----------
  $effect(() => {
    void [settings.subFont, settings.subScale, settings.subColor, settings.subStyle, settings.subPos, settings.subBold, settings.subOverride];
    if (playback.loaded) applySubStyle();
  });

  // ---------- mini player ----------
  $effect(() => {
    if (!playback.mini) return;
    const onResize = () => layoutMini();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  const subs = $derived(playback.tracks.filter((t) => t.type === 'sub'));
  const audios = $derived(playback.tracks.filter((t) => t.type === 'audio'));
  const progress = $derived(playback.duration ? (playback.time / playback.duration) * 100 : 0);
  const buffered = $derived(playback.duration ? Math.min(100, ((playback.time + playback.cacheTime) / playback.duration) * 100) : 0);
  const loading = $derived(!playback.error && (!playback.ready || playback.buffering) && !playback.ended);
  const customChrome = $derived(isTauri && !settings.nativeTitleBar && !playback.fullscreen);
  const volIcon = $derived(playback.muted || playback.volume === 0 ? 'mute' : playback.volume < 50 ? 'volumeLow' : 'volume');

  function poke() {
    showUi = true;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!playback.paused && !menu && !scrubbing && playback.loaded) showUi = false;
    }, 2600);
  }
  $effect(() => {
    if (playback.paused || menu) showUi = true;
    else poke();
  });

  function doFlash(kind: typeof flash) {
    flash = kind;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flash = ''), 450);
  }

  function pctAt(clientX: number): number {
    if (!bar) return 0;
    const r = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  }
  function onBarDown(e: PointerEvent) {
    scrubbing = true;
    bar?.setPointerCapture(e.pointerId);
    seekTo(pctAt(e.clientX) * playback.duration);
  }
  function onBarMove(e: PointerEvent) {
    hoverX = pctAt(e.clientX);
    if (scrubbing) seekTo(hoverX * playback.duration);
  }
  function onBarUp() {
    scrubbing = false;
    poke();
  }

  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  function onSurfaceClick() {
    if (menu) {
      menu = '';
      return;
    }
    // Wait a beat so a double-click (fullscreen) doesn't also toggle pause.
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      togglePause();
      doFlash(playback.paused ? 'pause' : 'play');
    }, 200);
  }
  function onSurfaceDbl() {
    clearTimeout(clickTimer);
    toggleFullscreen();
  }

  function onKey(e: KeyboardEvent) {
    if (!playback.active || playback.mini) return;
    const target = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const k = e.key;
    const handled = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
      poke();
    };
    if (k === ' ' || k === 'k' || k === 'K') {
      handled();
      togglePause();
      doFlash(playback.paused ? 'pause' : 'play');
    } else if (k === 'ArrowLeft' || k === 'j' || k === 'J') {
      handled();
      seekBy(k === 'ArrowLeft' && !e.shiftKey ? -5 : -10);
      doFlash('back');
    } else if (k === 'ArrowRight' || k === 'l' || k === 'L') {
      handled();
      seekBy(k === 'ArrowRight' && !e.shiftKey ? 5 : 10);
      doFlash('fwd');
    } else if (k === 'ArrowUp') {
      handled();
      setVolume(playback.volume + 5);
    } else if (k === 'ArrowDown') {
      handled();
      setVolume(playback.volume - 5);
    } else if (k === 'm' || k === 'M') {
      handled();
      toggleMute();
    } else if (k === 'f' || k === 'F') {
      handled();
      toggleFullscreen();
    } else if (k === 'c' || k === 'C') {
      handled();
      cycleSubs();
    } else if ((k === 's' || k === 'S') && activeSeg) {
      handled();
      skipSeg();
    } else if ((k === 'n' || k === 'N') && e.shiftKey && playback.next) {
      handled();
      void playNext();
    } else if (k === 'z' || k === 'Z' || k === 'x' || k === 'X') {
      handled();
      setSubDelay(playback.subDelay + (k.toLowerCase() === 'x' ? 0.1 : -0.1));
    } else if (k === 'Escape') {
      handled();
      if (menu) menu = '';
      else if (playback.fullscreen) setFullscreen(false);
      else closePlayer();
    } else if (k === '[' || k === ']') {
      handled();
      const steps = [0.5, 0.75, 1, 1.25, 1.5, 2];
      const i = steps.findIndex((s) => Math.abs(s - playback.speed) < 0.01);
      const next = steps[Math.max(0, Math.min(steps.length - 1, (i < 0 ? 2 : i) + (k === ']' ? 1 : -1)))];
      setSpeed(next);
    } else if (/^[0-9]$/.test(k) && playback.duration) {
      handled();
      seekTo((Number(k) / 10) * playback.duration);
    }
  }

  async function openExternally() {
    const src = playback.source;
    const title = playback.subtitle ? `${playback.title} — ${playback.subtitle}` : playback.title;
    if (!src) return;
    await closePlayer();
    try {
      await playExternal(src, title);
    } catch (e) {
      toast(errorText(e), 'error', 6000);
    }
  }

  function changeSubScale(d: number) {
    settings.subScale = Math.max(0.5, Math.min(2.5, +(settings.subScale + d).toFixed(2)));
    mpv('set_property', 'sub-scale', settings.subScale);
  }
</script>

<svelte:window onkeydown={onKey} />

{#if playback.active}
  <div
    class="player"
    class:hide={!showUi && !playback.mini}
    class:mini={playback.mini}
    role="application"
    aria-label="Video player"
    onpointermove={poke}
  >
    <!-- Solid cover until mpv draws its first frame, so the transparent window never shows the desktop. -->
    <div class="cover" class:gone={playback.ready && !playback.error} aria-hidden="true">
      {#if playback.meta && backdropOf(playback.meta, 'medium')}
        <div class="art" style:background-image={`url("${backdropOf(playback.meta, 'medium')}")`}></div>
      {/if}
    </div>

    {#if playback.mini}
      <!-- Mini player: the app is cut away around this box so mpv's picture shows through. -->
      <div class="surface" role="presentation" onclick={() => togglePause()} ondblclick={() => setMini(false)}></div>
      {#if loading}<div class="center"><div class="ring sm"></div></div>{/if}
      <div class="mini-ui">
        <div class="mini-top">
          <div class="mini-ttl" title={playback.title}>{playback.title}{#if playback.subtitle}<span>{playback.subtitle}</span>{/if}</div>
          <button class="ctl s" onclick={() => setMini(false)} title="Expand" aria-label="Expand"><Icon name="expand" size={16} /></button>
          <button class="ctl s" onclick={() => closePlayer()} title="Close" aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div class="mini-mid">
          <button class="ctl s" onclick={() => seekBy(-10)} aria-label="Back 10 seconds"><Icon name="back10" size={20} /></button>
          <button class="ctl big" onclick={() => togglePause()} aria-label={playback.paused ? 'Play' : 'Pause'}><Icon name={playback.paused ? 'play' : 'pause'} size={24} fill /></button>
          <button class="ctl s" onclick={() => seekBy(10)} aria-label="Forward 10 seconds"><Icon name="fwd10" size={20} /></button>
        </div>
      </div>
      {#if showNext}<button class="mini-next" onclick={() => playNext()}>{settings.nextCountdown > 0 && !playback.paused ? `Next in ${countdown}s` : 'Next'}</button>{/if}
      <div class="mini-bar"><div style:width="{progress}%"></div></div>
    {:else}
    <!-- Clicks on the video toggle pause; double-click toggles fullscreen. -->
    <div class="surface" role="presentation" onclick={onSurfaceClick} ondblclick={onSurfaceDbl}></div>

    <header class="top" data-tauri-drag-region={playback.fullscreen ? undefined : true}>
      <button class="ctl" onclick={() => closePlayer()} aria-label="Back" title="Back (Esc)"><Icon name="back" size={22} /></button>
      <div class="ttl" data-tauri-drag-region>
        <div class="name">{playback.title}</div>
        {#if playback.subtitle}<div class="ep">{playback.subtitle}</div>{/if}
      </div>
      {#if settings.miniPlayer}<button class="ctl" onclick={() => setMini(true)} title="Mini player (keep watching while you browse)"><Icon name="pip" size={20} /></button>{/if}
      <button class="ctl" onclick={openExternally} title="Open in external player"><Icon name="external" size={19} /></button>
      {#if customChrome}<div class="wc"><WindowControls /></div>{/if}
    </header>

    {#if loading}
      <div class="center"><div class="ring"></div>{#if playback.cachePct > 0 && playback.cachePct < 100}<span>{playback.cachePct}%</span>{/if}</div>
    {/if}
    {#if flash}
      <div class="center flash" aria-hidden="true">
        <Icon name={flash === 'play' ? 'play' : flash === 'pause' ? 'pause' : flash === 'back' ? 'back10' : 'fwd10'} size={34} fill={flash === 'play' || flash === 'pause'} />
      </div>
    {/if}

    {#if playback.error}
      <div class="center msg">
        <p>{playback.error}</p>
        <div class="row">
          <button class="btn" onclick={openExternally}><Icon name="external" size={15} />Try external player</button>
          <button class="btn primary" onclick={() => closePlayer()}>Pick another stream</button>
        </div>
      </div>
    {:else if playback.ended && !showNext}
      <div class="center msg">
        <p>Finished</p>
        <div class="row">
          <button class="btn" onclick={() => { seekTo(0); togglePause(); }}>Watch again</button>
          {#if playback.next && playback.next.status !== 'none'}
            <button class="btn primary" onclick={() => playNext()}><Icon name="next" size={15} fill />Next: {playback.next.label}</button>
          {:else}
            {#if !episodic && playback.meta && filmUrl(playback.meta)}
              <button class="btn" onclick={() => openExternal(filmUrl(playback.meta!)!)}>Log on Letterboxd</button>
            {/if}
            <button class="btn primary" onclick={() => closePlayer()}>Back to {episodic ? 'episodes' : 'details'}</button>
          {/if}
        </div>
      </div>
    {/if}

    {#if activeSeg && !playback.error}
      <button class="skip" class:lift={showUi} onclick={skipSeg} title="Skip (S)">{SKIP_LABEL[activeSeg.kind]}<Icon name="skip" size={15} fill /></button>
    {/if}

    {#if showNext && playback.next}
      {@const v = playback.next.video}
      {@const thumb = v.thumbnail || (playback.meta ? backdropOf(playback.meta, 'small') : '')}
      <div class="next" class:lift={showUi} role="dialog" aria-label="Next episode">
        <div class="nthumb">
          {#if thumb}<img src={thumb} alt="" />{/if}
          {#if settings.nextCountdown > 0 && !playback.paused}
            <svg viewBox="0 0 36 36" class="ringcd" aria-hidden="true">
              <circle cx="18" cy="18" r="15.5" />
              <circle cx="18" cy="18" r="15.5" class="fg" style:stroke-dashoffset={97.4 * (1 - countdown / settings.nextCountdown)} />
            </svg>
          {/if}
        </div>
        <div class="ninfo">
          <div class="nlabel">{settings.nextCountdown > 0 && !playback.paused ? `Next episode in ${countdown}s` : 'Next episode'}</div>
          <div class="ntitle" title={playback.next.label}>{playback.next.label}</div>
          <div class="nrow">
            <button class="btn sm primary" onclick={() => playNext()} disabled={playback.next.status === 'finding' && !playback.ended}>
              {#if playback.next.status === 'finding'}Finding source…{:else}<Icon name="play" size={13} fill />Play now{/if}
            </button>
            <button class="btn sm ghost" onclick={() => (dismissed = true)}>Cancel</button>
          </div>
        </div>
      </div>
    {/if}

    <footer class="bottom">
      <div
        class="bar"
        bind:this={bar}
        role="slider"
        tabindex="-1"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(playback.duration)}
        aria-valuenow={Math.round(playback.time)}
        onpointerdown={onBarDown}
        onpointermove={onBarMove}
        onpointerup={onBarUp}
        onpointerleave={() => !scrubbing && (hoverX = null)}
      >
        <div class="track">
          <div class="buf" style:width="{buffered}%"></div>
          <div class="fill" style:width="{progress}%"></div>
        </div>
        <div class="knob" style:left="{progress}%"></div>
        {#if hoverX !== null && playback.duration}
          <div class="tip" style:left="{hoverX * 100}%">{fmtTime(hoverX * playback.duration)}</div>
        {/if}
      </div>

      <div class="controls">
        <button class="ctl big" onclick={() => { togglePause(); doFlash(playback.paused ? 'pause' : 'play'); }} title={playback.paused ? 'Play (Space)' : 'Pause (Space)'}>
          <Icon name={playback.paused || playback.ended ? 'play' : 'pause'} size={24} fill />
        </button>
        <button class="ctl" onclick={() => seekBy(-10)} title="Back 10s (J)"><Icon name="back10" size={21} /></button>
        <button class="ctl" onclick={() => seekBy(10)} title="Forward 10s (L)"><Icon name="fwd10" size={21} /></button>

        <div class="vol">
          <button class="ctl" onclick={toggleMute} title="Mute (M)"><Icon name={volIcon} size={21} /></button>
          <input
            type="range" min="0" max="130" step="1" aria-label="Volume"
            value={playback.muted ? 0 : playback.volume}
            oninput={(e) => setVolume(+e.currentTarget.value)}
            style:--v="{((playback.muted ? 0 : playback.volume) / 130) * 100}%"
          />
        </div>

        <div class="time">{fmtTime(playback.time)} <span>/ {fmtTime(playback.duration)}</span></div>

        <div class="spacer"></div>

        <div class="menu-wrap">
          <button class="ctl" class:on={menu === 'speed'} onclick={() => (menu = menu === 'speed' ? '' : 'speed')} title="Speed">
            <Icon name="gauge" size={20} />{#if playback.speed !== 1}<b class="badge">{playback.speed}×</b>{/if}
          </button>
          {#if menu === 'speed'}
            <div class="menu">
              <div class="mh">Speed</div>
              {#each [0.5, 0.75, 1, 1.25, 1.5, 2] as s (s)}
                <button class:sel={Math.abs(playback.speed - s) < 0.01} onclick={() => { setSpeed(s); menu = ''; }}>{s === 1 ? 'Normal' : `${s}×`}</button>
              {/each}
            </div>
          {/if}
        </div>

        <div class="menu-wrap">
          <button class="ctl" class:on={menu === 'audio'} disabled={audios.length < 2} onclick={() => (menu = menu === 'audio' ? '' : 'audio')} title="Audio">
            <Icon name="audio" size={20} />
          </button>
          {#if menu === 'audio'}
            <div class="menu">
              <div class="mh">Audio</div>
              {#each audios as t (t.id)}
                <button class:sel={playback.aid === t.id} onclick={() => { chooseAudio(t); menu = ''; }}>{trackLabel(t)}</button>
              {/each}
            </div>
          {/if}
        </div>

        <div class="menu-wrap">
          <button class="ctl" class:on={menu === 'subs' || playback.sid !== false} onclick={() => (menu = menu === 'subs' ? '' : 'subs')} title="Subtitles (C)">
            <Icon name="cc" size={20} />
          </button>
          {#if menu === 'subs'}
            <div class="menu">
              <div class="mh">Subtitles</div>
              <button class:sel={playback.sid === false} onclick={() => { chooseSub(null); menu = ''; }}>Off</button>
              {#each subs as t (t.id)}
                <button class:sel={playback.sid === t.id} onclick={() => { chooseSub(t); menu = ''; }}>{trackLabel(t)}</button>
              {/each}
              {#if subs.length}
                <div class="sizer">
                  <span>Size</span>
                  <button onclick={() => changeSubScale(-0.1)} aria-label="Smaller subtitles">A−</button>
                  <b>{Math.round(settings.subScale * 100)}%</b>
                  <button onclick={() => changeSubScale(0.1)} aria-label="Larger subtitles">A+</button>
                </div>
                <div class="sizer">
                  <span title="Shift subtitles earlier or later (Z / X)">Sync</span>
                  <button onclick={() => setSubDelay(playback.subDelay - 0.1)} aria-label="Subtitles earlier">−</button>
                  <b class:off={playback.subDelay !== 0}>{playback.subDelay > 0 ? '+' : ''}{playback.subDelay.toFixed(1)}s</b>
                  <button onclick={() => setSubDelay(playback.subDelay + 0.1)} aria-label="Subtitles later">+</button>
                  {#if playback.subDelay !== 0}<button class="reset" onclick={() => setSubDelay(0)} title="Reset sync">↺</button>{/if}
                </div>
                {#if settings.miniPlayer}<a class="style-link" href="#/settings?tab=playback" onclick={() => setMini(true)}>Subtitle style…</a>{/if}
              {:else}
                <div class="none">No subtitles in this stream. Add languages in Settings → Playback to fetch them from subtitle addons.</div>
              {/if}
            </div>
          {/if}
        </div>

        <button class="ctl" onclick={toggleFullscreen} title="Fullscreen (F)"><Icon name={playback.fullscreen ? 'shrink' : 'expand'} size={20} /></button>
      </div>
    </footer>
    {/if}
  </div>
{/if}

<style>
  .player { position: fixed; inset: 0; z-index: 90; color: #fff; font-family: var(--font); user-select: none; }
  .player.hide { cursor: none; }
  .surface { position: absolute; inset: 0; }
  .cover { position: absolute; inset: 0; background: #000; transition: opacity 350ms ease, visibility 0s linear 0s; }
  .cover.gone { opacity: 0; visibility: hidden; transition: opacity 350ms ease, visibility 0s linear 350ms; }
  .art { position: absolute; inset: 0; background-size: cover; background-position: center; opacity: 0.28; transform: scale(1.05); }

  .top, .bottom { position: absolute; left: 0; right: 0; transition: opacity 220ms ease, transform 220ms ease; }
  .hide .top, .hide .bottom { opacity: 0; pointer-events: none; }
  .hide .top { transform: translateY(-8px); }
  .hide .bottom { transform: translateY(8px); }

  .top {
    top: 0; display: flex; align-items: center; gap: 10px; padding: 10px 0 34px 12px;
    background: linear-gradient(rgb(0 0 0 / 0.72), transparent);
  }
  .ttl { flex: 1; min-width: 0; }
  .name { font-family: var(--font-display); font-size: 17px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 6px rgb(0 0 0 / 0.6); }
  .ep { font-size: 13px; color: rgb(255 255 255 / 0.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wc { align-self: flex-start; height: 32px; margin-top: -10px; --text: #fff; --text-2: rgb(255 255 255 / 0.8); }
  .top > .ctl:last-of-type { margin-right: 12px; }

  .bottom { bottom: 0; padding: 40px 20px 14px; background: linear-gradient(transparent, rgb(0 0 0 / 0.8)); }

  .bar { position: relative; height: 22px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
  .track { position: relative; width: 100%; height: 4px; border-radius: 2px; background: rgb(255 255 255 / 0.22); overflow: hidden; transition: height 120ms; }
  .bar:hover .track { height: 6px; }
  .buf { position: absolute; inset: 0 auto 0 0; background: rgb(255 255 255 / 0.35); }
  .fill { position: absolute; inset: 0 auto 0 0; background: var(--accent); }
  .knob {
    position: absolute; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
    background: var(--accent); box-shadow: 0 0 0 3px rgb(0 0 0 / 0.25); transform: scale(0); transition: transform 120ms;
  }
  .bar:hover .knob { transform: scale(1); }
  .tip {
    position: absolute; bottom: 24px; transform: translateX(-50%); padding: 3px 7px; border-radius: 6px;
    background: rgb(0 0 0 / 0.85); font-size: 12px; font-variant-numeric: tabular-nums; pointer-events: none;
  }

  .controls { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
  .spacer { flex: 1; }
  .ctl {
    position: relative; display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 10px;
    background: transparent; color: rgb(255 255 255 / 0.92); cursor: pointer; transition: background 120ms, color 120ms;
  }
  .ctl:hover { background: rgb(255 255 255 / 0.14); color: #fff; }
  .ctl.on { color: var(--accent); }
  .ctl:disabled { opacity: 0.35; cursor: default; background: none; }
  .ctl.big { width: 46px; height: 46px; }
  .badge { position: absolute; bottom: 2px; right: 0; font-size: 9.5px; padding: 0 3px; border-radius: 4px; background: var(--accent); color: var(--on-accent); }
  .time { margin-left: 8px; font-size: 13.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .time span { color: rgb(255 255 255 / 0.6); font-weight: 500; }

  .vol { display: flex; align-items: center; }
  .vol input {
    width: 0; opacity: 0; transition: width 180ms ease, opacity 180ms ease; height: 4px; appearance: none; border-radius: 2px; cursor: pointer;
    background: linear-gradient(90deg, #fff var(--v), rgb(255 255 255 / 0.25) var(--v));
  }
  .vol:hover input, .vol input:focus-visible { width: 96px; opacity: 1; margin-right: 6px; }
  .vol input::-webkit-slider-thumb { appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #fff; }

  .menu-wrap { position: relative; }
  .menu {
    position: absolute; bottom: 48px; right: -6px; min-width: 220px; max-width: 340px; max-height: 50vh; overflow-y: auto;
    padding: 6px; border-radius: 12px; background: rgb(18 18 22 / 0.94); border: 1px solid rgb(255 255 255 / 0.1);
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.5); backdrop-filter: blur(12px);
  }
  .mh { padding: 6px 10px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: rgb(255 255 255 / 0.5); font-weight: 700; }
  .menu > button {
    display: block; width: 100%; text-align: left; padding: 8px 10px 8px 28px; border: 0; border-radius: 8px; position: relative;
    background: none; color: #fff; font-size: 13px; cursor: pointer;
  }
  .menu > button:hover { background: rgb(255 255 255 / 0.1); }
  .menu > button.sel::before { content: ''; position: absolute; left: 11px; top: 50%; width: 7px; height: 7px; margin-top: -3.5px; border-radius: 50%; background: var(--accent); }
  .sizer { display: flex; align-items: center; gap: 6px; padding: 8px 10px 4px; margin-top: 4px; border-top: 1px solid rgb(255 255 255 / 0.1); font-size: 12.5px; }
  .sizer span { flex: 1; color: rgb(255 255 255 / 0.6); }
  .sizer button { border: 0; border-radius: 6px; padding: 4px 9px; background: rgb(255 255 255 / 0.1); color: #fff; cursor: pointer; font-weight: 700; }
  .sizer b { min-width: 40px; text-align: center; font-variant-numeric: tabular-nums; }
  .sizer b.off { color: var(--accent); }
  .sizer .reset { padding: 4px 7px; font-weight: 600; }
  .style-link { display: block; padding: 8px 10px 4px; font-size: 12.5px; color: var(--accent); text-decoration: none; }
  .style-link:hover { text-decoration: underline; }

  /* Skip intro / recap */
  .skip {
    position: absolute; right: 28px; bottom: 34px; z-index: 3; display: flex; align-items: center; gap: 8px;
    padding: 11px 18px; border-radius: 10px; border: 1px solid rgb(255 255 255 / 0.35); cursor: pointer;
    background: rgb(12 12 16 / 0.72); color: #fff; font: 700 14px var(--font); backdrop-filter: blur(10px);
    transition: bottom 220ms ease, background var(--dur), border-color var(--dur); animation: rise 260ms ease;
  }
  .skip:hover { background: #fff; color: #000; border-color: #fff; }
  .skip.lift { bottom: 118px; }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } }

  /* Next episode */
  .next {
    position: absolute; right: 28px; bottom: 34px; z-index: 3; display: flex; gap: 14px; width: 420px; max-width: calc(100% - 56px);
    padding: 12px; border-radius: 14px; background: rgb(14 14 18 / 0.9); border: 1px solid rgb(255 255 255 / 0.12);
    box-shadow: 0 18px 48px rgb(0 0 0 / 0.55); transition: bottom 220ms ease; animation: rise 300ms ease;
  }
  .next.lift { bottom: 118px; }
  .nthumb { position: relative; width: 150px; aspect-ratio: 16 / 9; flex-shrink: 0; border-radius: 9px; overflow: hidden; background: #222; }
  .nthumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ringcd { position: absolute; right: 6px; bottom: 6px; width: 30px; height: 30px; transform: rotate(-90deg); }
  .ringcd circle { fill: rgb(0 0 0 / 0.55); stroke: rgb(255 255 255 / 0.25); stroke-width: 3; }
  .ringcd .fg { fill: none; stroke: var(--accent); stroke-dasharray: 97.4; transition: stroke-dashoffset 1s linear; }
  .ninfo { min-width: 0; display: flex; flex-direction: column; gap: 3px; justify-content: center; }
  .nlabel { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.07em; color: rgb(255 255 255 / 0.6); font-weight: 700; }
  .ntitle { font-weight: 700; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nrow { display: flex; gap: 6px; margin-top: 6px; }

  /* Mini player */
  .player.mini { inset: auto; left: var(--mini-x); top: var(--mini-y); width: var(--mini-w); height: var(--mini-h); border-radius: 12px; overflow: hidden; z-index: 95; box-shadow: 0 0 0 1px rgb(255 255 255 / 0.12); }
  .mini .cover { border-radius: 12px; }
  .mini-ui { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; opacity: 0; transition: opacity 160ms; pointer-events: none; background: linear-gradient(rgb(0 0 0 / 0.6), transparent 40%, transparent 60%, rgb(0 0 0 / 0.55)); }
  .mini:hover .mini-ui, .mini:focus-within .mini-ui { opacity: 1; }
  .mini-ui > * { pointer-events: auto; }
  .mini-top { display: flex; align-items: center; gap: 2px; padding: 6px 6px 0 10px; }
  .mini-ttl { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mini-ttl span { font-weight: 500; color: rgb(255 255 255 / 0.7); margin-left: 6px; }
  .mini-mid { align-self: center; display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
  .ctl.s { width: 32px; height: 32px; }
  .mini-next { position: absolute; right: 8px; bottom: 12px; border: 0; border-radius: 7px; padding: 5px 10px; background: var(--accent); color: var(--on-accent); font: 700 12px var(--font); cursor: pointer; opacity: 1; }
  .mini-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgb(255 255 255 / 0.2); }
  .mini-bar div { height: 100%; background: var(--accent); }
  .ring.sm { width: 30px; height: 30px; }
  .none { padding: 6px 10px 8px; font-size: 12.5px; color: rgb(255 255 255 / 0.6); line-height: 1.45; }

  .center {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column;
    align-items: center; gap: 10px; pointer-events: none; font-size: 13px; font-weight: 600; text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
  }
  .ring { width: 44px; height: 44px; border-radius: 50%; border: 3px solid rgb(255 255 255 / 0.2); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .flash {
    width: 76px; height: 76px; justify-content: center; border-radius: 50%; background: rgb(0 0 0 / 0.5);
    animation: pop 450ms ease forwards;
  }
  @keyframes pop { from { opacity: 1; transform: translate(-50%, -50%) scale(0.85); } to { opacity: 0; transform: translate(-50%, -50%) scale(1.15); } }
  .msg {
    pointer-events: auto; padding: 22px 26px; border-radius: 16px; background: rgb(14 14 18 / 0.9); border: 1px solid rgb(255 255 255 / 0.1);
    text-shadow: none; max-width: 440px; text-align: center;
  }
  .msg p { margin: 0; font-size: 15px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
</style>
