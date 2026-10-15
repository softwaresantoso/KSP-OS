import {
  ApprovalError,
  DEFAULT_APPROVAL_POLICY,
  cancel,
  decide,
  disburse,
  verify,
  type ApprovalPolicy,
} from '../../src/core/approval.ts';
import { ROLES, type Actor, type Loan } from '../../src/core/types.ts';
import { Firestore } from './firestore.ts';
import {
  ApiError,
  createAuthUser,
  deleteAuthUser,
  getAccessToken,
  lookupIdToken,
  setCustomClaims,
  type ServiceAccount,
} from './google.ts';

export interface Env {
  FIREBASE_PROJECT_ID: string;
  /** Web API key Firebase (nilai yang sama dengan VITE_FIREBASE_API_KEY; bukan rahasia). */
  FIREBASE_API_KEY: string;
  /** Isi lengkap file JSON service account (RAHASIA, simpan sebagai Secret). */
  FIREBASE_SERVICE_ACCOUNT: string;
  /** Daftar email pemilik platform, dipisah koma. */
  SUPERADMIN_EMAILS?: string;
}

export interface Caller {
  uid: string;
  email: string;
  kid: string;
  role: string;
  mid: string | null;
  superadmin: boolean;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function serviceAccount(env: Env): ServiceAccount {
  try {
    return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
  } catch {
    throw new ApiError(500, 'Konfigurasi server belum lengkap (FIREBASE_SERVICE_ACCOUNT)');
  }
}

function context(env: Env, fetchFn: typeof fetch) {
  const sa = serviceAccount(env);
  const token = () => getAccessToken(sa, fetchFn);
  return { token, fs: new Firestore(env.FIREBASE_PROJECT_ID, token, fetchFn) };
}

function str(v: unknown, name: string, max = 500): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) {
    throw new ApiError(400, `Isian "${name}" tidak valid`);
  }
  return v.trim();
}

function id(v: unknown, name: string): string {
  const s = str(v, name, 100);
  if (!ID_PATTERN.test(s)) throw new ApiError(400, `Isian "${name}" tidak valid`);
  return s;
}

