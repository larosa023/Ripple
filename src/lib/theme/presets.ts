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

export const PRESETS: Preset[] = [
  { id: 'ripple', name: 'Ripple', colors: { bg: '#0b0d12', surface: '#12151c', surface2: '#1a1e27', line: '#262b36', text: '#e8ebf2', text2: '#9aa2b4', accent: '#5b8cff' } },
  { id: 'midnight', name: 'Midnight', colors: { bg: '#000000', surface: '#0a0a0c', surface2: '#141418', line: '#1f1f25', text: '#ededf0', text2: '#9a9aa6', accent: '#5b8cff' } },
  { id: 'violet', name: 'Violet', colors: { bg: '#0c0b11', surface: '#151320', surface2: '#1d1a2b', line: '#2a2640', text: '#ebeaf2', text2: '#9f9bb8', accent: '#7b5bf5' } },
  { id: 'nord', name: 'Nord', colors: { bg: '#2e3440', surface: '#353c4a', surface2: '#3b4252', line: '#4c566a', text: '#eceff4', text2: '#b4bccb', accent: '#88c0d0' } },
  { id: 'dracula', name: 'Dracula', colors: { bg: '#22212c', surface: '#2a2936', surface2: '#343244', line: '#44415a', text: '#f8f8f2', text2: '#aeacc9', accent: '#bd93f9' } },
  { id: 'forest', name: 'Forest', colors: { bg: '#0f1612', surface: '#151f19', surface2: '#1c2921', line: '#2a3c30', text: '#e6efe8', text2: '#9db5a4', accent: '#5fd38d' } },
  { id: 'ember', name: 'Ember', colors: { bg: '#121010', surface: '#1a1716', surface2: '#24201e', line: '#352e2a', text: '#f2ece8', text2: '#b5a9a2', accent: '#ff7a1a' } },
  { id: 'royal', name: 'Royal', colors: { bg: '#0e0b1a', surface: '#161229', surface2: '#1f1937', line: '#2f2650', text: '#ece8ff', text2: '#a59cc9', accent: '#f2c14e' } },
  { id: 'velvet', name: 'Velvet', colors: { bg: '#170b12', surface: '#22101a', surface2: '#2e1623', line: '#432236', text: '#f7e9ef', text2: '#c49aad', accent: '#ff4d8d' } },
  { id: 'aurora', name: 'Aurora', colors: { bg: '#07131a', surface: '#0c1d26', surface2: '#122a35', line: '#1d3e4d', text: '#e3f6fb', text2: '#8fb8c6', accent: '#2ee6c5' } },
  { id: 'paper', name: 'Paper', light: true, colors: { bg: '#f4f5f8', surface: '#ffffff', surface2: '#eceef3', line: '#dde0e8', text: '#141821', text2: '#4f586b', accent: '#3b6cff' } },
];

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
