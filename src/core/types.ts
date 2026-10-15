import type { ISODate } from './dates.ts';

export const ROLES = ['ketua', 'sekretaris', 'bendahara', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ketua: 'Ketua',
  sekretaris: 'Sekretaris',
  bendahara: 'Bendahara',
  admin: 'Admin/Kasir',
};

export const SAVINGS_TYPES = ['pokok', 'wajib', 'sukarela'] as const;
export type SavingsType = (typeof SAVINGS_TYPES)[number];

export const SAVINGS_LABELS: Record<SavingsType, string> = {
  pokok: 'Simpanan Pokok',
  wajib: 'Simpanan Wajib',
  sukarela: 'Simpanan Sukarela',
};

export type InterestMethod = 'flat' | 'menurun';

export interface PenaltyConfig {
  type: 'none' | 'fixed_per_day' | 'percent_per_day';
  /** Rupiah per hari (fixed_per_day) atau persen angsuran per hari (percent_per_day). */
  value: number;
  /** Hari toleransi sebelum denda dihitung. */
  graceDays: number;
}

export interface LoanProduct {
  id: string;
  name: string;
  interestMethod: InterestMethod;
  /** Bunga per bulan dalam persen, mis. 1.5 = 1,5% per bulan. */
  ratePerMonth: number;
  minPrincipal: number;
  maxPrincipal: number;
  maxTenorMonths: number;
  /** Biaya administrasi/provisi dalam persen dari pokok, dipotong saat pencairan. */
  adminFeePercent: number;
  penalty: PenaltyConfig;
  /** Batas pinjaman = kelipatan total simpanan anggota. 0 = tanpa batas. */
  maxMultipleOfSavings: number;
  /** Jumlah pinjaman aktif yang boleh dimiliki satu anggota sekaligus. */
  maxActiveLoans: number;
  active: boolean;
}

export type LoanStatus =
  | 'diajukan'
  | 'diverifikasi'
  | 'disetujui'
  | 'dicairkan'
  | 'lunas'
  | 'ditolak'
  | 'dibatalkan';

export type ActorRole = Role | 'anggota';

export type HistoryAction =
  | 'ajukan'
  | 'verifikasi'
  | 'setujui'
  | 'tolak'
  | 'cairkan'
  | 'batalkan';

export interface HistoryEntry {
  at: string;
  byUid: string;
  role: ActorRole;
  action: HistoryAction;
  note: string;
}

export interface Approval {
  uid: string;
  role: Role;
  at: string;
  note: string;
}

export interface Loan {
  id: string;
  memberId: string;
  productId: string;
  principal: number;
  tenorMonths: number;
  /** Disalin dari produk saat pengajuan agar perubahan produk tidak mengubah pinjaman berjalan. */
  interestMethod: InterestMethod;
  ratePerMonth: number;
  adminFeePercent: number;
  penalty: PenaltyConfig;
  purpose: string;
  status: LoanStatus;
  requestedByUid: string;
  requestedAt: string;
  approvals: Approval[];
  history: HistoryEntry[];
  disbursedDate?: ISODate | null;
  firstDueDate?: ISODate | null;
}

export interface Actor {
  uid: string;
  role: ActorRole;
  /** Jika pengurus juga terdaftar sebagai anggota. */
  memberId?: string | null;
}
