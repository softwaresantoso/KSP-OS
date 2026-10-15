import type { ISODate } from './dates.ts';
import { assertRupiah } from './money.ts';
import { SAVINGS_TYPES, type SavingsType } from './types.ts';

/**
 * Transaksi simpanan bersifat append-only: tidak pernah diubah/dihapus.
 * Kesalahan dikoreksi dengan transaksi pembalik (reversalOf).
 */
export interface SavingsTx {
  id: string;
  memberId: string;
  savingsType: SavingsType;
  direction: 'in' | 'out';
  amount: number;
  date: ISODate;
  note: string;
  reversalOf: string | null;
  createdByUid: string;
}

/** true = penarikan diizinkan untuk jenis simpanan tersebut. */
export type WithdrawalRules = Record<SavingsType, boolean>;

export const DEFAULT_WITHDRAWAL_RULES: WithdrawalRules = {
  pokok: false,
  wajib: false,
  sukarela: true,
};

export class SavingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SavingsError';
  }
}

export type MemberBalances = Record<SavingsType, number>;

export function emptyBalances(): MemberBalances {
  return { pokok: 0, wajib: 0, sukarela: 0 };
}

export function balancesOf(txs: readonly SavingsTx[], memberId: string): MemberBalances {
  const result = emptyBalances();
  for (const tx of txs) {
    if (tx.memberId !== memberId) continue;
    result[tx.savingsType] += tx.direction === 'in' ? tx.amount : -tx.amount;
  }
  return result;
}

export function balancesByMember(txs: readonly SavingsTx[]): Record<string, MemberBalances> {
  const result: Record<string, MemberBalances> = {};
  for (const tx of txs) {
    const b = (result[tx.memberId] ??= emptyBalances());
    b[tx.savingsType] += tx.direction === 'in' ? tx.amount : -tx.amount;
  }
  return result;
}

export function totalSavings(b: MemberBalances): number {
  return SAVINGS_TYPES.reduce((acc, t) => acc + b[t], 0);
}

export interface NewTxInput {
  memberId: string;
  savingsType: SavingsType;
  direction: 'in' | 'out';
  amount: number;
}

/** Validasi setoran/penarikan baru terhadap transaksi yang sudah ada. */
export function validateNewTx(
  input: NewTxInput,
  existing: readonly SavingsTx[],
  rules: WithdrawalRules = DEFAULT_WITHDRAWAL_RULES,
): void {
  assertRupiah(input.amount, 'Jumlah');
  if (input.amount <= 0) throw new SavingsError('Jumlah harus lebih dari 0');
  if (input.direction === 'out') {
    if (!rules[input.savingsType]) {
      throw new SavingsError('Jenis simpanan ini tidak dapat ditarik selama menjadi anggota');
    }
    const balance = balancesOf(existing, input.memberId)[input.savingsType];
    if (input.amount > balance) throw new SavingsError('Saldo tidak mencukupi');
  }
}

/** Buat transaksi pembalik untuk mengoreksi transaksi yang salah catat. */
export function buildReversal(
  original: SavingsTx,
  existing: readonly SavingsTx[],
  params: { id: string; date: ISODate; byUid: string; note: string },
): SavingsTx {
  if (original.reversalOf) throw new SavingsError('Transaksi pembalik tidak bisa dibalik lagi');
  if (existing.some((t) => t.reversalOf === original.id)) {
    throw new SavingsError('Transaksi ini sudah pernah dikoreksi');
  }
  const direction = original.direction === 'in' ? 'out' : 'in';
  if (direction === 'out') {
    const balance = balancesOf(existing, original.memberId)[original.savingsType];
    if (original.amount > balance) {
      throw new SavingsError('Saldo tidak cukup untuk koreksi; catat penyesuaian lain terlebih dahulu');
    }
  }
  return {
    id: params.id,
    memberId: original.memberId,
    savingsType: original.savingsType,
    direction,
    amount: original.amount,
    date: params.date,
    note: params.note,
    reversalOf: original.id,
    createdByUid: params.byUid,
  };
}
