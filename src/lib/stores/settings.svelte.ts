import type { Quality, StreamSort } from '../stremio/streams';
import { load, save } from './persist';

export type PlayerKind = 'mpv' | 'vlc' | 'custom';
export type StartPage = 'home' | 'discover' | 'library' | 'live';

export type RowDisplay = 'poster' | 'wide' | 'top10';

export interface HomeRow {
  /** `${addonId}|${type}|${catalogId}` */
  key: string;
  enabled: boolean;
  /** Custom row title; empty uses the catalog name. */
  title?: string;
  display?: RowDisplay;
}

export interface Settings {
  startPage: StartPage;
  /** Use the standard Windows title bar instead of Ripple's themed one. */
  nativeTitleBar: boolean;
  // Home
  homeRows: HomeRow[];
  rowItemLimit: number;
  showContinueWatching: boolean;
  hideAdultAddons: boolean;
  // Playback
  /** Play inside Ripple (embedded mpv) or hand off to an external player. */
  playIn: 'ripple' | 'external';
  volume: number;
  /** Pick up where you left off. */
  resume: boolean;
  player: PlayerKind;
  playerPath: string;
  playerArgs: string;
  streamingServer: string;
  /** P2P streams: Ripple's own engine, or a Stremio streaming server. */
  torrentEngine: 'builtin' | 'server';
  /** Picture sizing in the player. */
  videoAspect: 'fit' | 'fill' | 'stretch';
  /** Windows notification when a followed show has a new episode. */
  notifyEpisodes: boolean;
  autoPlayBest: boolean;
  subtitleLangs: string;
  /** Ask Caption (local AI subtitles) for subtitles made from the video's own audio. */
  captionSubs: boolean;
  /** Turn Caption's subtitles on automatically when no other subtitles are selected. */
  captionAutoOn: boolean;
  // Watching
  /** Show a "Next episode" card near the end, and count down to play it. */
  autoplayNext: boolean;
  /** Seconds the next-episode card counts down; 0 waits for a click. */
  nextCountdown: number;
  skipIntro: 'button' | 'auto' | 'off';
  /** Remember audio, subtitles and source per show. */
  rememberPerShow: boolean;
  /** Offer a corner mini player while you browse. */
  miniPlayer: boolean;
  /** Player clock shows time remaining instead of total length. */
  showRemaining: boolean;
  /** Seconds the skip buttons and J / L jump. */
  seekStep: number;
  /** Seconds the arrow keys jump (Shift jumps 3× as far). */
  arrowStep: number;
  /** Seconds without moving the mouse before the player controls hide. */
  hideDelay: number;
  /** What the scroll wheel does over the video. */
  wheelAction: 'volume' | 'seek' | 'off';
  /** What double-clicking the video does. */
  dblClick: 'fullscreen' | 'seek' | 'off';
  /** "Ends at 10:42 PM" next to the player clock. */
  showEndsAt: boolean;
  /** 12 or 24 hour times across the app. */
  clock: 'auto' | '12h' | '24h';
  // Subtitle look
  subFont: string;
  subScale: number;
  subColor: string;
  subStyle: 'outline' | 'shadow' | 'box';
  /** Vertical position, 100 = bottom edge (mpv sub-pos). */
  subPos: number;
  subBold: boolean;
  /** Background opacity for the Box style, 0..1. */
  subBack: number;
  /** Apply the style to styled (ASS) subtitles too; can break anime signs. */
  subOverride: boolean;
  // Streams
  streamSort: StreamSort;
  hideCam: boolean;
  onlyDirect: boolean;
  qualities: Quality[];
  excludeKeywords: string;
  // Integrations
  /** Optional TMDB API key (v3 key or v4 read token) for full cast with photos. */
  tmdbKey: string;
  /** Letterboxd username, for importing your diary. */
  letterboxdUser: string;
  /** Show "Watching …" on your Discord profile. */
  discord: boolean;
  discordAppId: string;
  // Network & updates
  requestTimeoutSec: number;
  checkUpdates: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  startPage: 'home',
  nativeTitleBar: false,
  homeRows: [],
  rowItemLimit: 20,
  showContinueWatching: true,
  hideAdultAddons: true,
  playIn: 'ripple',
  volume: 100,
  resume: true,
  player: 'mpv',
  playerPath: '',
  playerArgs: '',
  streamingServer: 'http://127.0.0.1:11470',
  torrentEngine: 'builtin',
  videoAspect: 'fit',
  notifyEpisodes: true,
  autoPlayBest: false,
  subtitleLangs: 'eng',
  captionSubs: true,
  captionAutoOn: true,
  autoplayNext: true,
  nextCountdown: 10,
  skipIntro: 'button',
  rememberPerShow: true,
  miniPlayer: true,
  showRemaining: false,
  seekStep: 10,
  arrowStep: 5,
  hideDelay: 2.5,
  wheelAction: 'volume',
  dblClick: 'fullscreen',
  showEndsAt: true,
  clock: 'auto',
  subFont: '',
  subScale: 1,
  subColor: '#ffffff',
  subStyle: 'outline',
  subPos: 100,
  subBold: false,
  subBack: 0.7,
  subOverride: false,
  streamSort: 'quality',
  hideCam: true,
  onlyDirect: false,
  qualities: [],
  excludeKeywords: '',
  tmdbKey: '',
  letterboxdUser: '',
  discord: false,
  discordAppId: '',
  requestTimeoutSec: 12,
  checkUpdates: true,
};

export const settings: Settings = $state(load('settings', DEFAULT_SETTINGS));

$effect.root(() => {
  $effect(() => {
    save('settings', $state.snapshot(settings));
  });
});

export function resetSettings() {
  Object.assign(settings, structuredClone(DEFAULT_SETTINGS));
}

const CLOCKS = new Map<string, Intl.DateTimeFormat>();
/** Formats a time of day the way you chose (12 / 24 hour), e.g. "9:41 PM" or "21:41". */
export function clockTime(t: number | Date): string {
  const key = settings.clock;
  let f = CLOCKS.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', ...(key === 'auto' ? {} : { hour12: key === '12h' }) });
    CLOCKS.set(key, f);
  }
  return f.format(t);
}

/** Splits user-entered player arguments, respecting double quotes. */
export function parseArgs(input: string): string[] {
  return (input.match(/"[^"]*"|\S+/g) ?? []).map((a) => a.replace(/^"|"$/g, ''));
}
