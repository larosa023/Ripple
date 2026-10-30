import type { Quality, StreamSort } from '../stremio/streams';
import { load, save } from './persist';

export type Theme = 'dark' | 'oled' | 'light';
export type PosterSize = 'small' | 'medium' | 'large';
export type PlayerKind = 'mpv' | 'vlc' | 'custom';
export type StartPage = 'home' | 'discover' | 'library';

export interface HomeRow {
  /** `${addonId}|${type}|${catalogId}` */
  key: string;
  enabled: boolean;
}

export interface Settings {
  // Appearance
  theme: Theme;
  accent: string;
  posterSize: PosterSize;
  showRatings: boolean;
  showTitles: boolean;
  reduceMotion: boolean;
  compactSidebar: boolean;
  startPage: StartPage;
  // Home
  homeRows: HomeRow[];
  rowItemLimit: number;
  showContinueWatching: boolean;
  hideAdultAddons: boolean;
  // Playback
  player: PlayerKind;
  playerPath: string;
  playerArgs: string;
  streamingServer: string;
  autoPlayBest: boolean;
  subtitleLangs: string;
  // Streams
  streamSort: StreamSort;
  hideCam: boolean;
  onlyDirect: boolean;
  qualities: Quality[];
  excludeKeywords: string;
  // Network & updates
  requestTimeoutSec: number;
  checkUpdates: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#5b8cff',
  posterSize: 'medium',
  showRatings: true,
  showTitles: true,
  reduceMotion: false,
  compactSidebar: false,
  startPage: 'home',
  homeRows: [],
  rowItemLimit: 20,
  showContinueWatching: true,
  hideAdultAddons: true,
  player: 'mpv',
  playerPath: '',
  playerArgs: '',
  streamingServer: 'http://127.0.0.1:11470',
  autoPlayBest: false,
  subtitleLangs: 'eng',
  streamSort: 'quality',
  hideCam: true,
  onlyDirect: false,
  qualities: [],
  excludeKeywords: '',
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
