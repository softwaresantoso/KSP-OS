/** Akses API Google dari Cloudflare Worker memakai service account (tanpa Firebase Admin SDK). */

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type FetchFn = typeof fetch;

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/identitytoolkit',
].join(' ');

/** Membuat JWT bertanda tangan RS256 untuk alur OAuth service account. */
export async function signServiceAccountJwt(sa: ServiceAccount, nowSec: number): Promise<string> {
  const aud = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: GOOGLE_SCOPES, aud, iat: nowSec, exp: nowSec + 3600 }));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

let cached: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(sa: ServiceAccount, fetchFn: FetchFn = fetch, nowMs = Date.now()): Promise<string> {
  if (cached && cached.expiresAt - 60_000 > nowMs) return cached.token;
  const jwt = await signServiceAccountJwt(sa, Math.floor(nowMs / 1000));
  const res = await fetchFn(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) {
    const info = (await res.json().catch(() => ({}))) as { error_description?: string; error?: string };
    throw new ApiError(502, `Gagal mengambil token layanan Google (${res.status}): ${info.error_description ?? info.error ?? 'periksa FIREBASE_SERVICE_ACCOUNT'}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: nowMs + json.expires_in * 1000 };
  return cached.token;
}

export function resetTokenCache(): void {
  cached = null;
}

export interface IdentityUser {
  localId: string;
  email?: string;
  disabled?: boolean;
  customAttributes?: string;
}

/** Memverifikasi ID token Firebase milik pengguna lewat Identity Toolkit. */
export async function lookupIdToken(apiKey: string, idToken: string, fetchFn: FetchFn = fetch): Promise<IdentityUser> {
  const res = await fetchFn(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new ApiError(401, 'Sesi login tidak valid atau kedaluwarsa. Silakan login ulang.');
  const json = (await res.json()) as { users?: IdentityUser[] };
  const user = json.users?.[0];
  if (!user) throw new ApiError(401, 'Pengguna tidak ditemukan');
  if (user.disabled) throw new ApiError(403, 'Akun dinonaktifkan');
  return user;
}

async function identityAdmin(projectId: string, token: string, path: string, body: unknown, fetchFn: FetchFn): Promise<Record<string, unknown>> {
  const res = await fetchFn(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & Record<string, unknown>;
  if (!res.ok) {
    const code = json.error?.message ?? '';
    if (code.includes('EMAIL_EXISTS')) throw new ApiError(409, 'Email sudah terdaftar');
    if (code.includes('INVALID_EMAIL')) throw new ApiError(400, 'Format email tidak valid');
    if (code.includes('WEAK_PASSWORD')) throw new ApiError(400, 'Kata sandi terlalu lemah');
    throw new ApiError(502, `Gagal mengelola akun (${code || res.status})`);
  }
  return json;
}

export async function createAuthUser(
  projectId: string,
  token: string,
  params: { email: string; password: string; displayName?: string },
  fetchFn: FetchFn = fetch,
): Promise<string> {
  const json = await identityAdmin(projectId, token, '/accounts', params, fetchFn);
  const id = json.localId;
  if (typeof id !== 'string') throw new ApiError(502, 'Respons pembuatan akun tidak lengkap');
  return id;
}

export async function setCustomClaims(
  projectId: string,
  token: string,
  uid: string,
  claims: Record<string, unknown>,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  await identityAdmin(projectId, token, '/accounts:update', { localId: uid, customAttributes: JSON.stringify(claims) }, fetchFn);
}

/** Menghapus akun Auth (dipakai untuk membatalkan pembuatan akun bila penulisan database gagal). */
export async function deleteAuthUser(projectId: string, token: string, uid: string, fetchFn: FetchFn = fetch): Promise<void> {
  await identityAdmin(projectId, token, '/accounts:delete', { localId: uid }, fetchFn);
}
