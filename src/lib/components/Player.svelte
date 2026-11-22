<script lang="ts">
  // Controls drawn over mpv's video. The page behind is transparent while
  // playing, so mpv's picture shows through everywhere this overlay is clear.
  import Icon from './Icon.svelte';
  import { untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import WindowControls from './WindowControls.svelte';
  import { errorText, openExternal, playExternal, torrentStatus, type TorrentStatus } from '../player';
  import { filmUrl } from '../letterboxd';
  import { isTauri } from '../stremio/http';
  import { backdropOf } from '../stremio/images';
  import { clockTime, settings } from '../stores/settings.svelte';
  import { toast } from '../stores/toast.svelte';
  import { epCode, prefetchNext, playNext, skipToNext, switchSource, upNext } from '../watch';
  import PlayerEpisodes from './PlayerEpisodes.svelte';
  import { canDownload, downloadOf, startDownload } from '../downloads.svelte';
  import type { Video } from '../stremio/types';
  import { goLive, neighbour, playChannel, zap, zapChannels } from '../iptv/play.svelte';
  import { nowNext, tv } from '../iptv/live.svelte';
  import { SKIP_LABEL, type Segment } from '../skip';
  import {
    applySubStyle,
    applyAspect,
    ASPECT_LABEL,
    cycleAspect,
    screenshot,
    setAudioDelay,
    type Aspect,
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
    trackParts,
  } from '../stores/playback.svelte';
  import { baseLang } from '../lang';
  import { openStudio, ui } from '../stores/ui.svelte';

  let showUi = $state(true);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let menu: '' | 'tracks' | 'speed' | 'channels' | 'more' | 'episodes' = $state('');
  let stats = $state(false);
  let hoverX = $state<number | null>(null);
  let scrubbing = $state(false);
  let bar: HTMLDivElement | undefined = $state();
  let flash = $state<'' | 'play' | 'pause' | 'back' | 'fwd'>('');
  let help = $state(false);
  let volPill = $state(false);
  let volTimer: ReturnType<typeof setTimeout> | undefined;
  function showVol() {
    volPill = true;
    clearTimeout(volTimer);
    volTimer = setTimeout(() => (volPill = false), 900);
  }
  function onWheel(e: WheelEvent) {
    // Scroll over the video: volume or seeking, whichever you picked.
    if (settings.wheelAction === 'off') return;
    e.preventDefault();
    if (settings.wheelAction === 'seek' && !live && playback.duration) {
      seekBy(e.deltaY < 0 ? settings.arrowStep : -settings.arrowStep);
      doFlash(e.deltaY < 0 ? 'fwd' : 'back');
      poke();
      return;
    }
    setVolume(playback.volume + (e.deltaY < 0 ? 5 : -5));
    showVol();
  }
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
  const curVideo = $derived(((playback.meta?.videos ?? []) as Video[]).find((v) => v.id === playback.videoId) ?? null);
  const nextVid = $derived(episodic && !playback.live ? upNext() : null);
  const hasEpisodes = $derived(episodic && !playback.live && (playback.meta?.videos?.length ?? 0) > 1);
  const epNum = (v: Video) => v.episode ?? v.number;

  // ---------- downloads ----------
  const canSave = $derived(
    isTauri && !playback.live && !!playback.meta && !!playback.stream && canDownload(playback.stream) && !playback.source?.url.startsWith('file://'),
  );

  // ---------- seek-bar previews ----------
  // A hidden helper mpv grabs the frame you hover over; frames are kept per stream so
  // moving back over the bar is instant, and the nearest one fills in while a new one loads.
  const frames = new Map<number, string>();
  let framesFor = '';
  let thumb = $state('');
  let thumbLoading = $state(false);
  const canPreview = $derived(
    settings.seekPreviews && isTauri && !playback.live && !!playback.source && /^(https?|file):/i.test(playback.source.url) && playback.duration > 0,
  );
  const step = $derived(Math.max(2, playback.duration / 400));
  $effect(() => {
    if (hoverX === null || !canPreview || !playback.source) {
      thumbLoading = false;
      return;
    }
    const src = playback.source;
    if (framesFor !== src.url) {
      frames.clear();
      framesFor = src.url;
      thumb = '';
    }
    const b = Math.round((hoverX * playback.duration) / step);
    const hit = frames.get(b);
    if (hit) {
      thumb = hit;
      thumbLoading = false;
      return;
    }
    // Nearest frame we already have, so the box never sits empty.
    let best = -1;
    for (const k of frames.keys()) if (best < 0 || Math.abs(k - b) < Math.abs(best - b)) best = k;
    if (best >= 0 && Math.abs(best - b) * step < playback.duration / 12) thumb = frames.get(best)!;
    thumbLoading = true;
    const timer = setTimeout(async () => {
      try {
        const url = await invoke<string>('player_thumb', {
          req: {
            url: src.url,
            seconds: b * step,
            headers: src.headers,
            path: settings.player === 'mpv' && settings.playerPath ? settings.playerPath : null,
            width: 320,
          },
        });
        if (typeof url !== 'string' || !url.startsWith('data:image/')) return;
        frames.set(b, url);
        if (framesFor === src.url && hoverX !== null && Math.round((hoverX * playback.duration) / step) === b) {
          thumb = url;
          thumbLoading = false;
        }
      } catch {
        /* cancelled by a newer hover, or this stream can't seek: keep what we have */
      }
    }, 110);
    return () => clearTimeout(timer);
  });
  /** Keeps the preview box inside the bar at the far left and right. */
  const tipLeft = $derived.by(() => {
    if (hoverX === null || !bar) return '0px';
    const w = bar.clientWidth;
    const half = canPreview ? 96 : 0;
    return `${Math.min(w - half, Math.max(half, hoverX * w))}px`;
  });

  // ---------- switching sources ----------
  // A source that errors, or sits loading/buffering far too long, is swapped for the next best one.
  let switchingSrc = $state(false);
  async function trySwitch(reason: 'error' | 'stall') {
    if (switchingSrc) return;
    switchingSrc = true;
    try {
      await switchSource(reason);
    } finally {
      switchingSrc = false;
    }
  }
  // Only a new error triggers this (untracked, so the switch's own state changes can't re-run it).
  $effect(() => {
    if (playback.error && !playback.live && playback.meta && settings.autoSwitch) untrack(() => void trySwitch('error'));
  });
  let lastMove = 0;
  let lastT = -1;
  $effect(() => {
    void playback.source;
    lastMove = Date.now();
    lastT = -1;
  });
  $effect(() => {
    const t = playback.time;
    if (Math.abs(t - lastT) > 0.3) {
      lastT = t;
      lastMove = Date.now();
    }
  });
  $effect(() => {
    const id = setInterval(() => {
      if (!playback.active || playback.live || !settings.autoSwitch || !playback.meta || playback.ended || playback.error || switchingSrc) return;
      if (playback.paused && playback.ready) {
        lastMove = Date.now(); // paused isn't stalled
        return;
      }
      if (playback.ready && !playback.buffering) return;
      // Torrents can take a while to find peers; direct links shouldn't.
      const limit = (playback.source?.torrent ? 45 : 25) * 1000;
      if (Date.now() - lastMove > limit) {
        lastMove = Date.now();
        void trySwitch('stall');
      }
    }, 2000);
    return () => clearInterval(id);
  });

  // ---------- pause screen ----------
  // A beat after pausing, the picture dims and a panel says what this is: no flicker on a quick pause.
  let pauseCard = $state(false);
  $effect(() => {
    const want = playback.paused && playback.ready && !playback.ended && !playback.error && !live && !playback.mini;
    if (!want) {
      pauseCard = false;
      return;
    }
    const t = setTimeout(() => (pauseCard = true), 700);
    return () => clearTimeout(t);
  });
  let logoBroken = $state(false);
  $effect(() => {
    void playback.meta?.logo;
    logoBroken = false;
  });
  const left = $derived.by(() => {
    const m = Math.max(0, Math.round((playback.duration - playback.time) / 60));
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
  });
  const facts = $derived.by(() => {
    const m = playback.meta;
    if (!m) return [] as string[];
    const year = curVideo?.released ? String(new Date(curVideo.released).getFullYear()) : String(m.year ?? m.releaseInfo ?? '');
    return [year, ...(m.genres ?? []).slice(0, 3), m.runtime ?? ''].filter((x) => x && x !== 'NaN');
  });
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
    void [settings.subFont, settings.subScale, settings.subColor, settings.subStyle, settings.subPos, settings.subBold, settings.subOverride, settings.subBack];
    if (playback.loaded) applySubStyle();
  });

  $effect(() => {
    void settings.videoAspect;
    if (playback.loaded) applyAspect();
  });

  // ---------- chapters on the seek bar ----------
  const chapterMarks = $derived(
    playback.duration > 0 ? playback.chapters.filter((c) => c.time > 1 && c.time < playback.duration - 1) : [],
  );
  function chapterAt(t: number): string {
    let name = '';
    for (const c of playback.chapters) if (c.time <= t) name = c.title ?? '';
    return /^(chapter\s*)?\d+$/i.test(name.trim()) ? '' : name;
  }

  // ---------- screenshot ----------
  async function snap() {
    try {
      const file = await screenshot();
      toast(file ? `Screenshot saved: ${file.split(/[\\/]/).pop()}` : 'Screenshot saved to Pictures › Ripple', 'success', 2500);
    } catch (e) {
      toast(errorText(e), 'error', 4000);
    }
  }

  // ---------- stats for nerds ----------
  interface Stats { [k: string]: unknown }
  let info = $state<Stats>({});
  const STAT_PROPS = [
    'video-params', 'video-codec', 'hwdec-current', 'container-fps', 'estimated-vf-fps', 'video-bitrate',
    'audio-codec-name', 'audio-params', 'audio-bitrate', 'file-format', 'demuxer-cache-duration',
    'frame-drop-count', 'decoder-frame-drop-count', 'file-size', 'width', 'height',
  ];
  $effect(() => {
    if (!stats || !playback.active) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    // Next round only after this one finishes, so a slow player never builds up a queue of reads.
    const tick = async () => {
      const out: Stats = {};
      for (const p of STAT_PROPS) {
        if (!alive) return;
        out[p] = await mpv('get_property', p);
      }
      if (!alive) return;
      info = out;
      t = setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  });
  const statRows = $derived.by(() => {
    const vp = (info['video-params'] ?? {}) as Record<string, unknown>;
    const ap = (info['audio-params'] ?? {}) as Record<string, unknown>;
    const kbps = (b: unknown) => (typeof b === 'number' && b > 0 ? (b >= 1e6 ? `${(b / 1e6).toFixed(1)} Mbps` : `${Math.round(b / 1000)} kbps`) : '');
    const rows: [string, string][] = [];
    const res = vp.w && vp.h ? `${vp.w}×${vp.h}` : '';
    const hdr = vp.gamma === 'pq' ? 'HDR10 / PQ' : vp.gamma === 'hlg' ? 'HLG' : '';
    rows.push(['Video', [res, String(info['video-codec'] ?? '').split(' ')[0], hdr, vp.pixelformat].filter(Boolean).join(' · ')]);
    const fps = Number(info['estimated-vf-fps'] ?? info['container-fps'] ?? 0);
    rows.push(['Frame rate', fps ? `${fps.toFixed(3).replace(/\.?0+$/, '')} fps` : '']);
    rows.push(['Video bitrate', kbps(info['video-bitrate'])]);
    rows.push(['Decoder', info['hwdec-current'] && info['hwdec-current'] !== 'no' ? `Hardware (${info['hwdec-current']})` : 'Software']);
    rows.push(['Audio', [info['audio-codec-name'], ap['hr-channels'] ?? (ap['channel-count'] ? `${ap['channel-count']} ch` : ''), ap.samplerate ? `${Math.round(Number(ap.samplerate) / 100) / 10} kHz` : '', kbps(info['audio-bitrate'])].filter(Boolean).join(' · ')]);
    rows.push(['Container', String(info['file-format'] ?? '')]);
    const size = Number(info['file-size'] ?? 0);
    rows.push(['File size', size ? `${(size / 1073741824).toFixed(2)} GB` : '']);
    const cache = Number(info['demuxer-cache-duration'] ?? 0);
    rows.push(['Buffered ahead', cache ? `${cache.toFixed(1)} s` : '']);
    const drops = Number(info['frame-drop-count'] ?? 0) + Number(info['decoder-frame-drop-count'] ?? 0);
    rows.push(['Dropped frames', String(drops)]);
    if (playback.source?.torrent && tstat) {
      rows.push(['Torrent', `${tstat.peers} peers · ${fmtRate(tstat.downloadSpeed)} · ${tstat.total ? Math.round((tstat.downloaded / tstat.total) * 100) : 0}% downloaded`]);
    }
    return rows.filter(([, v]) => v && v !== 'undefined');
  });

  // Mouse Back button closes the full-size player instead of navigating behind it.
  $effect(() => {
    const onMouseNav = (e: Event) => {
      if (!playback.active || playback.mini || (e as CustomEvent).detail !== 'back') return;
      e.preventDefault();
      if (playback.fullscreen) setFullscreen(false);
      else closePlayer();
    };
    window.addEventListener('ripple:mouse-nav', onMouseNav);
    return () => window.removeEventListener('ripple:mouse-nav', onMouseNav);
  });

  // ---------- mini player ----------
  $effect(() => {
    if (!playback.mini) return;
    const onResize = () => layoutMini();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // ---------- live TV ----------
  const live = $derived(playback.live);
  const onNow = $derived(live ? nowNext(live.id, tv.now) : { now: null, next: null });
  const liveProgress = $derived(onNow.now ? Math.min(100, ((tv.now - onNow.now.s) / (onNow.now.e - onNow.now.s)) * 100) : 0);
  const clock = (t: number) => clockTime(t);
  const prevCh = $derived(live ? neighbour(-1) : null);
  const nextCh = $derived(live ? neighbour(1) : null);
  /** Paused live TV falls behind; this jumps back to what's airing. */
  let behind = $state(false);
  $effect(() => {
    if (live && playback.paused) behind = true;
  });
  $effect(() => {
    void live?.id;
    behind = false;
  });
  let chFilter = $state('');
  const guideList = $derived.by(() => {
    if (menu !== 'channels') return [];
    const q = chFilter.trim().toLowerCase();
    const all = zapChannels();
    return (q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all).slice(0, 300);
  });

  const subs = $derived(playback.tracks.filter((t) => t.type === 'sub'));
  const audios = $derived(playback.tracks.filter((t) => t.type === 'audio'));

  // ---------- audio & subtitle menu ----------
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  function toggleMenu(m: typeof menu) {
    menu = menu === m ? '' : m;
    subQuery = '';
  }
  let subQuery = $state('');
  const prefLangs = $derived(settings.subtitleLangs.split(',').map((l) => baseLang(l.trim())).filter(Boolean));
  const rank = (base: string) => {
    const i = prefLangs.indexOf(base);
    return i < 0 ? 999 : i;
  };
  // Full subtitles first, then SDH, then forced (signs only) for each language.
  const kind = (tags: string[]) => (tags.includes('Forced') ? 2 : tags.includes('SDH') || tags.includes('CC') ? 1 : 0);
  const audioRows = $derived(audios.map((t) => ({ t, p: trackParts(t) })));
  const subRows = $derived.by(() => {
    const rows = subs
      .map((t) => ({ t, p: trackParts(t) }))
      .sort(
        (a, b) =>
          rank(a.p.base) - rank(b.p.base) ||
          a.p.name.localeCompare(b.p.name) ||
          kind(a.p.tags) - kind(b.p.tags) ||
          Number(a.p.addon) - Number(b.p.addon) ||
          a.t.id - b.t.id,
      );
    // Two addon subtitles in the same language would look identical: number them ("· 2") so you can try another.
    const seen = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.p.name}|${r.p.detail}|${r.p.tags.join()}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n > 1) r.p.detail = r.p.detail ? `${r.p.detail} · ${n}` : `#${n}`;
    }
    return rows;
  });
  const shownSubs = $derived.by(() => {
    const q = subQuery.trim().toLowerCase();
    return q ? subRows.filter((r) => `${r.p.name} ${r.p.detail} ${r.p.tags.join(' ')}`.toLowerCase().includes(q)) : subRows;
  });
  /** Where "Other languages" starts (only when some of your languages are listed above it). */
  const otherFrom = $derived.by(() => {
    const i = shownSubs.findIndex((r) => rank(r.p.base) === 999);
    return i > 0 ? i : -1;
  });
  const progress = $derived(playback.duration ? (playback.time / playback.duration) * 100 : 0);
  // Rounded to the minute, so the label only changes when the minute does.
  const endsAt = $derived.by(() => {
    if (!playback.duration || playback.duration < 60) return '';
    const left = (playback.duration - playback.time) / (playback.speed || 1);
    return clockTime(Math.round((Date.now() + left * 1000) / 60000) * 60000);
  });
  const buffered = $derived(playback.duration ? Math.min(100, ((playback.time + playback.cacheTime) / playback.duration) * 100) : 0);
  const loading = $derived(!playback.error && (!playback.ready || playback.buffering) && !playback.ended);

  // Built-in torrent engine: peers and speed while it buffers (and in the stats panel).
  let tstat = $state<TorrentStatus | null>(null);
  $effect(() => {
    const hash = playback.source?.torrent;
    const watch = loading || stats;
    if (!hash || !watch) return;
    let live = true;
    const tick = () => torrentStatus(hash).then((s) => live && (tstat = s)).catch(() => {});
    tick();
    const t = setInterval(tick, 1000);
    return () => {
      live = false;
      clearInterval(t);
    };
  });
  const fmtRate = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB/s` : `${Math.round(b / 1024)} KB/s`);
  const customChrome = $derived(isTauri && !settings.nativeTitleBar && !playback.fullscreen);
  const volIcon = $derived(playback.muted || playback.volume === 0 ? 'mute' : playback.volume < 50 ? 'volumeLow' : 'volume');

  function poke() {
    showUi = true;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!playback.paused && !menu && !scrubbing && playback.loaded) showUi = false;
    }, Math.max(1, settings.hideDelay) * 1000);
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
  function onSurfaceDbl(e: MouseEvent) {
    clearTimeout(clickTimer);
    if (settings.dblClick === 'off') return;
    if (settings.dblClick === 'seek' && !live && playback.duration) {
      // Double-click the left or right third to jump back or forward; the middle still goes fullscreen.
      const x = e.clientX / window.innerWidth;
      if (x < 1 / 3 || x > 2 / 3) {
        seekBy(x < 0.5 ? -settings.seekStep : settings.seekStep);
        doFlash(x < 0.5 ? 'back' : 'fwd');
        return;
      }
    }
    toggleFullscreen();
  }

  function onKey(e: KeyboardEvent) {
    if (!playback.active || playback.mini || ui.studioOpen) return;
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
    } else if (live && (k === 'PageUp' || k === 'PageDown')) {
      handled();
      zap(k === 'PageUp' ? -1 : 1);
    } else if (live && (k === 'g' || k === 'G')) {
      handled();
      menu = menu === 'channels' ? '' : 'channels';
    } else if (live && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'j' || k === 'J' || k === 'l' || k === 'L' || /^[0-9]$/.test(k) || k === '[' || k === ']')) {
      handled(); // no seeking or speed changes on live TV
    } else if (k === 'ArrowLeft' || k === 'j' || k === 'J') {
      handled();
      seekBy(-(k === 'ArrowLeft' ? settings.arrowStep * (e.shiftKey ? 3 : 1) : settings.seekStep));
      doFlash('back');
    } else if (k === 'ArrowRight' || k === 'l' || k === 'L') {
      handled();
      seekBy(k === 'ArrowRight' ? settings.arrowStep * (e.shiftKey ? 3 : 1) : settings.seekStep);
      doFlash('fwd');
    } else if (k === 'ArrowUp') {
      handled();
      setVolume(playback.volume + 5);
      showVol();
    } else if (k === 'ArrowDown') {
      handled();
      setVolume(playback.volume - 5);
      showVol();
    } else if (k === '?' || (k === '/' && e.shiftKey)) {
      handled();
      help = !help;
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
    } else if ((k === 'z' || k === 'Z' || k === 'x' || k === 'X') && e.shiftKey) {
      handled();
      setAudioDelay(playback.audioDelay + (k.toLowerCase() === 'x' ? 0.1 : -0.1));
      toast(`Audio sync ${playback.audioDelay > 0 ? '+' : ''}${playback.audioDelay.toFixed(1)}s`, 'info', 1200);
    } else if (k === 'z' || k === 'Z' || k === 'x' || k === 'X') {
      handled();
      setSubDelay(playback.subDelay + (k.toLowerCase() === 'x' ? 0.1 : -0.1));
    } else if (k === 'a' || k === 'A') {
      handled();
      toast(`Picture: ${ASPECT_LABEL[cycleAspect()]}`, 'info', 1200);
    } else if (k === 'p' || k === 'P') {
      handled();
      void snap();
    } else if ((k === 'e' || k === 'E') && hasEpisodes) {
      handled();
      menu = menu === 'episodes' ? '' : 'episodes';
      poke();
    } else if (k === 'i' || k === 'I') {
      handled();
      stats = !stats;
    } else if (k === 'Escape') {
      handled();
      if (help) help = false;
      else if (stats) stats = false;
      else if (menu) menu = '';
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
    await closePlayer(true, src.torrent); // the external player keeps streaming the torrent
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
      {:else if live?.logo}
        <img class="chlogo" src={live.logo} alt="" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />
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
          {#if live}
            <button class="ctl s" onclick={() => zap(-1)} disabled={!prevCh} aria-label="Previous channel"><Icon name="up" size={20} /></button>
          {:else}
            <button class="ctl s" onclick={() => seekBy(-10)} aria-label="Back 10 seconds"><Icon name="back10" size={20} /></button>
          {/if}
          <button class="ctl big" onclick={() => togglePause()} aria-label={playback.paused ? 'Play' : 'Pause'}><Icon name={playback.paused ? 'play' : 'pause'} size={24} fill /></button>
          {#if live}
            <button class="ctl s" onclick={() => zap(1)} disabled={!nextCh} aria-label="Next channel"><Icon name="down" size={20} /></button>
          {:else}
            <button class="ctl s" onclick={() => seekBy(10)} aria-label="Forward 10 seconds"><Icon name="fwd10" size={20} /></button>
          {/if}
        </div>
      </div>
      {#if showNext}<button class="mini-next" onclick={() => playNext()}>{settings.nextCountdown > 0 && !playback.paused ? `Next in ${countdown}s` : 'Next'}</button>{/if}
      <div class="mini-bar"><div style:width="{live ? liveProgress : progress}%"></div></div>
    {:else}
    <!-- Clicks on the video toggle pause; double-click toggles fullscreen. -->
    <div class="surface" role="presentation" onclick={onSurfaceClick} ondblclick={onSurfaceDbl} onwheel={onWheel}></div>

    {#if volPill}
      <div class="volpill" aria-hidden="true"><Icon name={volIcon} size={18} /><div class="vbar"><i style:width="{Math.min(100, (playback.volume / 130) * 100)}%"></i></div><b>{playback.muted ? 'Muted' : `${Math.round(playback.volume)}%`}</b></div>
    {/if}

    {#if help}
      <div class="help" role="dialog" aria-label="Keyboard shortcuts">
        <div class="hh">Keyboard shortcuts <button class="ctl s" onclick={() => (help = false)} aria-label="Close"><Icon name="x" size={16} /></button></div>
        <dl>
          {#each live ? [
            ['Space / K', 'Play / pause'], ['Page Up / Down', 'Previous / next channel'], ['G', 'Channel list'], ['↑ / ↓ or scroll', 'Volume'],
            ['M', 'Mute'], ['F / F11 or double-click', 'Fullscreen'], ['C', 'Next subtitle track'], ['P', 'Screenshot'], ['I', 'Stats for nerds'],
            ['Esc or mouse Back', 'Close player'], ['?', 'This list'],
          ] : [
            ['Space / K', 'Play / pause'], ['← / →', `Back / forward ${settings.arrowStep}s (Shift: ${settings.arrowStep * 3}s)`], ['J / L', `Back / forward ${settings.seekStep}s`],
            ['↑ / ↓' + (settings.wheelAction === 'volume' ? ' or scroll' : ''), 'Volume'], ...(settings.wheelAction === 'seek' ? [['Scroll', `Back / forward ${settings.arrowStep}s`]] : []),
            ['M', 'Mute'], ['F / F11' + (settings.dblClick === 'fullscreen' ? ' or double-click' : ''), 'Fullscreen'], ['C', 'Next subtitle track'], ['Z / X', 'Subtitles earlier / later'],
            ['Shift + Z / X', 'Audio earlier / later'], ['[ / ]', 'Slower / faster'], ['0–9', 'Jump to 0–90%'], ['S', 'Skip intro / recap'],
            ['Shift + N', 'Next episode'], ['E', 'Episodes'], ['A', 'Fit / fill / stretch'], ['P', 'Screenshot'], ['I', 'Stats for nerds'],
            ['Esc or mouse Back', 'Close player'], ['?', 'This list'],
          ] as [k, d] (k)}
            <dt>{k}</dt><dd>{d}</dd>
          {/each}
        </dl>
      </div>
    {/if}

    <header class="top" data-tauri-drag-region={playback.fullscreen ? undefined : true}>
      <button class="ctl" onclick={() => closePlayer()} aria-label="Back" title="Back (Esc)"><Icon name="back" size={22} /></button>
      <div class="ttl" data-tauri-drag-region>
        <div class="name">{playback.title}</div>
        {#if curVideo && curVideo.season != null && epNum(curVideo) != null}
          <div class="ep"><span class="sechip">S{curVideo.season} · E{epNum(curVideo)}</span>{curVideo.title || curVideo.name || ''}</div>
        {:else if playback.subtitle}<div class="ep">{playback.subtitle}</div>{/if}
      </div>
      {#if settings.miniPlayer}<button class="ctl" onclick={() => setMini(true)} title="Mini player (keep watching while you browse)"><Icon name="pip" size={20} /></button>{/if}
      <button class="ctl" onclick={openExternally} title="Open in external player"><Icon name="external" size={19} /></button>
      {#if customChrome}<div class="wc"><WindowControls /></div>{/if}
    </header>

    {#if loading}
      <div class="center"><div class="ring"></div>{#if playback.cachePct > 0 && playback.cachePct < 100}<span>{playback.cachePct}%</span>{/if}{#if playback.source?.torrent && tstat}<span class="peers">{tstat.peers ? `${tstat.peers} ${tstat.peers === 1 ? 'peer' : 'peers'} · ${fmtRate(tstat.downloadSpeed)}` : 'Looking for peers…'}</span>{/if}</div>
    {/if}
    {#if flash}
      <div class="center flash" aria-hidden="true">
        <Icon name={flash === 'play' ? 'play' : flash === 'pause' ? 'pause' : flash === 'back' ? 'back10' : 'fwd10'} size={34} fill={flash === 'play' || flash === 'pause'} />
      </div>
    {/if}

    {#if playback.error && live}
      <div class="center msg">
        <p>{live.name} isn't playing right now. The channel may be offline, or your provider may limit how many streams you can watch at once.</p>
        <div class="row">
          <button class="btn" onclick={openExternally}><Icon name="external" size={15} />Try external player</button>
          <button class="btn" onclick={goLive}><Icon name="refresh" size={15} />Try again</button>
          {#if nextCh}<button class="btn primary" onclick={() => zap(1)}>Next channel<Icon name="down" size={15} /></button>{/if}
        </div>
      </div>
    {:else if playback.ended && live}
      <div class="center msg">
        <p>The stream stopped.</p>
        <div class="row">
          <button class="btn primary" onclick={goLive}><Icon name="refresh" size={15} />Reconnect</button>
          <button class="btn" onclick={() => closePlayer()}>Back to channels</button>
        </div>
      </div>
    {:else if playback.error && switchingSrc}
      <div class="center"><div class="ring"></div><span>Trying another source…</span></div>
    {:else if playback.error}
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

    {#if menu === 'channels' && live}
      <div class="guide" role="dialog" aria-label="Channels">
        <div class="gh">
          <input class="gsearch" placeholder="Find a channel" bind:value={chFilter} aria-label="Find a channel" />
          <button class="ctl s" onclick={() => (menu = '')} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div class="glist">
          {#each guideList as c (c.id)}
            {@const nn = nowNext(c.id, tv.now)}
            <button class="gch" class:sel={c.id === live.id} onclick={() => { void playChannel(c); menu = ''; }}>
              <span class="glogo">{#if c.logo}<img src={c.logo} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />{/if}</span>
              <span class="gtxt"><b>{c.name}</b>{#if nn.now}<small>{nn.now.t}</small>{/if}</span>
            </button>
          {:else}
            <div class="none">No channels match.</div>
          {/each}
        </div>
      </div>
    {/if}

    {#if pauseCard && !menu && !scrubbing && !help && playback.meta}
      {@const m = playback.meta}
      {@const about = curVideo?.overview || curVideo?.description || m.description || ''}
      <div class="pausecard" aria-live="polite">
        <div class="pc-body">
          <div class="pc-eyebrow"><span class="pc-pill"><Icon name="pause" size={10} fill />Paused</span>{episodic ? "You're watching" : ''}</div>
          {#if m.logo && !logoBroken}
            <img class="pc-logo" src={m.logo} alt={m.name} onerror={() => (logoBroken = true)} />
          {:else}
            <h1 class="pc-title">{m.name}</h1>
          {/if}
          {#if curVideo && episodic}
            <div class="pc-ep">
              {#if curVideo.season != null && epNum(curVideo) != null}<span>Season {curVideo.season} · Episode {epNum(curVideo)}</span>{/if}
              {#if curVideo.title || curVideo.name}<b>{curVideo.title || curVideo.name}</b>{/if}
            </div>
          {/if}
          <div class="pc-facts">
            {#if m.imdbRating}<span class="pc-rate"><Icon name="star" size={13} fill />{m.imdbRating}</span>{/if}
            {#each facts as f (f)}<span>{f}</span>{/each}
          </div>
          {#if about}<p class="pc-about">{about}</p>{/if}
          <div class="pc-time">
            <div class="pc-bar"><i style:width="{progress}%"></i></div>
            <span><b>{left}</b>{#if endsAt}&nbsp;· Ends at {endsAt}{/if}</span>
          </div>
        </div>
        {#if nextVid}
          <button class="pc-next" onclick={() => skipToNext()}>
            <span class="pc-nthumb" style:background-image={nextVid.thumbnail || backdropOf(m, 'small') ? `url("${nextVid.thumbnail || backdropOf(m, 'small')}")` : undefined}><Icon name="play" size={18} fill /></span>
            <span class="pc-ntxt"><em>Up next</em><b>{epCode(nextVid)}</b><small>{nextVid.title || nextVid.name || ''}</small></span>
          </button>
        {/if}
      </div>
    {/if}

    {#if menu === 'episodes'}
      <PlayerEpisodes onclose={() => (menu = '')} />
    {/if}

    {#if stats}
      <div class="stats" role="dialog" aria-label="Stats for nerds">
        <div class="sh">Stats for nerds <button class="ctl s" onclick={() => (stats = false)} aria-label="Close"><Icon name="x" size={14} /></button></div>
        <dl>
          {#each statRows as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
        </dl>
      </div>
    {/if}

    <footer class="bottom">
      {#if live}
      <div class="livebar">
        <div class="track"><div class="fill" style:width="{liveProgress}%"></div></div>
      </div>
      {:else}
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
          {#each chapterMarks as c, i (i)}<i class="chap" style:left="{(c.time / playback.duration) * 100}%"></i>{/each}
        </div>
        <div class="knob" style:left="{progress}%"></div>
        {#if hoverX !== null && playback.duration}
          {@const chap = chapterMarks.length ? chapterAt(hoverX * playback.duration) : ''}
          <div class="tip" class:withthumb={canPreview} style:left={tipLeft}>
            {#if canPreview}
              <span class="tthumb" class:loading={thumbLoading}>{#if thumb}<img src={thumb} alt="" />{/if}<i></i></span>
            {/if}
            {#if chap}<span class="tchap">{chap}</span>{/if}<span class="ttime">{fmtTime(hoverX * playback.duration)}</span>
          </div>
        {/if}
      </div>
      {/if}

      <div class="controls">
        <button class="ctl big" onclick={() => { togglePause(); doFlash(playback.paused ? 'pause' : 'play'); }} title={playback.paused ? 'Play (Space)' : 'Pause (Space)'}>
          <Icon name={playback.paused || playback.ended ? 'play' : 'pause'} size={24} fill />
        </button>
        {#if live}
          <button class="ctl" onclick={() => zap(-1)} disabled={!prevCh} title={prevCh ? `Previous: ${prevCh.name} (Page Up)` : 'Previous channel'}><Icon name="up" size={21} /></button>
          <button class="ctl" onclick={() => zap(1)} disabled={!nextCh} title={nextCh ? `Next: ${nextCh.name} (Page Down)` : 'Next channel'}><Icon name="down" size={21} /></button>
        {:else}
          <button class="ctl skipn" onclick={() => seekBy(-settings.seekStep)} title="Back {settings.seekStep}s (J)"><Icon name="replay" size={22} /><span>{settings.seekStep}</span></button>
          <button class="ctl skipn" onclick={() => seekBy(settings.seekStep)} title="Forward {settings.seekStep}s (L)"><Icon name="forward" size={22} /><span>{settings.seekStep}</span></button>
          {#if nextVid}
            <div class="nextwrap">
              <button class="ctl" onclick={() => skipToNext()} aria-label="Next episode (Shift+N)"><Icon name="next" size={20} fill /></button>
              <div class="nexttip" aria-hidden="true">
                <span class="nt-thumb" style:background-image={nextVid.thumbnail || (playback.meta && backdropOf(playback.meta, 'small')) ? `url("${nextVid.thumbnail || backdropOf(playback.meta!, 'small')}")` : undefined}></span>
                <span class="nt-txt">
                  <em>Next episode · Shift+N</em>
                  <b>{epCode(nextVid)}{nextVid.title || nextVid.name ? ` · ${nextVid.title || nextVid.name}` : ''}</b>
                  {#if nextVid.overview || nextVid.description}<small>{nextVid.overview || nextVid.description}</small>{/if}
                </span>
              </div>
            </div>
          {/if}
        {/if}

        <div class="vol">
          <button class="ctl" onclick={toggleMute} title="Mute (M)"><Icon name={volIcon} size={21} /></button>
          <input
            type="range" min="0" max="130" step="1" aria-label="Volume"
            value={playback.muted ? 0 : playback.volume}
            oninput={(e) => setVolume(+e.currentTarget.value)}
            style:--v="{((playback.muted ? 0 : playback.volume) / 130) * 100}%"
          />
        </div>

        {#if live}
          <button class="livepill" class:behind onclick={() => behind && goLive()} title={behind ? 'Jump to live' : 'Watching live'}><i></i>{behind ? 'Go live' : 'Live'}</button>
          {#if onNow.now}
            <div class="onnow" title={onNow.now.d ?? onNow.now.t}>
              <b>{onNow.now.t}</b> <span>{`${clock(onNow.now.s)}–${clock(onNow.now.e)}${onNow.next ? ` · Next: ${onNow.next.t}` : ''}`}</span>
            </div>
          {/if}
        {:else}
        <button class="time" onclick={() => (settings.showRemaining = !settings.showRemaining)} title="Show {settings.showRemaining ? 'total length' : 'time remaining'}">
          {fmtTime(playback.time)} <span>/ {settings.showRemaining ? `-${fmtTime(Math.max(0, playback.duration - playback.time))}` : fmtTime(playback.duration)}</span>
        </button>
        {#if settings.showEndsAt && endsAt}<span class="ends" title="When this finishes, at the current speed">Ends at {endsAt}</span>{/if}
        {/if}

        <div class="spacer"></div>

        {#if hasEpisodes}
          <button class="ctl eps-btn" class:on={menu === 'episodes'} onclick={() => toggleMenu('episodes')} title="Episodes (E)" aria-expanded={menu === 'episodes'}>
            <Icon name="episodes" size={20} /><span>Episodes</span>
          </button>
        {/if}
        {#if live}
          <button class="ctl" class:on={menu === 'channels'} onclick={() => (menu = menu === 'channels' ? '' : 'channels')} title="Channels (G)"><Icon name="list" size={20} /></button>
        {:else}
        <div class="menu-wrap">
          <button class="ctl" class:on={menu === 'speed'} onclick={() => toggleMenu('speed')} title="Playback speed ([ / ])" aria-expanded={menu === 'speed'}>
            <Icon name="gauge" size={20} />{#if playback.speed !== 1}<b class="badge">{+playback.speed.toFixed(2)}×</b>{/if}
          </button>
          {#if menu === 'speed'}
            <div class="pmenu speed" role="dialog" aria-label="Playback speed">
              <div class="phead"><span>Playback speed</span><b class="val">{playback.speed === 1 ? 'Normal' : `${+playback.speed.toFixed(2)}×`}</b></div>
              <div class="chips">
                {#each SPEEDS as sp (sp)}
                  <button class:sel={Math.abs(playback.speed - sp) < 0.01} onclick={() => setSpeed(sp)}>{sp === 1 ? '1×' : `${sp}×`}</button>
                {/each}
              </div>
              <label class="fine">
                <input type="range" min="0.25" max="3" step="0.05" value={playback.speed} oninput={(e) => setSpeed(+e.currentTarget.value)} style:--v="{((playback.speed - 0.25) / 2.75) * 100}%" aria-label="Fine speed" />
              </label>
            </div>
          {/if}
        </div>
        {/if}

        <div class="menu-wrap">
          <button class="ctl" class:on={menu === 'tracks' || playback.sid !== false} onclick={() => toggleMenu('tracks')} title="Audio & subtitles (C cycles subtitles)" aria-expanded={menu === 'tracks'}>
            <Icon name="cc" size={20} />
          </button>
          {#if menu === 'tracks'}
            <div class="pmenu tracks" class:two={audioRows.length > 1} role="dialog" aria-label="Audio and subtitles">
              <div class="cols">
                {#if audioRows.length > 1}
                  <section class="col">
                    <div class="phead"><Icon name="audio" size={15} /><span>Audio</span></div>
                    <div class="opts">
                      {#each audioRows as r (r.t.id)}
                        <button class="opt" class:sel={playback.aid === r.t.id} onclick={() => chooseAudio(r.t)}>
                          <span class="txt"><b>{r.p.name}</b>{#if r.p.detail}<small>{r.p.detail}</small>{/if}</span>
                          {#each r.p.tags as tag (tag)}<em class="tag">{tag}</em>{/each}
                          <i class="tick"><Icon name="check" size={16} stroke={2.4} /></i>
                        </button>
                      {/each}
                    </div>
                  </section>
                {/if}
                <section class="col">
                  <div class="phead">
                    <Icon name="cc" size={15} /><span>Subtitles</span>
                    {#if subRows.length > 8}
                      <input class="find" placeholder="Find a language" bind:value={subQuery} spellcheck="false" aria-label="Find a subtitle language" />
                    {/if}
                  </div>
                  <div class="opts">
                    {#if !subQuery}
                      <button class="opt" class:sel={playback.sid === false} onclick={() => chooseSub(null)}>
                        <span class="txt"><b>Off</b></span>
                        <i class="tick"><Icon name="check" size={16} stroke={2.4} /></i>
                      </button>
                    {/if}
                    {#each shownSubs as r, i (r.t.id)}
                      {#if i === otherFrom}<div class="divider">Other languages</div>{/if}
                      <button class="opt" class:sel={playback.sid === r.t.id} onclick={() => chooseSub(r.t)}>
                        <span class="txt"><b>{r.p.name}</b>{#if r.p.detail}<small>{r.p.detail}</small>{/if}</span>
                        {#each r.p.tags as tag (tag)}<em class="tag">{tag}</em>{/each}
                        <i class="tick"><Icon name="check" size={16} stroke={2.4} /></i>
                      </button>
                    {:else}
                      <div class="none">
                        {#if subQuery}No subtitles match “{subQuery}”.
                        {:else if live}This channel has no subtitles or captions.
                        {:else}No subtitles in this stream. Add languages in Settings → Playback to fetch them from your subtitle addons.{/if}
                      </div>
                    {/each}
                  </div>
                </section>
              </div>
              {#if subRows.length}
                <div class="pfoot">
                  <div class="step" title="Subtitle size">
                    <span>Size</span>
                    <button onclick={() => changeSubScale(-0.1)} aria-label="Smaller subtitles">−</button>
                    <b>{Math.round(settings.subScale * 100)}%</b>
                    <button onclick={() => changeSubScale(0.1)} aria-label="Larger subtitles">+</button>
                  </div>
                  <div class="step" title="Show subtitles earlier or later (Z / X)">
                    <span>Sync</span>
                    <button onclick={() => setSubDelay(playback.subDelay - 0.1)} aria-label="Subtitles earlier">−</button>
                    <b class:off={playback.subDelay !== 0}>{playback.subDelay > 0 ? '+' : ''}{playback.subDelay.toFixed(1)}s</b>
                    <button onclick={() => setSubDelay(playback.subDelay + 0.1)} aria-label="Subtitles later">+</button>
                    {#if playback.subDelay !== 0}<button class="reset" onclick={() => setSubDelay(0)} title="Reset sync">Reset</button>{/if}
                  </div>
                  {#if settings.miniPlayer}<a class="style-link" href="#/settings?tab=playback" onclick={() => setMini(true)}>Style…</a>{/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="menu-wrap">
          <button class="ctl" class:on={menu === 'more' || stats} onclick={() => toggleMenu('more')} title="More" aria-expanded={menu === 'more'}><Icon name="dots" size={20} /></button>
          {#if menu === 'more'}
            <div class="pmenu more" role="dialog" aria-label="More options">
              {#if !live}
                <div class="phead"><Icon name="picture" size={15} /><span>Picture</span><span class="key">A</span></div>
                <div class="chips three">
                  {#each ['fit', 'fill', 'stretch'] as a (a)}
                    <button class:sel={settings.videoAspect === a} onclick={() => (settings.videoAspect = a as Aspect)}>{ASPECT_LABEL[a as Aspect].replace(' (crop)', '')}</button>
                  {/each}
                </div>
              {/if}
              <div class="phead"><Icon name="audio" size={15} /><span>Audio sync</span><span class="key">⇧Z / ⇧X</span></div>
              <div class="step wide">
                <button onclick={() => setAudioDelay(playback.audioDelay - 0.1)} aria-label="Audio earlier">−</button>
                <b class:off={playback.audioDelay !== 0}>{playback.audioDelay > 0 ? '+' : ''}{playback.audioDelay.toFixed(1)}s</b>
                <button onclick={() => setAudioDelay(playback.audioDelay + 0.1)} aria-label="Audio later">+</button>
                <button class="reset" disabled={playback.audioDelay === 0} onclick={() => setAudioDelay(0)}>Reset</button>
              </div>
              <div class="sep"></div>
              <button class="row" onclick={() => { menu = ''; void snap(); }}><Icon name="camera" size={17} /><span>Take screenshot</span><span class="key">P</span></button>
              {#if canSave}
                {@const have = downloadOf(playback.videoId)}
                <button class="row" disabled={!!have} onclick={() => { menu = ''; void startDownload(playback.stream!, playback.meta!, playback.videoId, playback.subtitle); }}>
                  <Icon name="download" size={17} /><span>{have ? (have.status === 'done' ? 'Downloaded' : 'Downloading…') : episodic ? 'Download this episode' : 'Download'}</span>
                </button>
              {/if}
              <button class="row" class:sel={stats} onclick={() => { stats = !stats; menu = ''; }}><Icon name="info" size={17} /><span>Stats for nerds</span><span class="key">I</span></button>
              <button class="row" onclick={() => { help = true; menu = ''; }}><Icon name="keyboard" size={17} /><span>Keyboard shortcuts</span><span class="key">?</span></button>
              <button class="row" onclick={() => { menu = ''; openStudio('player'); }}><Icon name="sliders" size={17} /><span>Player settings…</span></button>
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
  .chlogo { position: absolute; left: 50%; top: 50%; width: min(220px, 30vw); max-height: 30vh; object-fit: contain; transform: translate(-50%, -50%); opacity: 0.35; }
  .livebar { padding: 14px 0 6px; }
  .livebar .track { height: 4px; border-radius: 2px; background: rgb(255 255 255 / 0.22); overflow: hidden; }
  .livebar .fill { height: 100%; background: var(--player-accent); }
  .livepill {
    display: inline-flex; align-items: center; gap: 7px; border: 0; border-radius: 6px; padding: 4px 9px; margin-left: 6px;
    background: rgb(255 255 255 / 0.12); color: #fff; font: 800 11.5px var(--font); letter-spacing: 0.08em; text-transform: uppercase; cursor: default;
  }
  .livepill i { width: 7px; height: 7px; border-radius: 50%; background: #ff3b4e; }
  .livepill.behind { cursor: pointer; background: rgb(255 255 255 / 0.2); }
  .livepill.behind i { background: rgb(255 255 255 / 0.5); }
  .livepill.behind:hover { background: rgb(255 255 255 / 0.3); }
  .onnow { min-width: 0; margin-left: 12px; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 1; }
  .onnow span { color: rgb(255 255 255 / 0.65); }
  .guide {
    position: absolute; right: 16px; bottom: 96px; top: 76px; width: 330px; display: flex; flex-direction: column; z-index: 3;
    background: rgb(16 16 20 / 0.92); border: 1px solid rgb(255 255 255 / 0.1); border-radius: 14px; backdrop-filter: blur(16px); overflow: hidden;
  }
  .gh { display: flex; gap: 6px; padding: 10px; border-bottom: 1px solid rgb(255 255 255 / 0.08); }
  .gsearch { flex: 1; min-width: 0; border: 0; border-radius: 8px; padding: 8px 10px; background: rgb(255 255 255 / 0.1); color: #fff; font: 500 13.5px var(--font); outline: none; }
  .glist { overflow-y: auto; flex: 1; padding: 6px; }
  .gch { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: none; color: #fff; text-align: left; padding: 7px 8px; border-radius: 9px; cursor: pointer; }
  .gch:hover { background: rgb(255 255 255 / 0.08); }
  .gch.sel { background: color-mix(in srgb, var(--player-accent) 30%, transparent); }
  .glogo { width: 44px; height: 28px; flex-shrink: 0; border-radius: 5px; background: rgb(255 255 255 / 0.08); display: grid; place-items: center; overflow: hidden; }
  .glogo img { max-width: 90%; max-height: 90%; object-fit: contain; }
  .gtxt { min-width: 0; display: flex; flex-direction: column; }
  .gtxt b { font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gtxt small { font-size: 11.5px; color: rgb(255 255 255 / 0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .guide .none { padding: 20px; text-align: center; color: rgb(255 255 255 / 0.6); font-size: 13px; }
  .player { position: fixed; inset: 0; z-index: 90; color: #fff; font-family: var(--font); user-select: none; }
  .player.hide { cursor: none; }
  .surface { position: absolute; inset: 0; }
  .cover { position: absolute; inset: 0; background: #000; transition: opacity 350ms ease, visibility 0s linear 0s; }
  .cover.gone { opacity: 0; visibility: hidden; transition: opacity 350ms ease, visibility 0s linear 350ms; }
  .art { position: absolute; inset: 0; background-size: cover; background-position: center; opacity: 0.28; transform: scale(1.05); }

  .top, .bottom { position: absolute; left: 0; right: 0; z-index: 2; transition: opacity 220ms ease, transform 220ms ease; }
  .hide .top, .hide .bottom { opacity: 0; pointer-events: none; }
  .hide .top { transform: translateY(-8px); }
  .hide .bottom { transform: translateY(8px); }

  .top {
    top: 0; display: flex; align-items: center; gap: 10px; padding: 10px 0 34px 12px;
    background: linear-gradient(rgb(0 0 0 / 0.72), transparent);
  }
  .ttl { flex: 1; min-width: 0; }
  .name { font-family: var(--font-display); font-size: 17px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 6px rgb(0 0 0 / 0.6); }
  .ep { display: flex; align-items: center; gap: 8px; margin-top: 2px; font-size: 13px; color: rgb(255 255 255 / 0.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 6px rgb(0 0 0 / 0.6); }
  .sechip { flex-shrink: 0; padding: 1px 7px; border-radius: 6px; background: rgb(255 255 255 / 0.16); font: 700 11px var(--font); letter-spacing: 0.03em; color: #fff; text-shadow: none; backdrop-filter: blur(8px); }

  /* ---------- pause screen ---------- */
  .pausecard {
    position: absolute; inset: 0; z-index: 1; pointer-events: none;
    display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 0 clamp(24px, 5vw, 72px) 150px;
    background:
      linear-gradient(90deg, rgb(0 0 0 / 0.82) 0%, rgb(0 0 0 / 0.55) 38%, rgb(0 0 0 / 0.1) 70%, transparent),
      linear-gradient(0deg, rgb(0 0 0 / 0.6), transparent 45%);
    animation: pc-in 420ms ease both;
  }
  @keyframes pc-in { from { opacity: 0; } }
  .pc-body { max-width: min(620px, 52vw); display: flex; flex-direction: column; gap: 12px; animation: pc-rise 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  @keyframes pc-rise { from { opacity: 0; transform: translateY(14px); } }
  :global(:root[data-motion='reduce']) .pc-body { animation: none; }
  .pc-eyebrow { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; color: rgb(255 255 255 / 0.7); }
  .pc-pill {
    display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px;
    background: var(--player-accent); color: var(--on-accent); font: 800 10.5px var(--font); letter-spacing: 0.08em; text-transform: uppercase;
  }
  .pc-logo { max-width: min(420px, 40vw); max-height: 130px; object-fit: contain; object-position: left bottom; align-self: flex-start; filter: drop-shadow(0 4px 24px rgb(0 0 0 / 0.6)); }
  .pc-title { margin: 0; font: 800 clamp(34px, 4.4vw, 58px) / 1.02 var(--font-display); letter-spacing: -0.02em; text-shadow: 0 4px 30px rgb(0 0 0 / 0.6); }
  .pc-ep { display: flex; flex-direction: column; gap: 2px; }
  .pc-ep span { font-size: 13px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--player-accent); }
  .pc-ep b { font: 700 clamp(20px, 2vw, 26px) var(--font-display); letter-spacing: -0.01em; }
  .pc-facts { display: flex; flex-wrap: wrap; align-items: center; row-gap: 6px; font-size: 13.5px; color: rgb(255 255 255 / 0.75); }
  .pc-facts span + span::before { content: '•'; margin: 0 9px; color: rgb(255 255 255 / 0.35); }
  .pc-rate { display: inline-flex; align-items: center; gap: 5px; margin-right: 14px; font-weight: 700; color: #f5c518; }
  .pc-rate + span::before { content: none !important; }
  .pc-about { margin: 0; font-size: 14.5px; line-height: 1.55; color: rgb(255 255 255 / 0.82); display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .pc-time { display: flex; align-items: center; gap: 12px; margin-top: 4px; font-size: 13px; color: rgb(255 255 255 / 0.7); }
  .pc-time b { color: #fff; font-weight: 600; }
  .pc-bar { width: 140px; height: 4px; border-radius: 2px; background: rgb(255 255 255 / 0.2); overflow: hidden; }
  .pc-bar i { display: block; height: 100%; background: var(--player-accent); }
  .pc-next {
    pointer-events: auto; flex-shrink: 0; display: flex; align-items: center; gap: 12px; width: 330px; padding: 8px; border-radius: 14px;
    border: 1px solid rgb(255 255 255 / 0.12); background: rgb(20 21 27 / 0.6); color: #fff; text-align: left; cursor: pointer;
    backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); animation: pc-rise 620ms 80ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    transition: background var(--dur), border-color var(--dur), transform var(--dur);
  }
  .pc-next:hover { background: rgb(30 31 38 / 0.8); border-color: rgb(255 255 255 / 0.25); transform: translateY(-2px); }
  .pc-nthumb { position: relative; flex-shrink: 0; width: 120px; aspect-ratio: 16 / 9; border-radius: 8px; display: grid; place-items: center; background: rgb(255 255 255 / 0.08) center / cover; }
  .pc-nthumb :global(svg) { filter: drop-shadow(0 1px 6px rgb(0 0 0 / 0.8)); opacity: 0.9; }
  .pc-ntxt { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pc-ntxt em { font-style: normal; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--player-accent); }
  .pc-ntxt b { font-size: 14px; }
  .pc-ntxt small { font-size: 12.5px; color: rgb(255 255 255 / 0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 900px) { .pc-next { display: none; } .pc-body { max-width: 80vw; } }

  /* Next-episode button preview */
  .nextwrap { position: relative; }
  .nexttip {
    position: absolute; left: 50%; bottom: 54px; z-index: 4; width: 300px; display: flex; flex-direction: column; overflow: hidden;
    border-radius: 14px; background: rgb(16 17 22 / 0.9); border: 1px solid rgb(255 255 255 / 0.1); box-shadow: 0 20px 50px rgb(0 0 0 / 0.5);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    opacity: 0; transform: translate(-50%, 6px); pointer-events: none; transition: opacity var(--dur), transform var(--dur);
  }
  .nextwrap:hover .nexttip { opacity: 1; transform: translate(-50%, 0); transition-delay: 150ms; }
  .nt-thumb { aspect-ratio: 16 / 9; background: rgb(255 255 255 / 0.06) center / cover; }
  .nt-txt { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px 12px; }
  .nt-txt em { font-style: normal; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgb(255 255 255 / 0.55); }
  .nt-txt b { font-size: 14px; }
  .nt-txt small { font-size: 12px; line-height: 1.4; color: rgb(255 255 255 / 0.65); display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .eps-btn { display: flex !important; align-items: center; width: auto !important; padding: 0 12px 0 10px !important; gap: 7px; border-radius: 999px !important; font: 600 13px var(--font); }
  .eps-btn span { white-space: nowrap; }
  @media (max-width: 820px) { .eps-btn span { display: none; } .eps-btn { padding: 0 !important; width: 40px !important; } }
  .wc { align-self: flex-start; height: 32px; margin-top: -10px; --text: #fff; --text-2: rgb(255 255 255 / 0.8); }
  .top > .ctl:last-of-type { margin-right: 12px; }

  .bottom { bottom: 0; padding: 40px 20px 14px; background: linear-gradient(transparent, rgb(0 0 0 / 0.8)); }

  .bar { position: relative; height: 22px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
  .track { position: relative; width: 100%; height: 4px; border-radius: 2px; background: rgb(255 255 255 / 0.22); overflow: hidden; transition: height 120ms; }
  .bar:hover .track { height: 6px; }
  :global(:root[data-seekbar='thick']) .track { height: 7px; border-radius: 4px; }
  :global(:root[data-seekbar='thick']) .bar:hover .track { height: 10px; }
  :global(:root[data-seekbar='thick']) .knob { width: 18px; height: 18px; margin: -9px 0 0 -9px; }
  :global(:root[data-pctl='large']) .controls .ctl { width: 48px; height: 48px; }
  :global(:root[data-pctl='large']) .controls .ctl.big { width: 56px; height: 56px; }
  :global(:root[data-pctl='large']) .controls :global(svg) { transform: scale(1.15); }
  .buf { position: absolute; inset: 0 auto 0 0; background: rgb(255 255 255 / 0.35); }
  .fill { position: absolute; inset: 0 auto 0 0; background: var(--player-accent); }
  .knob {
    position: absolute; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
    background: var(--player-accent); box-shadow: 0 0 0 3px rgb(0 0 0 / 0.25); transform: scale(0); transition: transform 120ms;
  }
  .bar:hover .knob { transform: scale(1); }
  .tip {
    position: absolute; bottom: 24px; transform: translateX(-50%); padding: 3px 7px; border-radius: 6px;
    background: rgb(0 0 0 / 0.85); font-size: 12px; font-variant-numeric: tabular-nums; pointer-events: none;
    display: flex; flex-direction: column; align-items: center; white-space: nowrap;
  }
  .tchap { font-weight: 700; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
  .tip.withthumb { padding: 4px 4px 6px; border-radius: 12px; gap: 4px; background: rgb(10 11 15 / 0.92); box-shadow: 0 12px 34px rgb(0 0 0 / 0.5); border: 1px solid rgb(255 255 255 / 0.1); }
  .tip.withthumb .tchap { max-width: 180px; padding: 0 4px; }
  .tthumb { position: relative; display: block; width: 184px; aspect-ratio: 16 / 9; border-radius: 9px; overflow: hidden; background: rgb(255 255 255 / 0.06); }
  .tthumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* A thin shimmer while the exact frame loads. */
  .tthumb i { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; opacity: 0; background: linear-gradient(90deg, transparent, var(--player-accent), transparent); background-size: 50% 100%; background-repeat: no-repeat; }
  .tthumb.loading i { opacity: 1; animation: tshimmer 0.9s linear infinite; }
  @keyframes tshimmer { from { background-position: -50% 0; } to { background-position: 150% 0; } }
  .ttime { font-weight: 600; }
  .chap { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: rgb(0 0 0 / 0.55); }
  .stats {
    position: absolute; left: 16px; top: 76px; z-index: 3; width: min(420px, calc(100% - 32px)); padding: 10px 14px 12px;
    background: rgb(10 10 14 / 0.86); border: 1px solid rgb(255 255 255 / 0.1); border-radius: 12px; backdrop-filter: blur(12px);
    font-size: 12.5px; color: #fff;
  }
  .sh { display: flex; align-items: center; justify-content: space-between; font-weight: 800; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: rgb(255 255 255 / 0.6); margin-bottom: 6px; }
  .stats dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0; }
  .stats dt { color: rgb(255 255 255 / 0.55); }
  .stats dd { margin: 0; font-variant-numeric: tabular-nums; word-break: break-word; }
  .peers { font-size: 12.5px; color: rgb(255 255 255 / 0.75); margin-top: 4px; }

  .controls { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
  .spacer { flex: 1; }
  .ctl {
    position: relative; display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 10px;
    background: transparent; color: rgb(255 255 255 / 0.92); cursor: pointer; transition: background 120ms, color 120ms;
  }
  .ctl:hover { background: rgb(255 255 255 / 0.14); color: #fff; }
  .ctl.on { color: var(--player-accent); }
  .ctl:disabled { opacity: 0.35; cursor: default; background: none; }
  .ctl.big { width: 46px; height: 46px; }
  .badge { position: absolute; bottom: 2px; right: 0; font-size: 9.5px; padding: 0 3px; border-radius: 4px; background: var(--player-accent); color: var(--on-accent); }
  .time { border: 0; background: none; color: #fff; cursor: pointer; padding: 6px 8px; border-radius: 8px; font-family: inherit; }
  .time:hover { background: rgb(255 255 255 / 0.1); }
  .volpill {
    position: absolute; top: 70px; left: 50%; transform: translateX(-50%); z-index: 4; display: flex; align-items: center; gap: 10px;
    padding: 8px 14px; border-radius: 999px; background: rgb(12 12 16 / 0.8); font-size: 13px; font-variant-numeric: tabular-nums; pointer-events: none;
  }
  .vbar { width: 120px; height: 4px; border-radius: 2px; background: rgb(255 255 255 / 0.25); overflow: hidden; }
  .vbar i { display: block; height: 100%; background: var(--player-accent); }
  .volpill b { min-width: 44px; text-align: right; }
  .help {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 6; width: min(460px, calc(100% - 40px));
    padding: 16px 18px; border-radius: 16px; background: rgb(14 14 18 / 0.94); border: 1px solid rgb(255 255 255 / 0.12); box-shadow: 0 24px 60px rgb(0 0 0 / 0.6);
  }
  .hh { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 15px; margin-bottom: 10px; }
  .help dl { display: grid; grid-template-columns: auto 1fr; gap: 7px 18px; margin: 0; font-size: 13px; }
  .help dt { font-weight: 700; color: #fff; white-space: nowrap; }
  .help dd { margin: 0; color: rgb(255 255 255 / 0.72); }
  .time { margin-left: 8px; font-size: 13.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .time span { color: rgb(255 255 255 / 0.6); font-weight: 500; }

  .vol { display: flex; align-items: center; }
  .vol input {
    width: 0; opacity: 0; transition: width 180ms ease, opacity 180ms ease; height: 4px; appearance: none; border-radius: 2px; cursor: pointer;
    background: linear-gradient(90deg, #fff var(--v), rgb(255 255 255 / 0.25) var(--v));
  }
  .vol:hover input, .vol input:focus-visible { width: 96px; opacity: 1; margin-right: 6px; }
  .vol input::-webkit-slider-thumb { appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #fff; }


  /* ---------- player menus ---------- */
  .menu-wrap { position: relative; }
  .pmenu {
    --pm-bg: rgb(16 17 22 / 0.78);
    position: absolute; bottom: 64px; right: -8px; z-index: 4; width: 300px; max-height: min(560px, calc(100vh - 170px));
    display: flex; flex-direction: column; padding: 8px; border-radius: 16px;
    background: var(--pm-bg); border: 1px solid rgb(255 255 255 / 0.09);
    box-shadow: 0 24px 60px rgb(0 0 0 / 0.55), inset 0 1px 0 rgb(255 255 255 / 0.05);
    backdrop-filter: blur(24px) saturate(1.4); -webkit-backdrop-filter: blur(24px) saturate(1.4);
    transform-origin: bottom right; animation: pm-in calc(var(--dur) + 60ms) cubic-bezier(0.2, 0.9, 0.3, 1.2);
    font-size: 13.5px;
  }
  :global(:root[data-pmenu='solid']) .pmenu { --pm-bg: rgb(20 21 27); backdrop-filter: none; -webkit-backdrop-filter: none; }
  @keyframes pm-in { from { opacity: 0; transform: translateY(6px) scale(0.97); } }
  .pmenu.tracks { width: 320px; }
  .pmenu.tracks.two { width: min(620px, calc(100vw - 40px)); }
  .pmenu.speed { width: 290px; }
  .pmenu.more { width: 290px; }

  .phead {
    display: flex; align-items: center; gap: 8px; padding: 4px 8px 6px; min-height: 38px;
    font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgb(255 255 255 / 0.55);
  }
  .phead :global(svg) { flex-shrink: 0; opacity: 0.8; }
  .phead span:not(.key) { flex: 1; }
  .phead .val { text-transform: none; letter-spacing: 0; font-size: 13px; color: #fff; }
  .key {
    margin-left: auto; padding: 1px 6px; border-radius: 5px; background: rgb(255 255 255 / 0.1);
    font: 600 11px var(--font); letter-spacing: 0; text-transform: none; color: rgb(255 255 255 / 0.6); white-space: nowrap;
  }

  .cols { display: flex; min-height: 0; flex: 1; }
  .col { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
  .two .col + .col { border-left: 1px solid rgb(255 255 255 / 0.08); padding-left: 6px; margin-left: 6px; }
  .opts { overflow-y: auto; min-height: 0; flex: 1; padding-right: 2px; scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / 0.2) transparent; }
  .opts::-webkit-scrollbar { width: 6px; }
  .opts::-webkit-scrollbar-thumb { background: rgb(255 255 255 / 0.18); border: 0; border-radius: 6px; }

  .opt {
    display: flex; align-items: center; gap: 8px; width: 100%; min-height: 42px; padding: 7px 10px; border: 0; border-radius: 10px;
    background: none; color: #fff; text-align: left; cursor: pointer; font: inherit;
    transition: background var(--dur);
  }
  .opt:hover { background: rgb(255 255 255 / 0.08); }
  .opt:focus-visible { outline: 2px solid var(--player-accent); outline-offset: -2px; }
  .opt.sel { background: color-mix(in srgb, var(--player-accent) 18%, transparent); }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .txt b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .txt small { font-size: 11.5px; color: rgb(255 255 255 / 0.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tag {
    flex-shrink: 0; padding: 1px 6px; border-radius: 5px; border: 1px solid rgb(255 255 255 / 0.22);
    font: 700 10px var(--font); font-style: normal; letter-spacing: 0.04em; text-transform: uppercase; color: rgb(255 255 255 / 0.75);
  }
  .tick { display: flex; width: 16px; flex-shrink: 0; color: var(--player-accent); opacity: 0; transform: scale(0.6); transition: opacity var(--dur), transform var(--dur); }
  .opt.sel .tick { opacity: 1; transform: none; }
  .divider {
    margin: 8px 10px 4px; padding-top: 8px; border-top: 1px solid rgb(255 255 255 / 0.08);
    font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgb(255 255 255 / 0.4);
  }
  .none { padding: 10px 10px 12px; font-size: 12.5px; line-height: 1.45; color: rgb(255 255 255 / 0.6); }
  .find {
    flex: 1; min-width: 0; max-width: 150px; margin-left: auto; padding: 5px 9px; border-radius: 8px;
    border: 1px solid rgb(255 255 255 / 0.12); background: rgb(255 255 255 / 0.06); color: #fff;
    font: 500 12px var(--font); text-transform: none; letter-spacing: 0; outline: none;
  }
  .find:focus { border-color: var(--player-accent); }
  .find::placeholder { color: rgb(255 255 255 / 0.4); }

  .pfoot {
    display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; padding: 10px 8px 2px;
    border-top: 1px solid rgb(255 255 255 / 0.08);
  }
  .step { display: flex; align-items: center; gap: 4px; font-size: 12.5px; }
  .step > span { color: rgb(255 255 255 / 0.55); margin-right: 4px; }
  .step button {
    min-width: 28px; height: 28px; padding: 0 8px; border: 0; border-radius: 8px; cursor: pointer;
    background: rgb(255 255 255 / 0.09); color: #fff; font: 700 14px var(--font); transition: background var(--dur);
  }
  .step button:hover:not(:disabled) { background: rgb(255 255 255 / 0.18); }
  .step button:disabled { opacity: 0.35; cursor: default; }
  .step .reset { font-size: 12px; font-weight: 600; }
  .step b { min-width: 46px; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; }
  .step b.off { color: var(--player-accent); }
  .step.wide { padding: 0 8px 6px; }
  .step.wide .reset { margin-left: auto; }
  .style-link { margin-left: auto; font-size: 12.5px; font-weight: 600; color: var(--player-accent); text-decoration: none; }
  .style-link:hover { text-decoration: underline; }

  .chips { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; padding: 0 6px 8px; }
  .chips.three { grid-template-columns: repeat(3, 1fr); }
  .chips button {
    height: 34px; border: 0; border-radius: 9px; cursor: pointer; background: rgb(255 255 255 / 0.08); color: #fff;
    font: 600 12.5px var(--font); font-variant-numeric: tabular-nums; transition: background var(--dur), color var(--dur);
  }
  .chips button:hover { background: rgb(255 255 255 / 0.16); }
  .chips button.sel { background: var(--player-accent); color: var(--on-accent); }
  .fine { display: block; padding: 4px 10px 8px; }
  .fine input {
    width: 100%; height: 4px; appearance: none; border-radius: 2px; cursor: pointer;
    background: linear-gradient(90deg, var(--player-accent) var(--v), rgb(255 255 255 / 0.2) var(--v));
  }
  .fine input::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 0.5); }

  .sep { height: 1px; margin: 4px 6px; background: rgb(255 255 255 / 0.08); }
  .row {
    display: flex; align-items: center; gap: 11px; width: 100%; height: 40px; padding: 0 10px; border: 0; border-radius: 10px;
    background: none; color: #fff; cursor: pointer; font: inherit; text-align: left; transition: background var(--dur);
  }
  .row:hover { background: rgb(255 255 255 / 0.08); }
  .row :global(svg) { opacity: 0.8; flex-shrink: 0; }
  .row span:not(.key) { flex: 1; }
  .row.sel { color: var(--player-accent); }
  .row:disabled { opacity: 0.5; cursor: default; }

  .skipn { position: relative; }
  .skipn span { position: absolute; inset: 0; display: grid; place-items: center; padding-top: 1px; font: 800 8.5px var(--font); pointer-events: none; }
  .ends { margin-left: 10px; font-size: 12.5px; color: rgb(255 255 255 / 0.55); white-space: nowrap; }
  @media (max-width: 760px) { .ends { display: none; } }

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
  .ringcd .fg { fill: none; stroke: var(--player-accent); stroke-dasharray: 97.4; transition: stroke-dashoffset 1s linear; }
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
  .mini-next { position: absolute; right: 8px; bottom: 12px; border: 0; border-radius: 7px; padding: 5px 10px; background: var(--player-accent); color: var(--on-accent); font: 700 12px var(--font); cursor: pointer; opacity: 1; }
  .mini-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgb(255 255 255 / 0.2); }
  .mini-bar div { height: 100%; background: var(--player-accent); }
  .ring.sm { width: 30px; height: 30px; }
  .none { padding: 6px 10px 8px; font-size: 12.5px; color: rgb(255 255 255 / 0.6); line-height: 1.45; }

  .center {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column;
    align-items: center; gap: 10px; pointer-events: none; font-size: 13px; font-weight: 600; text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
  }
  .ring { width: 44px; height: 44px; border-radius: 50%; border: 3px solid rgb(255 255 255 / 0.2); border-top-color: var(--player-accent); animation: spin 0.8s linear infinite; }
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
