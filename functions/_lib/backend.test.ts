import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeValue, encodeFields, encodeValue, decodeFields } from './firestore.ts';
import { getAccessToken, resetTokenCache, signServiceAccountJwt, type ServiceAccount } from './google.ts';
import { authenticate, createAccount, loanAction, setupKoperasi, type Caller, type Env } from './handlers.ts';

// ---------- Firestore encode/decode ----------

test('encode/decode Firestore: tipe dasar, array kosong, map bersarang', () => {
  const data = {
    s: 'teks', n: 5, f: 1.5, b: true, z: null, arr: [], list: [{ a: 1 }, { a: 2 }],
    nested: { penalty: { type: 'none', value: 0, graceDays: 3 } },
  };
  assert.deepEqual(encodeValue(5), { integerValue: '5' });
  assert.deepEqual(encodeValue(1.5), { doubleValue: 1.5 });
  assert.deepEqual(encodeValue([]), { arrayValue: {} });
  assert.deepEqual(decodeFields(encodeFields(data)), data);
  assert.equal(decodeValue({ integerValue: '10000000' }), 10_000_000);
  assert.deepEqual(encodeFields({ a: undefined, b: 1 }), { b: { integerValue: '1' } });
  assert.throws(() => encodeValue(Number.NaN));
});

// ---------- JWT service account ----------

async function makeServiceAccount(): Promise<{ sa: ServiceAccount; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
  return { sa: { client_email: 'svc@proyek.iam.gserviceaccount.com', private_key: pem }, publicKey: pair.publicKey };
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

test('JWT service account: klaim benar dan tanda tangan RS256 valid', async () => {
  const { sa, publicKey } = await makeServiceAccount();
  const jwt = await signServiceAccountJwt(sa, 1_700_000_000);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromB64url(h))), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(c)));
  assert.equal(claims.iss, sa.client_email);
  assert.equal(claims.exp - claims.iat, 3600);
  assert.match(claims.scope, /datastore/);
  assert.match(claims.scope, /identitytoolkit/);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, fromB64url(s), new TextEncoder().encode(`${h}.${c}`));
  assert.equal(ok, true);
});

// ---------- Google palsu di memori ----------

const PROJECT = 'proyek-uji';
const DOCS = `projects/${PROJECT}/databases/(default)/documents/`;

class FakeGoogle {
  docs = new Map<string, Record<string, unknown>>();
  users = new Map<string, { localId: string; email: string; customAttributes?: string }>();
  idTokens = new Map<string, string>(); // idToken -> localId
  nextUid = 1;
  tokenCalls = 0;
  failCommit = false;

  addUser(email: string, claims?: Record<string, unknown>): string {
    const localId = `uid${this.nextUid++}`;
    this.users.set(localId, { localId, email, customAttributes: claims ? JSON.stringify(claims) : undefined });
    this.idTokens.set(`tok-${localId}`, localId);
    return `tok-${localId}`;
  }

  fetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : '';
    const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

