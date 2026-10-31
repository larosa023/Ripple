// Everything visual lives in one "look" object, so a whole theme can be
// saved, shared as a .ripplestyle file, and applied in one step.

import { load, save } from '../stores/persist';
import { FONTS, fontById, PRESETS, presetById, type Palette } from './presets';

export type NavLayout = 'sidebar' | 'rail' | 'icons' | 'top' | 'dock';
export type CardStyle = 'plain' | 'outlined' | 'elevated' | 'glass' | 'overlay';
export type HoverEffect = 'lift' | 'zoom' | 'glow' | 'none';
export type ButtonStyle = 'rounded' | 'pill' | 'square';
export type Density = 'compact' | 'cozy' | 'comfy';
export type PosterSize = 'small' | 'medium' | 'large' | 'xl';
export type HeroStyle = 'full' | 'compact' | 'off';
export type DetailLayout = 'cinematic' | 'classic';
export type BgAnimation = 'none' | 'aurora' | 'bokeh';

export interface NavItem {
  id: 'home' | 'discover' | 'search' | 'library' | 'calendar' | 'addons';
  visible: boolean;
}

export interface Look {
  preset: string;
  colors: Palette;
  font: string;
  customFont: { name: string; dataUrl: string } | null;
  uiScale: number;
  radius: number;
  density: Density;
  buttonStyle: ButtonStyle;
  // Navigation
  nav: NavLayout;
  navItems: NavItem[];
  /** Dock background opacity, 0.5..1 */
  dockOpacity: number;
  // Cards
  cardStyle: CardStyle;
  hover: HoverEffect;
  posterSize: PosterSize;
  showTitles: boolean;
  showRatings: boolean;
  // Home
  hero: HeroStyle;
  heroSource: string; // row key, or '' for the first home row
  heroInterval: number; // seconds, 0 = no auto-rotate
  cwStyle: 'wide' | 'poster';
  // Detail
  detailLayout: DetailLayout;
  backdropStrength: number; // 0..1
  episodeLayout: 'list' | 'grid';
  showCast: boolean;
  // Background
  bgImage: string;
  bgDim: number; // 0..1
  bgBlur: number; // px
  bgAnimation: BgAnimation;
  // Motion & code
  reduceMotion: boolean;
  customCss: string;
}

const NAV_DEFAULT: NavItem[] = [
  { id: 'home', visible: true },
  { id: 'discover', visible: true },
  { id: 'search', visible: true },
  { id: 'library', visible: true },
  { id: 'calendar', visible: true },
  { id: 'addons', visible: true },
];

export const DEFAULT_LOOK: Look = {
  preset: 'ripple',
  colors: { ...PRESETS[0].colors },
  font: 'system',
  customFont: null,
  uiScale: 1,
  radius: 10,
  density: 'cozy',
  buttonStyle: 'rounded',
  nav: 'rail',
  navItems: NAV_DEFAULT,
  dockOpacity: 0.88,
  cardStyle: 'plain',
  hover: 'lift',
  posterSize: 'medium',
  showTitles: true,
  showRatings: true,
  hero: 'full',
  heroSource: '',
  heroInterval: 8,
  cwStyle: 'wide',
  detailLayout: 'cinematic',
  backdropStrength: 0.55,
  episodeLayout: 'list',
  showCast: true,
  bgImage: '',
  bgDim: 0.7,
  bgBlur: 0,
  bgAnimation: 'none',
  reduceMotion: false,
  customCss: '',
};

/** Carries over appearance choices from v0.1 settings on first launch of v0.2. */
function migrate(): Look {
  const look = structuredClone(DEFAULT_LOOK);
  try {
    const old = JSON.parse(localStorage.getItem('ripple:settings') ?? 'null');
    if (!old) return look;
    if (old.theme === 'oled') Object.assign(look, { preset: 'midnight', colors: { ...presetById('midnight')!.colors } });
    if (old.theme === 'light') Object.assign(look, { preset: 'paper', colors: { ...presetById('paper')!.colors } });
    if (old.accent) look.colors.accent = old.accent;
    if (old.posterSize) look.posterSize = old.posterSize;
    if (old.compactSidebar) look.nav = 'icons';
    for (const k of ['showTitles', 'showRatings', 'reduceMotion'] as const) if (typeof old[k] === 'boolean') look[k] = old[k];
  } catch {
    /* fresh defaults */
  }
  return look;
}

