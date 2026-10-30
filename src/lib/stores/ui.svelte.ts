// Transient UI state (not persisted).
export type StudioTab = 'look' | 'layout' | 'home' | 'code' | 'themes';

export const ui: { studioOpen: boolean; studioTab: StudioTab } = $state({ studioOpen: false, studioTab: 'look' });

export function openStudio(tab?: StudioTab) {
  if (tab) ui.studioTab = tab;
  ui.studioOpen = true;
}
