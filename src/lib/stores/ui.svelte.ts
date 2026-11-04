// Transient UI state (not persisted).
export type StudioTab = 'look' | 'layout' | 'home' | 'code' | 'themes';

export const ui: { studioOpen: boolean; studioTab: StudioTab } = $state({ studioOpen: false, studioTab: 'look' });

export function openStudio(tab?: StudioTab) {
  if (tab) ui.studioTab = tab;
  ui.studioOpen = true;
}

// ---------- right-click menu ----------
export interface MenuItem {
  label: string;
  icon?: string;
  run: () => void;
  danger?: boolean;
}

export const contextMenu: { open: boolean; x: number; y: number; title: string; items: MenuItem[] } = $state({
  open: false,
  x: 0,
  y: 0,
  title: '',
  items: [],
});

export function openMenu(e: MouseEvent, items: MenuItem[], title = '') {
  e.preventDefault();
  e.stopPropagation();
  Object.assign(contextMenu, { open: true, x: e.clientX, y: e.clientY, items, title });
}

export function closeMenu() {
  contextMenu.open = false;
}
