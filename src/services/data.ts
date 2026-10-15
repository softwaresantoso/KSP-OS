import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  type DocumentData,
  type QueryConstraint,
  query,
} from 'firebase/firestore';
import { auth, db } from './firebase.ts';
import type { LoanProduct } from '../core/types.ts';
import type { ISODate } from '../core/dates.ts';

export interface Member {
  id: string;
  memberNo: string;
  name: string;
  nik?: string;
  phone?: string;
  address?: string;
  dusun?: string;
  joinDate: ISODate;
  status: 'aktif' | 'nonaktif';
  uid?: string;
}

export type WithId<T> = T & { id: string };

export function koperasiPath(kid: string, ...segments: string[]): string {
  return ['koperasi', kid, ...segments].join('/');
}

/** Langganan realtime ke sebuah koleksi. Bekerja offline dari cache lokal. */
export function useCollection<T>(
  path: string | null,
  ...constraints: QueryConstraint[]
): { data: WithId<T>[]; loading: boolean; error: string | null; fromCache: boolean } {
  const [state, setState] = useState<{ data: WithId<T>[]; loading: boolean; error: string | null; fromCache: boolean }>({
    data: [],
    loading: true,
    error: null,
    fromCache: false,
  });
  const key = path + '|' + constraints.map((c) => JSON.stringify(c)).join('|');

  useEffect(() => {
    if (!path) {
      setState({ data: [], loading: false, error: null, fromCache: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      query(collection(db, path), ...constraints),
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          data: snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })),
          loading: false,
          error: null,
          fromCache: snap.metadata.fromCache,
        }),
      (err) => setState({ data: [], loading: false, error: err.message, fromCache: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

/** Langganan realtime ke satu dokumen. */
export function useDocument<T>(path: string | null): { data: WithId<T> | null; loading: boolean } {
  const [state, setState] = useState<{ data: WithId<T> | null; loading: boolean }>({ data: null, loading: true });
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false });
      return;
    }
    return onSnapshot(
      doc(db, path),
      (snap) => setState({ data: snap.exists() ? { ...(snap.data() as T), id: snap.id } : null, loading: false }),
      () => setState({ data: null, loading: false }),
    );
  }, [path]);
  return state;
}

export function newId(path: string): string {
  return doc(collection(db, path)).id;
}

/**
 * Tulis dokumen. Saat offline, penulisan masuk antrean lokal dan terkirim otomatis ketika online;
 * karena itu promise server-ack TIDAK ditunggu, dan error dilaporkan lewat onError.
 */
export function writeQueued(path: string, data: DocumentData, onError: (message: string) => void): void {
  setDoc(doc(db, path), data).catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
}

/** Panggil backend Cloudflare (/api/*) dengan ID token pengguna. Butuh internet. */
async function api<T>(route: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Silakan login terlebih dahulu');
  let res: Response;
  try {
    res = await fetch(`/api/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${await user.getIdToken()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Tidak ada koneksi internet. Tindakan ini membutuhkan internet.');
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Permintaan gagal (${res.status})`);
  return json;
}

export async function callLoanAction(params: {
  loanId: string;
  action: 'verify' | 'approve' | 'reject' | 'disburse' | 'cancel';
  note?: string;
  disbursedDate?: ISODate;
}): Promise<void> {
  await api('loan-action', params);
}

export async function callCreateAccount(params: {
  email: string;
  password: string;
  role: string;
  memberId?: string;
}): Promise<void> {
  await api('create-account', params);
}

export async function callSetupKoperasi(params: {
  name: string;
  ketuaEmail: string;
  ketuaPassword: string;
}): Promise<{ koperasiId: string }> {
  return api('setup-koperasi', params);
}

export async function fetchMe(): Promise<{ superadmin: boolean }> {
  return api('me');
}

export type Product = WithId<LoanProduct>;

export function friendlyError(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Terjadi kesalahan';
}
