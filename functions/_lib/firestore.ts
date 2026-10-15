/** Klien Firestore REST minimal (get, set/update, transaksi) untuk Cloudflare Worker. */
import { ApiError } from './google.ts';

type FetchFn = typeof fetch;

export type FsValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

export function encodeValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Angka tidak valid');
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(encodeValue) } : {} };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } };
  throw new Error(`Tipe data tidak didukung: ${typeof v}`);
}

export function encodeFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val !== undefined) out[k] = encodeValue(val);
  }
  return out;
}

export function decodeValue(v: FsValue): unknown {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields ?? {});
  return null;
}

export function decodeFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(fields)) out[k] = decodeValue(val);
  return out;
}

interface Write {
  update: { name: string; fields: Record<string, FsValue> };
  updateMask?: { fieldPaths: string[] };
  currentDocument?: { exists: boolean };
}

/** Bangun ApiError yang menyertakan pesan asli dari Google agar penyebabnya terlihat. */
async function failure(res: Response, what: string): Promise<ApiError> {
  let detail = '';
  try {
    const json = (await res.json()) as { error?: { message?: string; status?: string } };
    detail = json.error?.message ?? json.error?.status ?? '';
  } catch {
    detail = '';
  }
  return new ApiError(502, `${what} (${res.status})${detail ? `: ${detail}` : ''}`);
}

export class Tx {
  readonly writes: Write[] = [];
  private readonly fs: Firestore;
  private readonly id: string;
  constructor(fs: Firestore, id: string) {
    this.fs = fs;
    this.id = id;
  }
  get(path: string): Promise<Record<string, unknown> | null> {
    return this.fs.get(path, this.id);
  }
  /** Ganti seluruh dokumen. */
  set(path: string, data: Record<string, unknown>): void {
    this.writes.push({ update: { name: this.fs.docName(path), fields: encodeFields(data) } });
  }
}

export class Firestore {
  private readonly base: string;
  private readonly root: string;
  private readonly getToken: () => Promise<string>;
  private readonly fetchFn: FetchFn;

  constructor(projectId: string, getToken: () => Promise<string>, fetchFn: FetchFn = fetch) {
    this.root = `projects/${projectId}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
    this.getToken = getToken;
    this.fetchFn = fetchFn;
  }

  docName(path: string): string {
    return `${this.root}/${path}`;
  }

  private async call(url: string, method: 'GET' | 'POST', body?: unknown): Promise<Response> {
    return this.fetchFn(url, {
      method,
      headers: { authorization: `Bearer ${await this.getToken()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async get(path: string, transaction?: string): Promise<Record<string, unknown> | null> {
    const qs = transaction ? `?transaction=${encodeURIComponent(transaction)}` : '';
    const res = await this.call(`${this.base}/${path}${qs}`, 'GET');
    if (res.status === 404) return null;
    if (!res.ok) throw await failure(res, 'Gagal membaca data');
    const doc = (await res.json()) as { fields?: Record<string, FsValue> };
    return decodeFields(doc.fields ?? {});
  }

  /** Tulis dokumen tanpa transaksi. `mask` = hanya perbarui field tertentu. */
  async commit(writes: { path: string; data: Record<string, unknown>; mask?: string[]; mustExist?: boolean }[]): Promise<void> {
    const body = {
      writes: writes.map((w): Write => ({
        update: { name: this.docName(w.path), fields: encodeFields(w.data) },
        ...(w.mask ? { updateMask: { fieldPaths: w.mask } } : {}),
        ...(w.mustExist ? { currentDocument: { exists: true } } : {}),
      })),
    };
    const res = await this.call(`${this.base}:commit`, 'POST', body);
    if (!res.ok) throw await failure(res, 'Gagal menyimpan data');
  }

  /** Transaksi baca-lalu-tulis dengan percobaan ulang saat bentrok. */
  async runTransaction<T>(fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
    for (let i = 0; i < attempts; i++) {
      const begin = await this.call(`${this.base}:beginTransaction`, 'POST', { options: { readWrite: {} } });
      if (!begin.ok) throw await failure(begin, 'Gagal memulai transaksi');
      const { transaction } = (await begin.json()) as { transaction: string };
      const tx = new Tx(this, transaction);
      const result = await fn(tx);
      const commit = await this.call(`${this.base}:commit`, 'POST', { writes: tx.writes, transaction });
      if (commit.ok) return result;
      // 409 = ABORTED (bentrok dengan penulis lain): ulangi. Status lain adalah kesalahan sungguhan.
      if (commit.status !== 409) throw await failure(commit, 'Gagal menyimpan transaksi');
      if (i === attempts - 1) throw new ApiError(409, 'Data sedang diubah pihak lain, coba lagi');
    }
    throw new ApiError(409, 'Transaksi gagal');
  }
}
