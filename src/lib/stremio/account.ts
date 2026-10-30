// Imports the addon collection from a Stremio account, so users can bring
// every addon they already use in one step. Credentials go only to
// api.strem.io and are never stored; only the returned addon list is kept.

import { postJson } from './http';
import type { Manifest } from './types';

const API = 'https://api.strem.io/api';

interface ApiResponse<T> {
  result?: T;
  error?: { message?: string } | string;
}

function unwrap<T>(r: ApiResponse<T>): T {
  if (r.error) throw new Error(typeof r.error === 'string' ? r.error : r.error.message || 'Stremio API error');
  if (!r.result) throw new Error('Empty response from Stremio');
  return r.result;
}

export async function login(email: string, password: string): Promise<string> {
  const r = await postJson<ApiResponse<{ authKey: string }>>(`${API}/login`, {
    type: 'Login',
    email,
    password,
    facebook: false,
  });
  return unwrap(r).authKey;
}

export async function fetchAddonCollection(authKey: string): Promise<{ transportUrl: string; manifest: Manifest }[]> {
  const r = await postJson<ApiResponse<{ addons: { transportUrl: string; manifest: Manifest }[] }>>(
    `${API}/addonCollectionGet`,
    { type: 'AddonCollectionGet', authKey, update: true },
  );
  return unwrap(r).addons ?? [];
}

export async function logout(authKey: string): Promise<void> {
  await postJson(`${API}/logout`, { type: 'Logout', authKey }).catch(() => undefined);
}
