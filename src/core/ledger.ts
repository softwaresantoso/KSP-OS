import type { ISODate } from './dates.ts';
import { sum } from './money.ts';

export const CASH_CATEGORIES = [
  'simpanan',
  'pencairan_pinjaman',
  'angsuran_pokok',
  'angsuran_bunga',
  'biaya_admin',
  'denda',
  'operasional',
  'lainnya',
] as const;
export type CashCategory = (typeof CASH_CATEGORIES)[number];

export const CASH_LABELS: Record<CashCategory, string> = {
  simpanan: 'Simpanan anggota',
  pencairan_pinjaman: 'Pencairan pinjaman',
  angsuran_pokok: 'Angsuran pokok',
  angsuran_bunga: 'Angsuran bunga',
  biaya_admin: 'Biaya administrasi',
  denda: 'Denda',
  operasional: 'Biaya operasional',
  lainnya: 'Lainnya',
};

/** Entri buku kas, juga append-only. */
export interface CashEntry {
  id: string;
  date: ISODate;
  direction: 'in' | 'out';
  category: CashCategory;
  amount: number;
  note: string;
  /** Referensi ke dokumen sumber (transaksi simpanan, pinjaman, dll). */
  ref: string | null;
  createdByUid: string;
}

export interface CashSummary {
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  byCategory: Partial<Record<CashCategory, { in: number; out: number }>>;
}

/** Ringkasan kas untuk periode [from, to] (inklusif). Saldo awal = semua entri sebelum `from`. */
export function summarizeCash(entries: readonly CashEntry[], from: ISODate, to: ISODate): CashSummary {
  const signed = (e: CashEntry) => (e.direction === 'in' ? e.amount : -e.amount);
  const before = entries.filter((e) => e.date < from);
  const inPeriod = entries.filter((e) => e.date >= from && e.date <= to);
  const opening = sum(before.map(signed));
  const totalIn = sum(inPeriod.filter((e) => e.direction === 'in').map((e) => e.amount));
  const totalOut = sum(inPeriod.filter((e) => e.direction === 'out').map((e) => e.amount));
  const byCategory: CashSummary['byCategory'] = {};
  for (const e of inPeriod) {
    const slot = (byCategory[e.category] ??= { in: 0, out: 0 });
    slot[e.direction] += e.amount;
  }
  return { opening, totalIn, totalOut, closing: opening + totalIn - totalOut, byCategory };
}
