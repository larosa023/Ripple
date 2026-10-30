export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

export const toasts: { list: Toast[] } = $state({ list: [] });
let next = 1;

export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3500) {
  const id = next++;
  toasts.list.push({ id, text, kind });
  setTimeout(() => {
    toasts.list = toasts.list.filter((t) => t.id !== id);
  }, ms);
}