export async function authenticate(request: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Caller> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new ApiError(401, 'Silakan login terlebih dahulu');
  const user = await lookupIdToken(env.FIREBASE_API_KEY, match[1], fetchFn);
  let claims: Record<string, unknown> = {};
  try {
    claims = user.customAttributes ? (JSON.parse(user.customAttributes) as Record<string, unknown>) : {};
  } catch {
    claims = {};
  }
  const email = (user.email ?? '').toLowerCase();
  const admins = (env.SUPERADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return {
    uid: user.localId,
    email,
    kid: typeof claims.kid === 'string' ? claims.kid : '',
    role: typeof claims.role === 'string' ? claims.role : '',
    mid: typeof claims.mid === 'string' && claims.mid !== '' ? claims.mid : null,
    superadmin: email !== '' && admins.includes(email),
  };
}

export async function setupKoperasi(caller: Caller, body: Record<string, unknown>, env: Env, fetchFn: typeof fetch = fetch) {
  if (!caller.superadmin) throw new ApiError(403, 'Hanya pemilik platform yang dapat membuat koperasi');
  const name = str(body.name, 'nama koperasi', 120);
  const email = str(body.ketuaEmail, 'email ketua', 200);
  const password = str(body.ketuaPassword, 'kata sandi ketua', 100);
  if (password.length < 8) throw new ApiError(400, 'Kata sandi minimal 8 karakter');

  const { token, fs } = context(env, fetchFn);
  const accessToken = await token();
  const kid = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const uid = await createAuthUser(env.FIREBASE_PROJECT_ID, accessToken, { email, password, displayName: 'Ketua' }, fetchFn);
  try {
    await setCustomClaims(env.FIREBASE_PROJECT_ID, accessToken, uid, { kid, role: 'ketua', mid: '' }, fetchFn);
    await fs.commit([
      {
        path: `koperasi/${kid}`,
        data: {
          name,
          createdAt: new Date().toISOString(),
          createdByUid: caller.uid,
          approvalPolicy: DEFAULT_APPROVAL_POLICY,
          withdrawalRules: { pokok: false, wajib: false, sukarela: true },
          timeZone: 'Asia/Jakarta',
        },
      },
      { path: `koperasi/${kid}/staff/${uid}`, data: { email, role: 'ketua', memberId: '', active: true } },
    ]);
  } catch (e) {
    // Batalkan: jangan tinggalkan akun Ketua tanpa data koperasi.
    await deleteAuthUser(env.FIREBASE_PROJECT_ID, accessToken, uid, fetchFn).catch(() => undefined);
    throw e;
  }
  return { koperasiId: kid, ketuaUid: uid };
}

export async function createAccount(caller: Caller, body: Record<string, unknown>, env: Env, fetchFn: typeof fetch = fetch) {
  if (!caller.kid || !['ketua', 'sekretaris', 'admin'].includes(caller.role)) {
    throw new ApiError(403, 'Tidak berwenang membuat akun');
  }
  const email = str(body.email, 'email', 200);
  const password = str(body.password, 'kata sandi', 100);
  if (password.length < 8) throw new ApiError(400, 'Kata sandi minimal 8 karakter');
  const role = str(body.role, 'peran', 20);
  const isStaffRole = (ROLES as readonly string[]).includes(role);
  if (role !== 'anggota' && !isStaffRole) throw new ApiError(400, 'Peran tidak dikenal');
  if (role === 'ketua') throw new ApiError(400, 'Akun Ketua dibuat oleh pemilik platform');
  if (isStaffRole && caller.role !== 'ketua') throw new ApiError(403, 'Hanya Ketua yang dapat membuat akun pengurus');

  const { token, fs } = context(env, fetchFn);
  if (!(await fs.get(`koperasi/${caller.kid}`))) {
    throw new ApiError(409, 'Data koperasi tidak ditemukan di database. Hubungi pemilik platform.');
  }
  let memberId = '';
  if (role === 'anggota') {
    memberId = id(body.memberId, 'id anggota');
    const member = await fs.get(`koperasi/${caller.kid}/members/${memberId}`);
    if (!member) throw new ApiError(404, 'Anggota tidak ditemukan');
    if (member.uid) throw new ApiError(409, 'Anggota ini sudah punya akun');
  } else if (body.memberId) {
    memberId = id(body.memberId, 'id anggota');
  }

  const accessToken = await token();
  const uid = await createAuthUser(env.FIREBASE_PROJECT_ID, accessToken, { email, password }, fetchFn);
  try {
    await setCustomClaims(env.FIREBASE_PROJECT_ID, accessToken, uid, { kid: caller.kid, role, mid: memberId }, fetchFn);
    const writes: Parameters<Firestore['commit']>[0] = [
      { path: `koperasi/${caller.kid}/staff/${uid}`, data: { email, role, memberId, active: true } },
    ];
    if (memberId) writes.push({ path: `koperasi/${caller.kid}/members/${memberId}`, data: { uid }, mask: ['uid'], mustExist: true });
    await fs.commit(writes);
  } catch (e) {
    await deleteAuthUser(env.FIREBASE_PROJECT_ID, accessToken, uid, fetchFn).catch(() => undefined);
    throw e;
  }
  return { uid };
}

export async function loanAction(caller: Caller, body: Record<string, unknown>, env: Env, fetchFn: typeof fetch = fetch) {
  if (!caller.kid) throw new ApiError(403, 'Akun belum terhubung ke koperasi');
  const loanId = id(body.loanId, 'id pinjaman');
  const action = str(body.action, 'aksi', 20);
  if (!['verify', 'approve', 'reject', 'disburse', 'cancel'].includes(action)) throw new ApiError(400, 'Aksi tidak dikenal');
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : '';

  const actor: Actor = { uid: caller.uid, role: caller.role as Actor['role'], memberId: caller.mid };
  const { fs } = context(env, fetchFn);
  const koperasiPath = `koperasi/${caller.kid}`;
  const loanPath = `${koperasiPath}/loans/${loanId}`;

  try {
    await fs.runTransaction(async (tx) => {
      const [koperasi, raw] = await Promise.all([tx.get(koperasiPath), tx.get(loanPath)]);
      if (!raw) throw new ApiError(404, 'Pinjaman tidak ditemukan');
      const policy = (koperasi?.approvalPolicy ?? DEFAULT_APPROVAL_POLICY) as ApprovalPolicy;
      const loan = { ...raw, id: loanId } as unknown as Loan;
      const now = new Date().toISOString();

      let next: Loan;
      switch (action) {
        case 'verify':
          next = verify(loan, actor, note, policy, now);
          break;
        case 'approve':
          next = decide(loan, actor, 'approve', note, policy, now);
          break;
        case 'reject':
          next = decide(loan, actor, 'reject', note, policy, now);
          break;
        case 'disburse': {
          const date = str(body.disbursedDate, 'tanggal pencairan', 10);
          if (!DATE_PATTERN.test(date)) throw new ApiError(400, 'Format tanggal pencairan tidak valid');
          next = disburse(loan, actor, date, policy, now);
          break;
        }
        default:
          next = cancel(loan, actor, note, policy, now);
      }

      const { id: _id, ...data } = next;
      tx.set(loanPath, data as unknown as Record<string, unknown>);

      // Pencairan otomatis mencatat kas keluar (pokok dikurangi biaya admin) dan kas masuk biaya admin.
      if (action === 'disburse') {
        const adminFee = Math.round((next.principal * next.adminFeePercent) / 100);
        const date = next.disbursedDate as string;
        tx.set(`${koperasiPath}/cashEntries/loan-${loanId}-out`, {
          date, direction: 'out', category: 'pencairan_pinjaman', amount: next.principal - adminFee,
          note: `Pencairan pinjaman ${loanId}`, ref: loanId, createdByUid: caller.uid,
        });
        // Ringkasan kas untuk anggota: kas keluar (pokok - admin) dan kas masuk (admin).
        tx.increment(`${koperasiPath}/summary/kas`, {
          balance: -(next.principal - adminFee) + adminFee,
          totalIn: adminFee,
          totalOut: next.principal - adminFee,
        }, { updatedAt: now });
        if (adminFee > 0) {
          tx.set(`${koperasiPath}/cashEntries/loan-${loanId}-fee`, {
            date, direction: 'in', category: 'biaya_admin', amount: adminFee,
            note: `Biaya administrasi pinjaman ${loanId}`, ref: loanId, createdByUid: caller.uid,
          });
        }
      }
    });
  } catch (e) {
    if (e instanceof ApprovalError) throw new ApiError(409, e.message);
    throw e;
  }
  return { ok: true };
}
