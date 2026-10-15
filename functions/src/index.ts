import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import {
  ApprovalError,
  DEFAULT_APPROVAL_POLICY,
  cancel,
  decide,
  disburse,
  verify,
  type ApprovalPolicy,
} from '../../src/core/approval.ts';
import { ROLES, type Actor, type Loan, type Role } from '../../src/core/types.ts';

initializeApp();
const db = getFirestore();
const auth = getAuth();

const REGION = 'asia-southeast2'; // Jakarta

function requireAuth(req: CallableRequest): { uid: string; kid: string; role: string; mid: string | null } {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Silakan login terlebih dahulu');
  const t = req.auth.token as Record<string, unknown>;
  return {
    uid: req.auth.uid,
    kid: typeof t.kid === 'string' ? t.kid : '',
    role: typeof t.role === 'string' ? t.role : '',
    mid: typeof t.mid === 'string' && t.mid !== '' ? t.mid : null,
  };
}

function str(v: unknown, name: string, max = 500): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) {
    throw new HttpsError('invalid-argument', `Isian "${name}" tidak valid`);
  }
  return v.trim();
}

/**
 * Membuat koperasi baru beserta akun Ketua pertamanya.
 * Hanya boleh dipanggil oleh PEMILIK PLATFORM (akun dengan custom claim superadmin=true,
 * diset sekali lewat skrip scripts/set-superadmin.mjs).
 */
export const setupKoperasi = onCall({ region: REGION }, async (req) => {
  const caller = requireAuth(req);
  if ((req.auth!.token as Record<string, unknown>).superadmin !== true) {
    throw new HttpsError('permission-denied', 'Hanya pemilik platform yang dapat membuat koperasi');
  }
  const name = str(req.data?.name, 'nama koperasi', 120);
  const email = str(req.data?.ketuaEmail, 'email ketua', 200);
  const password = str(req.data?.ketuaPassword, 'kata sandi ketua', 100);
  if (password.length < 8) throw new HttpsError('invalid-argument', 'Kata sandi minimal 8 karakter');

  const koperasiRef = db.collection('koperasi').doc();
  const user = await auth.createUser({ email, password, displayName: 'Ketua' });
  await auth.setCustomUserClaims(user.uid, { kid: koperasiRef.id, role: 'ketua', mid: '' });
  await koperasiRef.set({
    name,
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: caller.uid,
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    withdrawalRules: { pokok: false, wajib: false, sukarela: true },
    timeZone: 'Asia/Jakarta',
  });
  await koperasiRef.collection('staff').doc(user.uid).set({ email, role: 'ketua', active: true });
  return { koperasiId: koperasiRef.id, ketuaUid: user.uid };
});

/** Pengurus (Sekretaris/Admin) membuat akun login untuk pengurus lain atau anggota. */
export const createAccount = onCall({ region: REGION }, async (req) => {
  const caller = requireAuth(req);
  const isManager = ['ketua', 'sekretaris', 'admin'].includes(caller.role);
  if (!caller.kid || !isManager) throw new HttpsError('permission-denied', 'Tidak berwenang membuat akun');

  const email = str(req.data?.email, 'email', 200);
  const password = str(req.data?.password, 'kata sandi', 100);
  if (password.length < 8) throw new HttpsError('invalid-argument', 'Kata sandi minimal 8 karakter');
  const role = str(req.data?.role, 'peran', 20);
  const isStaffRole = (ROLES as readonly string[]).includes(role);
  if (role !== 'anggota' && !isStaffRole) throw new HttpsError('invalid-argument', 'Peran tidak dikenal');
  // Hanya Ketua yang boleh membuat akun pengurus; Sekretaris/Admin hanya akun anggota.
  if (isStaffRole && caller.role !== 'ketua') {
    throw new HttpsError('permission-denied', 'Hanya Ketua yang dapat membuat akun pengurus');
  }

  let memberId = '';
  if (role === 'anggota') {
    memberId = str(req.data?.memberId, 'id anggota', 100);
    const member = await db.doc(`koperasi/${caller.kid}/members/${memberId}`).get();
    if (!member.exists) throw new HttpsError('not-found', 'Anggota tidak ditemukan');
  } else if (req.data?.memberId) {
    memberId = str(req.data.memberId, 'id anggota', 100); // pengurus yang juga anggota
  }

  const user = await auth.createUser({ email, password });
  await auth.setCustomUserClaims(user.uid, { kid: caller.kid, role, mid: memberId });
  await db.doc(`koperasi/${caller.kid}/staff/${user.uid}`).set({ email, role, memberId, active: true });
  if (memberId) await db.doc(`koperasi/${caller.kid}/members/${memberId}`).update({ uid: user.uid });
  return { uid: user.uid };
});

type LoanActionName = 'verify' | 'approve' | 'reject' | 'disburse' | 'cancel';

/** Semua perpindahan status pinjaman dijalankan di sini dengan logika yang sama dengan unit test. */
export const loanAction = onCall({ region: REGION }, async (req) => {
  const caller = requireAuth(req);
  if (!caller.kid) throw new HttpsError('permission-denied', 'Akun belum terhubung ke koperasi');
  const loanId = str(req.data?.loanId, 'id pinjaman', 100);
  const action = str(req.data?.action, 'aksi', 20) as LoanActionName;
  const note = typeof req.data?.note === 'string' ? req.data.note.slice(0, 500) : '';

  const koperasiRef = db.doc(`koperasi/${caller.kid}`);
  const loanRef = koperasiRef.collection('loans').doc(loanId);

  const actor: Actor = {
    uid: caller.uid,
    role: caller.role as Actor['role'],
    memberId: caller.mid,
  };

  try {
    await db.runTransaction(async (tx) => {
      const [kSnap, lSnap] = await Promise.all([tx.get(koperasiRef), tx.get(loanRef)]);
      if (!lSnap.exists) throw new HttpsError('not-found', 'Pinjaman tidak ditemukan');
      const policy = (kSnap.get('approvalPolicy') ?? DEFAULT_APPROVAL_POLICY) as ApprovalPolicy;
      const loan = { ...(lSnap.data() as Omit<Loan, 'id'>), id: lSnap.id } as Loan;
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
          const date = str(req.data?.disbursedDate, 'tanggal pencairan', 10);
          next = disburse(loan, actor, date, policy, now);
          break;
        }
        case 'cancel':
          next = cancel(loan, actor, note, policy, now);
          break;
        default:
          throw new HttpsError('invalid-argument', 'Aksi tidak dikenal');
      }

      const { id: _id, ...data } = next;
      tx.set(loanRef, data);

      // Pencairan otomatis mencatat kas keluar (netto) dan kas masuk biaya admin.
      if (action === 'disburse') {
        const adminFee = Math.round((next.principal * next.adminFeePercent) / 100);
        const date = next.disbursedDate as string;
        const cash = koperasiRef.collection('cashEntries');
        tx.set(cash.doc(`loan-${loanId}-out`), {
          date, direction: 'out', category: 'pencairan_pinjaman', amount: next.principal - adminFee,
          note: `Pencairan pinjaman ${loanId}`, ref: loanId, createdByUid: caller.uid,
        });
        if (adminFee > 0) {
          tx.set(cash.doc(`loan-${loanId}-fee`), {
            date, direction: 'in', category: 'biaya_admin', amount: adminFee,
            note: `Biaya administrasi pinjaman ${loanId}`, ref: loanId, createdByUid: caller.uid,
          });
        }
      }
    });
  } catch (e) {
    if (e instanceof ApprovalError) throw new HttpsError('failed-precondition', e.message);
    throw e;
  }
  return { ok: true };
});