    if (url === 'https://oauth2.googleapis.com/token') {
      this.tokenCalls++;
      return reply(200, { access_token: 'svc-token', expires_in: 3600 });
    }
    if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup')) {
      const uid = this.idTokens.get(JSON.parse(body).idToken);
      const user = uid ? this.users.get(uid) : undefined;
      return user ? reply(200, { users: [user] }) : reply(400, { error: { message: 'INVALID_ID_TOKEN' } });
    }
    if (url === `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`) {
      const { email } = JSON.parse(body);
      if ([...this.users.values()].some((u) => u.email === email)) return reply(400, { error: { message: 'EMAIL_EXISTS' } });
      const localId = `uid${this.nextUid++}`;
      this.users.set(localId, { localId, email });
      return reply(200, { localId });
    }
    if (url === `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:delete`) {
      this.users.delete(JSON.parse(body).localId);
      return reply(200, {});
    }
    if (url === `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`) {
      const { localId, customAttributes } = JSON.parse(body);
      this.users.get(localId)!.customAttributes = customAttributes;
      return reply(200, { localId });
    }
    if (url.startsWith('https://firestore.googleapis.com/v1/')) {
      const rest = url.slice('https://firestore.googleapis.com/v1/'.length);
      if (rest.endsWith(':beginTransaction')) return reply(200, { transaction: 'tx-1' });
      if (rest.endsWith(':commit')) {
        if (this.failCommit) return reply(403, { error: { message: 'Missing or insufficient permissions (palsu)', status: 'PERMISSION_DENIED' } });
        const { writes } = JSON.parse(body) as { writes: { update: { name: string; fields: Record<string, unknown> }; updateMask?: { fieldPaths: string[] }; currentDocument?: { exists: boolean } }[] };
        for (const w of writes) {
          const key = w.update.name.slice(DOCS.length);
          const existing = this.docs.get(key);
          if (w.currentDocument?.exists && !existing) return reply(404, { error: { message: 'NOT_FOUND' } });
          if (w.updateMask) this.docs.set(key, { ...(existing ?? {}), ...Object.fromEntries(w.updateMask.fieldPaths.map((f) => [f, w.update.fields[f]])) });
          else this.docs.set(key, w.update.fields);
          for (const t of (w as { updateTransforms?: { fieldPath: string; increment: { integerValue: string } }[] }).updateTransforms ?? []) {
            const doc = this.docs.get(key) as Record<string, { integerValue?: string }>;
            const cur = Number(doc[t.fieldPath]?.integerValue ?? 0);
            doc[t.fieldPath] = { integerValue: String(cur + Number(t.increment.integerValue)) };
          }
        }
        return reply(200, {});
      }
      if (method === 'GET') {
        const path = decodeURIComponent(rest.split('?')[0].slice(DOCS.length));
        const fields = this.docs.get(path);
        return fields ? reply(200, { name: DOCS + path, fields }) : reply(404, { error: { message: 'NOT_FOUND' } });
      }
    }
    return reply(500, { error: { message: `Rute palsu tidak dikenal: ${method} ${url}` } });
  };

  seed(path: string, data: Record<string, unknown>) {
    this.docs.set(path, encodeFields(data));
  }
  read(path: string): Record<string, unknown> | undefined {
    const f = this.docs.get(path);
    return f ? decodeFields(f as never) : undefined;
  }
}

async function setup() {
  resetTokenCache();
  const { sa } = await makeServiceAccount();
  const env: Env = {
    FIREBASE_PROJECT_ID: PROJECT,
    FIREBASE_API_KEY: 'api-key',
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa),
    SUPERADMIN_EMAILS: 'Pemilik@contoh.com',
  };
  const google = new FakeGoogle();
  // Meniru Cloudflare Workers: fetch menolak dipanggil dengan `this` selain globalThis ("Illegal invocation").
  const raw = google.fetch;
  google.fetch = function (this: unknown, input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation");
    return raw(input, init);
  } as typeof fetch;
  return { google, env };
}

