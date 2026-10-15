import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalError, DEFAULT_APPROVAL_POLICY as policy, cancel, decide, disburse, verify } from './approval.ts';
import { can } from './permissions.ts';
import type { Actor, Loan } from './types.ts';

const NOW = '2026-10-14T10:00:00.000Z';

function newLoan(principal: number): Loan {
  return {
    id: 'L1',
    memberId: 'M1',
    productId: 'p1',
    principal,
    tenorMonths: 12,
    interestMethod: 'flat',
    ratePerMonth: 1.5,
    adminFeePercent: 1,
    penalty: { type: 'none', value: 0, graceDays: 0 },
    purpose: 'Modal usaha',
    status: 'diajukan',
    requestedByUid: 'uid-member1',
    requestedAt: NOW,
    approvals: [],
    history: [],
  };
}

const kasir: Actor = { uid: 'u-kasir', role: 'admin' };
const ketua: Actor = { uid: 'u-ketua', role: 'ketua' };
const bendahara: Actor = { uid: 'u-bend', role: 'bendahara' };
const sekretaris: Actor = { uid: 'u-sek', role: 'sekretaris' };

test('alur pinjaman kecil: satu persetujuan cukup', () => {
  let loan = verify(newLoan(3_000_000), kasir, 'Dokumen lengkap', policy, NOW);
  assert.equal(loan.status, 'diverifikasi');
  loan = decide(loan, ketua, 'approve', 'OK', policy, NOW);
  assert.equal(loan.status, 'disetujui');
  loan = disburse(loan, bendahara, '2026-10-15', policy, NOW);
  assert.equal(loan.status, 'dicairkan');
  assert.equal(loan.firstDueDate, '2026-11-15');
  assert.deepEqual(loan.history.map((h) => h.action), ['verifikasi', 'setujui', 'cairkan']);
});

test('pinjaman besar: perlu Ketua dan Bendahara', () => {
  let loan = verify(newLoan(10_000_000), kasir, '', policy, NOW);
  loan = decide(loan, ketua, 'approve', '', policy, NOW);
  assert.equal(loan.status, 'diverifikasi');
  assert.throws(() => disburse(loan, bendahara, '2026-10-15', policy, NOW), ApprovalError);
  loan = decide(loan, bendahara, 'approve', '', policy, NOW);
  assert.equal(loan.status, 'disetujui');
});

test('persetujuan ganda oleh orang/peran yang sama ditolak', () => {
  let loan = verify(newLoan(10_000_000), kasir, '', policy, NOW);
  loan = decide(loan, ketua, 'approve', '', policy, NOW);
  assert.throws(() => decide(loan, ketua, 'approve', '', policy, NOW), ApprovalError);
});

test('peran yang tidak berwenang ditolak', () => {
  assert.throws(() => verify(newLoan(1_000_000), sekretaris, '', policy, NOW), ApprovalError);
  assert.throws(() => verify(newLoan(1_000_000), ketua, '', policy, NOW), ApprovalError);
  const verified = verify(newLoan(1_000_000), kasir, '', policy, NOW);
  assert.throws(() => decide(verified, kasir, 'approve', '', policy, NOW), ApprovalError);
  assert.throws(() => decide(verified, { uid: 'x', role: 'anggota' }, 'approve', '', policy, NOW), ApprovalError);
});

test('pengurus tidak boleh memproses pinjamannya sendiri', () => {
  const own = newLoan(1_000_000);
  const bendaharaSebagaiAnggota: Actor = { uid: 'u-bend', role: 'bendahara', memberId: 'M1' };
  assert.throws(() => verify(own, bendaharaSebagaiAnggota, '', policy, NOW), /sendiri/);
  const verified = verify(own, kasir, '', policy, NOW);
  assert.throws(() => decide(verified, bendaharaSebagaiAnggota, 'approve', '', policy, NOW), /sendiri/);
});

test('penolakan wajib beralasan dan mengakhiri alur', () => {
  const verified = verify(newLoan(1_000_000), kasir, '', policy, NOW);
  assert.throws(() => decide(verified, ketua, 'reject', '  ', policy, NOW), /Alasan/);
  const rejected = decide(verified, ketua, 'reject', 'Tunggakan sebelumnya', policy, NOW);
  assert.equal(rejected.status, 'ditolak');
  assert.throws(() => decide(rejected, bendahara, 'approve', '', policy, NOW), ApprovalError);
});

test('urutan status dijaga: tidak bisa cairkan sebelum disetujui', () => {
  assert.throws(() => disburse(newLoan(1_000_000), bendahara, '2026-10-15', policy, NOW), ApprovalError);
  assert.throws(() => decide(newLoan(1_000_000), ketua, 'approve', '', policy, NOW), ApprovalError);
});

test('pembatalan: anggota hanya sebelum diverifikasi', () => {
  const member: Actor = { uid: 'uid-member1', role: 'anggota', memberId: 'M1' };
  const other: Actor = { uid: 'uid-member2', role: 'anggota', memberId: 'M2' };
  assert.throws(() => cancel(newLoan(1_000_000), other, '', policy, NOW), ApprovalError);
  assert.equal(cancel(newLoan(1_000_000), member, 'Batal', policy, NOW).status, 'dibatalkan');
  const verified = verify(newLoan(1_000_000), kasir, '', policy, NOW);
  assert.throws(() => cancel(verified, member, '', policy, NOW), ApprovalError);
  assert.equal(cancel(verified, ketua, 'Atas permintaan', policy, NOW).status, 'dibatalkan');
});

test('matriks hak akses', () => {
  assert.equal(can('bendahara', 'loan.disburse'), true);
  assert.equal(can('admin', 'loan.disburse'), false);
  assert.equal(can('sekretaris', 'savings.record'), false);
  assert.equal(can('anggota', 'report.view'), false);
  assert.equal(can(null, 'report.view'), false);
});
