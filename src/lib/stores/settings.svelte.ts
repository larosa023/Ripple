import type { Quality, StreamSort } from '../stremio/streams';
import { load, save } from './persist';

export type PlayerKind = 'mpv' | 'vlc' | 'custom';
export type StartPage = 'home' | 'discover' | 'library';

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
  autoPlayBest: boolean;
  subtitleLangs: string;
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
  // Subtitle look
  subFont: string;
  subScale: number;
  subColor: string;
  subStyle: 'outline' | 'shadow' | 'box';
  /** Vertical position, 100 = bottom edge (mpv sub-pos). */
  subPos: number;
  subBold: boolean;
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
  autoPlayBest: false,
  subtitleLangs: 'eng',
  autoplayNext: true,
  nextCountdown: 10,
  skipIntro: 'button',
  rememberPerShow: true,
  miniPlayer: true,
  showRemaining: false,
  subFont: '',
  subScale: 1,
  subColor: '#ffffff',
  subStyle: 'outline',
  subPos: 100,
  subBold: false,
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

/** Splits user-entered player arguments, respecting double quotes. */
export function parseArgs(input: string): string[] {
  return (input.match(/"[^"]*"|\S+/g) ?? []).map((a) => a.replace(/^"|"$/g, ''));
}