function req(token?: string): Request {
  return new Request('https://app.example/api/x', { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

const KID = 'kop1';

function seedLoan(g: FakeGoogle, principal: number) {
  g.seed(`koperasi/${KID}`, { name: 'Koperasi Uji' });
  g.seed(`koperasi/${KID}/loans/L1`, {
    memberId: 'M1', productId: 'p1', principal, tenorMonths: 12, interestMethod: 'flat', ratePerMonth: 1.5,
    adminFeePercent: 1, penalty: { type: 'none', value: 0, graceDays: 0 }, purpose: 'Modal',
    status: 'diajukan', requestedByUid: 'anggota-uid', requestedAt: '2026-10-14T00:00:00.000Z', approvals: [], history: [],
  });
}

async function caller(g: FakeGoogle, env: Env, email: string, claims: Record<string, unknown>): Promise<Caller> {
  const tok = g.addUser(email, claims);
  return authenticate(req(tok), env, g.fetch);
}

test('authenticate: token tidak ada/salah ditolak; klaim dan superadmin terbaca', async () => {
  const { google, env } = await setup();
  await assert.rejects(() => authenticate(req(), env, google.fetch), /login/);
  await assert.rejects(() => authenticate(req('salah'), env, google.fetch), /tidak valid/);
  const c = await caller(google, env, 'pemilik@contoh.com', {});
  assert.equal(c.superadmin, true);
  assert.equal(c.kid, '');
  const k = await caller(google, env, 'kasir@contoh.com', { kid: KID, role: 'admin', mid: '' });
  assert.deepEqual([k.kid, k.role, k.mid, k.superadmin], [KID, 'admin', null, false]);
});

test('token layanan Google di-cache antar-pemanggilan', async () => {
  const { google, env } = await setup();
  seedLoan(google, 1_000_000);
  const kasir = await caller(google, env, 'kasir@contoh.com', { kid: KID, role: 'admin', mid: '' });
  await loanAction(kasir, { loanId: 'L1', action: 'verify' }, env, google.fetch);
  assert.equal(google.tokenCalls, 1);
  assert.equal(typeof (await getAccessToken(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT), google.fetch)), 'string');
  assert.equal(google.tokenCalls, 1);
});

test('alur pinjaman kecil end-to-end lewat Worker, dengan kas otomatis saat pencairan', async () => {
  const { google, env } = await setup();
  seedLoan(google, 3_000_000);
  const kasir = await caller(google, env, 'kasir@contoh.com', { kid: KID, role: 'admin', mid: '' });
  const ketua = await caller(google, env, 'ketua@contoh.com', { kid: KID, role: 'ketua', mid: '' });
  const bendahara = await caller(google, env, 'bend@contoh.com', { kid: KID, role: 'bendahara', mid: '' });

  await loanAction(kasir, { loanId: 'L1', action: 'verify', note: 'Lengkap' }, env, google.fetch);
  assert.equal(google.read(`koperasi/${KID}/loans/L1`)!.status, 'diverifikasi');
  await loanAction(ketua, { loanId: 'L1', action: 'approve' }, env, google.fetch);
  assert.equal(google.read(`koperasi/${KID}/loans/L1`)!.status, 'disetujui');
  await loanAction(bendahara, { loanId: 'L1', action: 'disburse', disbursedDate: '2026-10-15' }, env, google.fetch);

  const loan = google.read(`koperasi/${KID}/loans/L1`)!;
  assert.equal(loan.status, 'dicairkan');
  assert.equal(loan.firstDueDate, '2026-11-15');
  assert.equal((loan.history as unknown[]).length, 3);
  assert.equal((loan.penalty as { graceDays: number }).graceDays, 0);
  assert.equal(google.read(`koperasi/${KID}/cashEntries/loan-L1-out`)!.amount, 2_970_000);
  assert.equal(google.read(`koperasi/${KID}/cashEntries/loan-L1-fee`)!.amount, 30_000);
  // Ringkasan kas untuk anggota ikut berubah: keluar 2.970.000, masuk 30.000.
  const kas = google.read(`koperasi/${KID}/summary/kas`)!;
  assert.deepEqual([kas.balance, kas.totalIn, kas.totalOut], [-2_940_000, 30_000, 2_970_000]);
});

test('pinjaman besar butuh Ketua dan Bendahara', async () => {
  const { google, env } = await setup();
  seedLoan(google, 10_000_000);
  const kasir = await caller(google, env, 'kasir@contoh.com', { kid: KID, role: 'admin', mid: '' });
  const ketua = await caller(google, env, 'ketua@contoh.com', { kid: KID, role: 'ketua', mid: '' });
  const bendahara = await caller(google, env, 'bend@contoh.com', { kid: KID, role: 'bendahara', mid: '' });
  await loanAction(kasir, { loanId: 'L1', action: 'verify' }, env, google.fetch);
  await loanAction(ketua, { loanId: 'L1', action: 'approve' }, env, google.fetch);
  assert.equal(google.read(`koperasi/${KID}/loans/L1`)!.status, 'diverifikasi');
  await assert.rejects(() => loanAction(bendahara, { loanId: 'L1', action: 'disburse', disbursedDate: '2026-10-15' }, env, google.fetch), /status/);
  await loanAction(bendahara, { loanId: 'L1', action: 'approve' }, env, google.fetch);
  assert.equal(google.read(`koperasi/${KID}/loans/L1`)!.status, 'disetujui');
});

test('keamanan: peran salah, anggota, koperasi lain, dan id berbahaya ditolak', async () => {
  const { google, env } = await setup();
  seedLoan(google, 1_000_000);
  const anggota = await caller(google, env, 'ang@contoh.com', { kid: KID, role: 'anggota', mid: 'M1' });
  const sekretaris = await caller(google, env, 'sek@contoh.com', { kid: KID, role: 'sekretaris', mid: '' });
  const lain = await caller(google, env, 'lain@contoh.com', { kid: 'koplain', role: 'bendahara', mid: '' });
  await assert.rejects(() => loanAction(anggota, { loanId: 'L1', action: 'verify' }, env, google.fetch), /berwenang/);
  await assert.rejects(() => loanAction(sekretaris, { loanId: 'L1', action: 'verify' }, env, google.fetch), /berwenang/);
  await assert.rejects(() => loanAction(lain, { loanId: 'L1', action: 'verify' }, env, google.fetch), /tidak ditemukan/);
  await assert.rejects(() => loanAction(sekretaris, { loanId: '../../x', action: 'verify' }, env, google.fetch), /tidak valid/);
  await assert.rejects(() => loanAction(sekretaris, { loanId: 'L1', action: 'hapus' }, env, google.fetch), /tidak dikenal/);
  const tanpaKoperasi = await caller(google, env, 'x@contoh.com', {});
  await assert.rejects(() => loanAction(tanpaKoperasi, { loanId: 'L1', action: 'verify' }, env, google.fetch), /belum terhubung/);
  assert.equal(google.read(`koperasi/${KID}/loans/L1`)!.status, 'diajukan');
});

test('anggota boleh membatalkan pengajuannya sendiri, bukan milik orang lain', async () => {
  const { google, env } = await setup();
  seedLoan(google, 1_000_000);
  const orangLain = await caller(google, env, 'o@contoh.com', { kid: KID, role: 'anggota', mid: 'M2' });
  await assert.rejects(() => loanAction(orangLain, { loanId: 'L1', action: 'cancel' }, env, google.fetch));
  const pemilik = await caller(google, env, 'p@contoh.com', { kid: KID, role: 'anggota', mid: 'M1' });
  await loanAction(pemilik, { loanId: 'L1', action: 'cancel', note: 'Batal' }, env, google.fetch);
  assert.equal(google.read(`koperasi/${KID}/loans/L1`)!.status, 'dibatalkan');
});

test('setupKoperasi: hanya pemilik platform; membuat koperasi dan akun Ketua dengan klaim', async () => {
  const { google, env } = await setup();
  const biasa = await caller(google, env, 'biasa@contoh.com', {});
  await assert.rejects(() => setupKoperasi(biasa, { name: 'K', ketuaEmail: 'k@contoh.com', ketuaPassword: 'rahasia123' }, env, google.fetch), /pemilik platform/);

  const pemilik = await caller(google, env, 'pemilik@contoh.com', {});
  await assert.rejects(() => setupKoperasi(pemilik, { name: 'K', ketuaEmail: 'k@contoh.com', ketuaPassword: 'pendek' }, env, google.fetch), /minimal 8/);
  const r = await setupKoperasi(pemilik, { name: 'Koperasi Maju', ketuaEmail: 'k@contoh.com', ketuaPassword: 'rahasia123' }, env, google.fetch);
  assert.equal(google.read(`koperasi/${r.koperasiId}`)!.name, 'Koperasi Maju');
  const claims = JSON.parse(google.users.get(r.ketuaUid)!.customAttributes!);
  assert.deepEqual(claims, { kid: r.koperasiId, role: 'ketua', mid: '' });
  assert.equal(google.read(`koperasi/${r.koperasiId}/staff/${r.ketuaUid}`)!.role, 'ketua');
  const policy = google.read(`koperasi/${r.koperasiId}`)!.approvalPolicy as { singleApprovalMaxAmount: number };
  assert.equal(policy.singleApprovalMaxAmount, 5_000_000);
});

test('createAccount: sekretaris membuat akun anggota; hanya ketua membuat pengurus', async () => {
  const { google, env } = await setup();
  google.seed(`koperasi/${KID}`, { name: 'Koperasi Uji' });
  google.seed(`koperasi/${KID}/members/M1`, { name: 'Budi', status: 'aktif' });
  const sekretaris = await caller(google, env, 'sek@contoh.com', { kid: KID, role: 'sekretaris', mid: '' });
  const ketua = await caller(google, env, 'ketua@contoh.com', { kid: KID, role: 'ketua', mid: '' });
  const anggota = await caller(google, env, 'ang@contoh.com', { kid: KID, role: 'anggota', mid: 'M1' });

  await assert.rejects(() => createAccount(anggota, { email: 'a@c.com', password: 'rahasia123', role: 'anggota', memberId: 'M1' }, env, google.fetch), /berwenang/);
  await assert.rejects(() => createAccount(sekretaris, { email: 'b@c.com', password: 'rahasia123', role: 'bendahara' }, env, google.fetch), /Ketua/);
  await assert.rejects(() => createAccount(ketua, { email: 'b@c.com', password: 'rahasia123', role: 'ketua' }, env, google.fetch), /pemilik platform/);
  await assert.rejects(() => createAccount(sekretaris, { email: 'b@c.com', password: 'rahasia123', role: 'anggota', memberId: 'TIDAK-ADA' }, env, google.fetch), /tidak ditemukan/);

  const r = await createAccount(sekretaris, { email: 'budi@c.com', password: 'rahasia123', role: 'anggota', memberId: 'M1' }, env, google.fetch);
  assert.deepEqual(JSON.parse(google.users.get(r.uid)!.customAttributes!), { kid: KID, role: 'anggota', mid: 'M1' });
  assert.equal(google.read(`koperasi/${KID}/members/M1`)!.uid, r.uid);
  assert.equal(google.read(`koperasi/${KID}/members/M1`)!.name, 'Budi'); // field lain tidak terhapus
  await assert.rejects(() => createAccount(sekretaris, { email: 'lagi@c.com', password: 'rahasia123', role: 'anggota', memberId: 'M1' }, env, google.fetch), /sudah punya akun/);

  const staf = await createAccount(ketua, { email: 'bend@c.com', password: 'rahasia123', role: 'bendahara' }, env, google.fetch);
  assert.equal(JSON.parse(google.users.get(staf.uid)!.customAttributes!).role, 'bendahara');
  await assert.rejects(() => createAccount(ketua, { email: 'bend@c.com', password: 'rahasia123', role: 'admin' }, env, google.fetch), /sudah terdaftar/);
});

test('kegagalan database: akun dibatalkan (tidak ada akun yatim) dan pesan Google ditampilkan', async () => {
  const { google, env } = await setup();
  const pemilik = await caller(google, env, 'pemilik@contoh.com', {});
  const before = google.users.size;
  google.failCommit = true;
  await assert.rejects(
    () => setupKoperasi(pemilik, { name: 'K', ketuaEmail: 'k@contoh.com', ketuaPassword: 'rahasia123' }, env, google.fetch),
    /Gagal menyimpan data \(403\): Missing or insufficient permissions/,
  );
  assert.equal(google.users.size, before); // akun Ketua yang sempat dibuat sudah dihapus lagi

  google.failCommit = false;
  google.seed(`koperasi/${KID}`, { name: 'Koperasi Uji' });
  const sekretaris = await caller(google, env, 'sek@contoh.com', { kid: KID, role: 'sekretaris', mid: '' });
  google.seed(`koperasi/${KID}/members/M1`, { name: 'Budi', status: 'aktif' });
  const n = google.users.size;
  google.failCommit = true;
  await assert.rejects(() => createAccount(sekretaris, { email: 'budi@c.com', password: 'rahasia123', role: 'anggota', memberId: 'M1' }, env, google.fetch));
  assert.equal(google.users.size, n);
});

test('createAccount menolak bila dokumen koperasi tidak ada di database', async () => {
  const { google, env } = await setup();
  const ketua = await caller(google, env, 'ketua@contoh.com', { kid: 'tanpa-dokumen', role: 'ketua', mid: '' });
  const n = google.users.size;
  await assert.rejects(() => createAccount(ketua, { email: 'b@c.com', password: 'rahasia123', role: 'bendahara' }, env, google.fetch), /tidak ditemukan di database/);
  assert.equal(google.users.size, n);
});
