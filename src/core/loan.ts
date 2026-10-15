import { addMonths, daysBetween, type ISODate } from './dates.ts';
import { assertRupiah, sum } from './money.ts';
import type { InterestMethod, LoanProduct, PenaltyConfig } from './types.ts';

export interface Installment {
  no: number;
  dueDate: ISODate;
  principal: number;
  interest: number;
  total: number;
}

export interface ScheduleInput {
  principal: number;
  tenorMonths: number;
  /** Persen per bulan, mis. 1.5 */
  ratePerMonth: number;
  method: InterestMethod;
  firstDueDate: ISODate;
}

/**
 * Jadwal angsuran.
 * - flat: bunga = pokok awal x tarif, sama setiap bulan.
 * - menurun: bunga = sisa pokok x tarif; pokok dicicil rata.
 * Selisih pembulatan pokok dibebankan ke angsuran terakhir sehingga total pokok selalu tepat.
 */
export function buildSchedule(input: ScheduleInput): Installment[] {
  const { principal, tenorMonths, ratePerMonth, method, firstDueDate } = input;
  assertRupiah(principal, 'Pokok pinjaman');
  if (principal <= 0) throw new Error('Pokok pinjaman harus lebih dari 0');
  if (!Number.isInteger(tenorMonths) || tenorMonths < 1) {
    throw new Error('Tenor harus bilangan bulat minimal 1 bulan');
  }
  if (!(ratePerMonth >= 0)) throw new Error('Bunga tidak boleh negatif');

  const basePrincipal = Math.floor(principal / tenorMonths);
  const rows: Installment[] = [];
  let outstanding = principal;

  for (let i = 0; i < tenorMonths; i++) {
    const isLast = i === tenorMonths - 1;
    const principalPart = isLast ? outstanding : basePrincipal;
    const interestBase = method === 'flat' ? principal : outstanding;
    const interest = Math.round((interestBase * ratePerMonth) / 100);
    rows.push({
      no: i + 1,
      dueDate: addMonths(firstDueDate, i),
      principal: principalPart,
      interest,
      total: principalPart + interest,
    });
    outstanding -= principalPart;
  }
  return rows;
}

export function scheduleTotals(rows: readonly Installment[]) {
  return {
    principal: sum(rows.map((r) => r.principal)),
    interest: sum(rows.map((r) => r.interest)),
    total: sum(rows.map((r) => r.total)),
  };
}

export function computeDisbursement(principal: number, adminFeePercent: number) {
  assertRupiah(principal, 'Pokok pinjaman');
  const adminFee = Math.round((principal * adminFeePercent) / 100);
  return { adminFee, netAmount: principal - adminFee };
}

export interface Payment {
  date: ISODate;
  amount: number;
}

export interface InstallmentStatus extends Installment {
  paid: number;
  paidPrincipal: number;
  paidInterest: number;
  outstanding: number;
  paidAt: ISODate | null;
}

/**
 * Alokasikan pembayaran secara berurutan ke angsuran terlama.
 * Dalam satu angsuran, pembayaran dianggap melunasi bunga lebih dulu, baru pokok.
 */
export function applyPayments(
  schedule: readonly Installment[],
  payments: readonly Payment[],
): { rows: InstallmentStatus[]; excess: number } {
  const sorted = [...payments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let running = 0;
  const cumulative = sorted.map((p) => {
    assertRupiah(p.amount, 'Pembayaran');
    running += p.amount;
    return { date: p.date, cum: running };
  });
  const totalPaid = running;

  let before = 0;
  const rows = schedule.map((inst) => {
    const threshold = before + inst.total;
    const paid = Math.min(inst.total, Math.max(0, totalPaid - before));
    const paidInterest = Math.min(inst.interest, paid);
    const paidPrincipal = paid - paidInterest;
    const outstanding = inst.total - paid;
    const paidAt = outstanding === 0 ? (cumulative.find((c) => c.cum >= threshold)?.date ?? null) : null;
    before = threshold;
    return { ...inst, paid, paidPrincipal, paidInterest, outstanding, paidAt };
  });
  const scheduleTotal = sum(schedule.map((s) => s.total));
  return { rows, excess: Math.max(0, totalPaid - scheduleTotal) };
}

export function outstandingPrincipal(rows: readonly InstallmentStatus[]): number {
  return sum(rows.map((r) => r.principal - r.paidPrincipal));
}

export function calcPenalty(outstanding: number, daysLate: number, cfg: PenaltyConfig): number {
  const days = Math.max(0, daysLate - cfg.graceDays);
  if (cfg.type === 'none' || days === 0) return 0;
  if (cfg.type === 'fixed_per_day') return Math.round(cfg.value * days);
  return Math.round(((outstanding * cfg.value) / 100) * days);
}

export interface ArrearsItem {
  no: number;
  dueDate: ISODate;
  outstanding: number;
  daysLate: number;
  penalty: number;
}

/** Angsuran yang sudah lewat jatuh tempo (setelah asOf) dan belum lunas. */
export function listArrears(
  rows: readonly InstallmentStatus[],
  asOf: ISODate,
  penalty: PenaltyConfig,
): { items: ArrearsItem[]; totalOutstanding: number; totalPenalty: number } {
  const items: ArrearsItem[] = [];
  for (const r of rows) {
    if (r.outstanding <= 0 || r.dueDate >= asOf) continue;
    const daysLate = daysBetween(r.dueDate, asOf);
    items.push({
      no: r.no,
      dueDate: r.dueDate,
      outstanding: r.outstanding,
      daysLate,
      penalty: calcPenalty(r.outstanding, daysLate, penalty),
    });
  }
  return {
    items,
    totalOutstanding: sum(items.map((i) => i.outstanding)),
    totalPenalty: sum(items.map((i) => i.penalty)),
  };
}

export interface EligibilityInput {
  product: LoanProduct;
  principal: number;
  tenorMonths: number;
  memberActive: boolean;
  totalSavings: number;
  activeLoanCount: number;
  hasArrears: boolean;
}

/** Daftar alasan pengajuan tidak memenuhi syarat. Kosong = memenuhi syarat. */
export function checkEligibility(input: EligibilityInput): string[] {
  const { product, principal, tenorMonths } = input;
  const reasons: string[] = [];
  if (!product.active) reasons.push('Produk pinjaman tidak aktif');
  if (!input.memberActive) reasons.push('Anggota tidak berstatus aktif');
  if (!Number.isInteger(principal) || principal <= 0) reasons.push('Jumlah pinjaman tidak valid');
  if (principal < product.minPrincipal) reasons.push('Jumlah pinjaman di bawah batas minimum');
  if (product.maxPrincipal > 0 && principal > product.maxPrincipal) {
    reasons.push('Jumlah pinjaman melebihi batas maksimum produk');
  }
  if (!Number.isInteger(tenorMonths) || tenorMonths < 1) reasons.push('Tenor tidak valid');
  if (tenorMonths > product.maxTenorMonths) reasons.push('Tenor melebihi batas maksimum produk');
  if (product.maxMultipleOfSavings > 0 && principal > input.totalSavings * product.maxMultipleOfSavings) {
    reasons.push(`Jumlah pinjaman melebihi ${product.maxMultipleOfSavings}x total simpanan`);
  }
  if (input.activeLoanCount >= product.maxActiveLoans) {
    reasons.push('Jumlah pinjaman aktif sudah mencapai batas');
  }
  if (input.hasArrears) reasons.push('Masih ada tunggakan angsuran');
  return reasons;
}