export function normalizeLook(input: Partial<Look>): Look {
  const base = structuredClone(DEFAULT_LOOK);
  const merged = { ...base, ...input, colors: { ...base.colors, ...(input.colors ?? {}) } } as Look;
  // Keep nav items valid even if a theme file lists unknown or missing ones.
  const known = new Map(NAV_DEFAULT.map((n) => [n.id, n]));
  const items = (input.navItems ?? []).filter((n) => known.has(n.id));
  // New nav items (from an update) slot in after the item they follow by default.
  NAV_DEFAULT.forEach((n, idx) => {
    if (items.some((i) => i.id === n.id)) return;
    const prev = NAV_DEFAULT[idx - 1];
    const at = prev ? items.findIndex((i) => i.id === prev.id) + 1 : 0;
    items.splice(at > 0 ? at : items.length, 0, { ...n });
  });
  merged.navItems = items;
  return merged;
}

const stored = localStorage.getItem('ripple:look');
export const look: Look = $state(stored ? normalizeLook(load<Partial<Look>>('look', {})) : migrate());

$effect.root(() => {
  $effect(() => {
    save('look', $state.snapshot(look));
  });
});

/**
 * Runs a theme change inside a View Transition so the whole app crossfades
 * between themes in one GPU-composited step (no per-element color transitions).
 */
function smoothly(change: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || look.reduceMotion) return change();
  doc.startViewTransition(() => {
    change();
    applyLook($state.snapshot(look) as Look);
  });
}

export function applyPreset(id: string) {
  const p = presetById(id);
  if (!p) return;
  smoothly(() => {
    look.preset = id;
    look.colors = { ...p.colors };
  });
}

export function resetLook() {
  smoothly(() => Object.assign(look, structuredClone(DEFAULT_LOOK)));
}

// ---------- applying the look to the page ----------

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const POSTER_W: Record<PosterSize, string> = { small: '118px', medium: '150px', large: '186px', xl: '224px' };
const DENSITY: Record<Density, { gap: string; pad: string; row: string }> = {
  compact: { gap: '10px', pad: '20px', row: '20px' },
  cozy: { gap: '14px', pad: '32px', row: '30px' },
  comfy: { gap: '20px', pad: '44px', row: '42px' },
};
const BTN_RADIUS: Record<ButtonStyle, string> = { rounded: '8px', pill: '999px', square: '3px' };

const loadedFonts = new Set<string>();
function ensureGoogleFonts(families: string[] | undefined) {
  if (!families?.length) return;
  const key = families.join('|');
  if (loadedFonts.has(key)) return;
  loadedFonts.add(key);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${families.map((f) => 'family=' + f).join('&')}&display=swap`;
  document.head.appendChild(link);
}

let previewsLoaded = false;
/** Loads just the glyphs needed to preview each font's name (a few KB total). */
export function loadFontPreviews() {
  if (previewsLoaded) return;
  previewsLoaded = true;
  const families = FONTS.flatMap((f) => f.google ?? []).map((f) => f.split(':')[0]);
  const text = encodeURIComponent([...new Set(FONTS.map((f) => f.name).join('') + 'Aa')].join(''));
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${[...new Set(families)].map((f) => 'family=' + f).join('&')}&text=${text}&display=swap`;
  document.head.appendChild(link);
}

let customFontKey = '';
async function ensureCustomFont(font: Look['customFont']) {
  if (!font) return;
  const key = font.name + font.dataUrl.length;
  if (key === customFontKey) return;
  customFontKey = key;
  try {
    const face = new FontFace('RippleCustom', `url(${font.dataUrl})`);
    await face.load();
    document.fonts.add(face);
  } catch {
    /* unreadable font file: keep the fallback */
  }
}

