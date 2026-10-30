import { isTauri } from '../stremio/http';

export interface UpdateInfo {
  current: string;
  version: string;
  notes: string;
  pageUrl: string;
  downloadUrl: string;
}

type Status = 'idle' | 'checking' | 'available' | 'none' | 'installing' | 'error';

export const updater: { status: Status; info: UpdateInfo | null; error: string; dismissed: boolean; version: string } =
  $state({ status: 'idle', info: null, error: '', dismissed: false, version: '' });

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

export async function loadVersion() {
  if (!isTauri) return;
  const { getVersion } = await import('@tauri-apps/api/app');
  updater.version = await getVersion();
}

export async function checkForUpdate(): Promise<void> {
  if (!isTauri || updater.status === 'checking' || updater.status === 'installing') return;
  updater.status = 'checking';
  updater.error = '';
  try {
    const info = await invoke<UpdateInfo | null>('check_update');
    updater.info = info;
    updater.status = info ? 'available' : 'none';
    if (info) updater.dismissed = false;
  } catch (e) {
    updater.status = 'error';
    updater.error = String(e);
  }
}

export async function installUpdate(): Promise<void> {
  if (!updater.info) return;
  updater.status = 'installing';
  try {
    // Downloads, starts the installer, and closes Ripple; it reopens when done.
    await invoke('install_update', { url: updater.info.downloadUrl });
  } catch (e) {
    updater.status = 'error';
    updater.error = String(e);
  }
}
