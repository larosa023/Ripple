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
