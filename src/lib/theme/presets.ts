export interface Palette {
  /** App background */
  bg: string;
  /** Panels, nav, inputs */
  surface: string;
  /** Raised elements, hovers, chips */
  surface2: string;
  /** Borders and dividers */
  line: string;
  text: string;
  /** Secondary text */
  text2: string;
  accent: string;
}

export interface Preset {
  id: string;
  name: string;
  light?: boolean;
  colors: Palette;
}

// Palettes are contrast-checked: body text >= 10:1, muted text >= 4.5:1 on raised
// surfaces, accent >= 3:1 against the background.
export const PRESETS: Preset[] = [
  { id: 'ripple', name: 'Ripple', colors: { bg: '#0b0d12', surface: '#13161d', surface2: '#1b1f28', line: '#272c37', text: '#eceff5', text2: '#9ba3b5', accent: '#5b8cff' } },
  { id: 'midnight', name: 'Midnight', colors: { bg: '#000000', surface: '#0b0b0d', surface2: '#151518', line: '#232328', text: '#efeff2', text2: '#9d9da8', accent: '#6e8bff' } },
  { id: 'graphite', name: 'Graphite', colors: { bg: '#111111', surface: '#191919', surface2: '#222222', line: '#2e2e2e', text: '#f0f0f0', text2: '#a3a3a3', accent: '#ececec' } },
  { id: 'violet', name: 'Violet', colors: { bg: '#0d0b14', surface: '#16131f', surface2: '#1f1b2b', line: '#2c2740', text: '#eeecf5', text2: '#a29dba', accent: '#8b6cff' } },
  { id: 'nord', name: 'Nord', colors: { bg: '#2e3440', surface: '#343b49', surface2: '#3b4252', line: '#4a5368', text: '#eceff4', text2: '#b6bfcf', accent: '#88c0d0' } },
  { id: 'dracula', name: 'Dracula', colors: { bg: '#1f1e29', surface: '#282734', surface2: '#312f40', line: '#403d55', text: '#f8f8f2', text2: '#b0aecb', accent: '#bd93f9' } },
  { id: 'forest', name: 'Forest', colors: { bg: '#0d1410', surface: '#141d17', surface2: '#1b271f', line: '#273629', text: '#e7efe9', text2: '#9fb6a6', accent: '#4fd087' } },
  { id: 'ember', name: 'Ember', colors: { bg: '#120f0e', surface: '#1a1615', surface2: '#231e1c', line: '#322a27', text: '#f3ede9', text2: '#b8aba3', accent: '#ff7a1a' } },
  { id: 'royal', name: 'Royal', colors: { bg: '#0d0a18', surface: '#151126', surface2: '#1d1834', line: '#2b2449', text: '#eeeaff', text2: '#a89fcc', accent: '#f2c14e' } },
  { id: 'velvet', name: 'Velvet', colors: { bg: '#150910', surface: '#200e18', surface2: '#2b1421', line: '#3d1d30', text: '#f8eaf0', text2: '#c79db0', accent: '#ff4d8d' } },
  { id: 'aurora', name: 'Aurora', colors: { bg: '#061218', surface: '#0b1c24', surface2: '#102833', line: '#1a3a47', text: '#e3f6fb', text2: '#92bccb', accent: '#2ee6c5' } },
  { id: 'crimson', name: 'Crimson', colors: { bg: '#120a0b', surface: '#1b0f11', surface2: '#251517', line: '#36201f', text: '#f5eaea', text2: '#bfa3a3', accent: '#ef4444' } },
  { id: 'paper', name: 'Paper', light: true, colors: { bg: '#f5f6f9', surface: '#ffffff', surface2: '#eef0f4', line: '#dfe2ea', text: '#12161f', text2: '#525b6e', accent: '#3b6cff' } },
  { id: 'linen', name: 'Linen', light: true, colors: { bg: '#f7f3ee', surface: '#fffdfa', surface2: '#f0ebe4', line: '#e3dcd2', text: '#1f1a15', text2: '#6b6157', accent: '#b8501f' } },
];

/** Quick accent picks shown under the theme grid. */
export const ACCENTS = ['#5b8cff', '#8b6cff', '#ff4d8d', '#ff00d4', '#ef4444', '#ff7a1a', '#f2c14e', '#4fd087', '#2ee6c5', '#38bdf8', '#ececec'];

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export interface FontChoice {
  id: string;
  name: string;
  /** Body font stack */
  body: string;
  /** Heading font stack (defaults to body) */
  display?: string;
  /** Google Fonts families to load when chosen; nothing loads for system fonts. */
  google?: string[];
}

const SYS = "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, sans-serif";

export const FONTS: FontChoice[] = [
  { id: 'system', name: 'System (Segoe)', body: SYS },
  { id: 'inter', name: 'Inter', body: `'Inter', ${SYS}`, google: ['Inter:wght@400;500;600;700;800'] },
  { id: 'manrope', name: 'Manrope', body: `'Manrope', ${SYS}`, google: ['Manrope:wght@400;500;600;700;800'] },
  { id: 'outfit', name: 'Outfit', body: `'Outfit', ${SYS}`, google: ['Outfit:wght@400;500;600;700;800'] },
  { id: 'grotesk', name: 'Space Grotesk', body: `'Space Grotesk', ${SYS}`, google: ['Space+Grotesk:wght@400;500;600;700'] },
  { id: 'nunito', name: 'Nunito (rounded)', body: `'Nunito', ${SYS}`, google: ['Nunito:wght@400;600;700;800'] },
  {
    id: 'cinema',
    name: 'Cinema (serif titles)',
    body: `'Inter', ${SYS}`,
    display: `'DM Serif Display', Georgia, serif`,
    google: ['Inter:wght@400;500;600;700', 'DM+Serif+Display'],
  },
  { id: 'mono', name: 'Mono', body: `'JetBrains Mono', ui-monospace, Consolas, monospace`, google: ['JetBrains+Mono:wght@400;500;700'] },
];

export function fontById(id: string): FontChoice {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}
