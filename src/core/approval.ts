import { addMonths, type ISODate } from './dates.ts';
import type { Actor, HistoryAction, Loan, LoanStatus, Role } from './types.ts';

export interface ApprovalPolicy {
  /** Pinjaman <= batas ini cukup satu persetujuan. */
  singleApprovalMaxAmount: number;
  /** Peran yang boleh memberi persetujuan tunggal. */
  singleApproverRoles: Role[];
  /** Pinjaman > batas: SETIAP peran di daftar ini harus menyetujui. */
  dualApproverRoles: Role[];
  verifierRoles: Role[];
  disburserRoles: Role[];
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  singleApprovalMaxAmount: 5_000_000,
  singleApproverRoles: ['ketua', 'bendahara'],
  dualApproverRoles: ['ketua', 'bendahara'],
  verifierRoles: ['admin', 'bendahara'],
  disburserRoles: ['bendahara'],
};

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export function approvalMode(principal: number, policy: ApprovalPolicy): 'single' | 'dual' {
  return principal <= policy.singleApprovalMaxAmount ? 'single' : 'dual';
}

export function eligibleApproverRoles(principal: number, policy: ApprovalPolicy): Role[] {
  return approvalMode(principal, policy) === 'single' ? policy.singleApproverRoles : policy.dualApproverRoles;
}

function isStaffRole(role: Actor['role']): role is Role {
  return role !== 'anggota';
}

function isOwnLoan(loan: Loan, actor: Actor): boolean {
  return (!!actor.memberId && actor.memberId === loan.memberId) || actor.uid === loan.requestedByUid;
}

function step(
  loan: Loan,
  actor: Actor,
  action: HistoryAction,
  note: string,
  now: string,
  status: LoanStatus,
  extra: Partial<Loan> = {},
): Loan {
  return {
    ...loan,
    ...extra,
    status,
    history: [...loan.history, { at: now, byUid: actor.uid, role: actor.role, action, note }],
  };
}

function requireStatus(loan: Loan, allowed: LoanStatus[], what: string): void {
  if (!allowed.includes(loan.status)) {
    throw new ApprovalError(`${what} tidak bisa dilakukan pada pinjaman berstatus "${loan.status}"`);
  }
}

function requireRole(actor: Actor, roles: Role[], what: string): Role {
  if (!isStaffRole(actor.role) || !roles.includes(actor.role)) {
    throw new ApprovalError(`Peran Anda tidak berwenang untuk ${what}`);
  }
  return actor.role;
}

export function verify(loan: Loan, actor: Actor, note: string, policy: ApprovalPolicy, now = new Date().toISOString()): Loan {
  requireStatus(loan, ['diajukan'], 'Verifikasi');
  requireRole(actor, policy.verifierRoles, 'memverifikasi pinjaman');
  if (isOwnLoan(loan, actor)) throw new ApprovalError('Pengurus tidak boleh memproses pinjamannya sendiri');
  return step(loan, actor, 'verifikasi', note, now, 'diverifikasi');
}

export function approvalsSatisfied(loan: Loan, policy: ApprovalPolicy): boolean {
  if (approvalMode(loan.principal, policy) === 'single') return loan.approvals.length >= 1;
  const approvedRoles = new Set(loan.approvals.map((a) => a.role));
  return policy.dualApproverRoles.every((r) => approvedRoles.has(r));
}

export function decide(
  loan: Loan,
  actor: Actor,
  decision: 'approve' | 'reject',
  note: string,
  policy: ApprovalPolicy,
  now = new Date().toISOString(),
): Loan {
  requireStatus(loan, ['diverifikasi'], 'Persetujuan');
  const role = requireRole(actor, eligibleApproverRoles(loan.principal, policy), 'menyetujui pinjaman ini');
  if (isOwnLoan(loan, actor)) throw new ApprovalError('Pengurus tidak boleh memproses pinjamannya sendiri');
  if (loan.approvals.some((a) => a.uid === actor.uid || a.role === role)) {
    throw new ApprovalError('Anda (atau peran Anda) sudah memberi persetujuan');
  }

  if (decision === 'reject') {
    if (note.trim() === '') throw new ApprovalError('Alasan penolakan wajib diisi');
    return step(loan, actor, 'tolak', note, now, 'ditolak');
  }

  const withApproval: Loan = {
    ...loan,
    approvals: [...loan.approvals, { uid: actor.uid, role, at: now, note }],
  };
  const status: LoanStatus = approvalsSatisfied(withApproval, policy) ? 'disetujui' : 'diverifikasi';
  return step(withApproval, actor, 'setujui', note, now, status);
}

export function disburse(
  loan: Loan,
  actor: Actor,
  disbursedDate: ISODate,
  policy: ApprovalPolicy,
  now = new Date().toISOString(),
): Loan {
  requireStatus(loan, ['disetujui'], 'Pencairan');
  requireRole(actor, policy.disburserRoles, 'mencairkan pinjaman');
  if (isOwnLoan(loan, actor)) throw new ApprovalError('Pengurus tidak boleh memproses pinjamannya sendiri');
  return step(loan, actor, 'cairkan', '', now, 'dicairkan', {
    disbursedDate,
    firstDueDate: addMonths(disbursedDate, 1),
  });
}

export function cancel(loan: Loan, actor: Actor, note: string, policy: ApprovalPolicy, now = new Date().toISOString()): Loan {
  if (actor.role === 'anggota') {
    if (actor.memberId !== loan.memberId) throw new ApprovalError('Hanya pemilik pengajuan yang bisa membatalkan');
    requireStatus(loan, ['diajukan'], 'Pembatalan oleh anggota');
  } else {
    requireStatus(loan, ['diajukan', 'diverifikasi', 'disetujui'], 'Pembatalan');
    requireRole(actor, [...new Set<Role>([...policy.verifierRoles, 'ketua'])], 'membatalkan pinjaman');
  }
  return step(loan, actor, 'batalkan', note, now, 'dibatalkan');
}
