export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  action?: ToastAction;
}

export const toasts: { list: Toast[] } = $state({ list: [] });
let next = 1;

export function dismiss(id: number) {
  toasts.list = toasts.list.filter((t) => t.id !== id);
}

/** Shows a toast. Toasts with an action stay longer so there's time to click it. */
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3500, action?: ToastAction): number {
  const id = next++;
  toasts.list.push({ id, text, kind, action });
  setTimeout(() => dismiss(id), action ? Math.max(ms, 10000) : ms);
  return id;
}