let cssEl: HTMLStyleElement | null = null;

/** Writes the look to CSS variables and data attributes on <html>. */
export function applyLook(l: Look) {
  const root = document.documentElement;
  const s = root.style;
  const c = l.colors;
  s.setProperty('--bg', c.bg);
  s.setProperty('--bg-2', c.surface);
  s.setProperty('--bg-3', c.surface2);
  s.setProperty('--line', c.line);
  s.setProperty('--text', c.text);
  s.setProperty('--text-2', c.text2);
  s.setProperty('--text-3', `color-mix(in srgb, ${c.text2} 65%, ${c.bg})`);
  s.setProperty('--accent', c.accent);
  // Text on accent-colored surfaces: whichever of white or near-black reads better.
  const la = luminance(c.accent);
  const onWhite = 1.05 / (la + 0.05);
  const onDark = (la + 0.05) / (luminance('#111318') + 0.05);
  s.setProperty('--on-accent', onDark > onWhite ? '#111318' : '#ffffff');
  s.setProperty('--accent-soft', `color-mix(in srgb, ${c.accent} 16%, transparent)`);
  const light = luminance(c.bg) > 0.4;
  root.style.colorScheme = light ? 'light' : 'dark';
  root.dataset.light = light ? '1' : '';

  const f = fontById(l.font);
  ensureGoogleFonts(f.google);
  if (l.customFont) {
    void ensureCustomFont(l.customFont);
    s.setProperty('--font', `'RippleCustom', ${f.body}`);
    s.setProperty('--font-display', `'RippleCustom', ${f.body}`);
  } else {
    s.setProperty('--font', f.body);
    s.setProperty('--font-display', f.display ?? f.body);
  }

  s.setProperty('--radius', `${l.radius}px`);
  s.setProperty('--btn-radius', BTN_RADIUS[l.buttonStyle]);
  s.setProperty('--poster-w', POSTER_W[l.posterSize]);
  const d = DENSITY[l.density];
  s.setProperty('--gap', d.gap);
  s.setProperty('--page-pad', d.pad);
  s.setProperty('--row-gap', d.row);

  root.dataset.nav = l.nav;
  root.dataset.card = l.cardStyle;
  root.dataset.hover = l.hover;
  root.dataset.motion = l.reduceMotion ? 'reduce' : '';
  document.body.style.zoom = String(l.uiScale);

  if (!cssEl) {
    cssEl = document.createElement('style');
    cssEl.id = 'ripple-custom-css';
    document.head.appendChild(cssEl);
  }
  cssEl.textContent = l.customCss;
}

// ---------- theme library & files ----------

export interface SavedTheme {
  id: string;
  name: string;
  look: Look;
  imported?: boolean;
}

export const themes: { list: SavedTheme[] } = $state({ list: load('themes', [] as SavedTheme[]) });

$effect.root(() => {
  $effect(() => {
    save('themes', $state.snapshot(themes.list));
  });
});

export function saveCurrentTheme(name: string): SavedTheme {
  const t: SavedTheme = { id: crypto.randomUUID(), name: name.trim() || 'My theme', look: $state.snapshot(look) as Look };
  themes.list.unshift(t);
  return t;
}

export function applyTheme(t: SavedTheme) {
  smoothly(() => Object.assign(look, normalizeLook(structuredClone(t.look))));
}

export function deleteTheme(id: string) {
  themes.list = themes.list.filter((t) => t.id !== id);
}

export function themeFile(t: { name: string; look: Look }): string {
  return JSON.stringify({ app: 'ripple', kind: 'theme', version: 1, name: t.name, look: t.look }, null, 2);
}

export function parseThemeFile(text: string): SavedTheme {
  const data = JSON.parse(text);
  if (data?.app !== 'ripple' || data.kind !== 'theme' || typeof data.look !== 'object') {
    throw new Error('Not a Ripple theme file.');
  }
  return {
    id: crypto.randomUUID(),
    name: String(data.name || 'Imported theme').slice(0, 60),
    look: normalizeLook(data.look),
    imported: true,
  };
}
