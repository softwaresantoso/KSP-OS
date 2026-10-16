import { addMonths, daysBetween, isValidDate, todayISO, type ISODate } from './dates.ts';

export type SubscriptionPlan = 'trial' | 'berlangganan';

/** Disimpan di koperasi/{kid}.subscription. Hanya diubah oleh pemilik platform lewat Worker. */
export interface Subscription {
  plan: SubscriptionPlan;
  /** Hari terakhir langganan/percobaan masih aktif penuh (WIB). */
  validUntil: ISODate;
  /** Hari tenggang setelah validUntil: masih bisa dipakai tetapi diberi peringatan. */
  graceDays: number;
  /** Waktu (epoch ms) mulai terkunci hanya-baca. Dibaca oleh Security Rules. */
  lockAtMs: number;
  /** Tarif per bulan (Rp) yang ditetapkan pemilik platform untuk koperasi ini. */
  monthlyFee?: number;
  /** Lama periode tagihan (bulan); tagihan = monthlyFee x billingMonths. */
  billingMonths?: number;
  /** Petunjuk pembayaran (rekening/QRIS, kontak konfirmasi). */
  paymentNote?: string;
}

export const BILLING_MONTH_OPTIONS = [1, 3, 6, 12, 24] as const;

export interface Billing {
  monthlyFee?: number;
  billingMonths?: number;
  paymentNote?: string;
}

/** Ambil data tagihan dari langganan lama agar tidak hilang saat masa berlaku diubah. */
export function pickBilling(sub: Subscription | null | undefined): Billing {
  const out: Billing = {};
  if (sub?.monthlyFee !== undefined) out.monthlyFee = sub.monthlyFee;
  if (sub?.billingMonths !== undefined) out.billingMonths = sub.billingMonths;
  if (sub?.paymentNote !== undefined) out.paymentNote = sub.paymentNote;
  return out;
}

export interface Invoice {
  /** Nominal tagihan perpanjangan berikutnya (Rp). */
  amount: number;
  months: number;
  /** Batas pembayaran = tanggal berakhirnya masa aktif. */
  dueDate: ISODate;
}

/** Tagihan berikutnya; null bila tarif belum ditetapkan. */
export function invoiceOf(sub: Subscription | null | undefined): Invoice | null {
  if (!sub || sub.monthlyFee === undefined || sub.monthlyFee <= 0) return null;
  const months = sub.billingMonths && sub.billingMonths > 0 ? sub.billingMonths : 12;
  return { amount: sub.monthlyFee * months, months, dueDate: sub.validUntil };
}

export const TRIAL_DAYS = 14;
export const PAID_GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

export function addDays(date: ISODate, n: number): ISODate {
  if (!isValidDate(date)) throw new Error(`Tanggal tidak valid: ${date}`);
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Akhir hari (23:59:59.999 WIB) untuk tanggal tertentu, dalam epoch ms. */
export function endOfDayWibMs(date: ISODate): number {
  if (!isValidDate(date)) throw new Error(`Tanggal tidak valid: ${date}`);
  return Date.parse(`${date}T23:59:59.999+07:00`);
}

export function makeSubscription(plan: SubscriptionPlan, validUntil: ISODate, billing: Billing = {}): Subscription {
  const graceDays = plan === 'trial' ? 0 : PAID_GRACE_DAYS;
  return { plan, validUntil, graceDays, lockAtMs: endOfDayWibMs(validUntil) + graceDays * DAY_MS, ...billing };
}

/** Percobaan gratis 14 hari: hari ini + 14 hari. */
export function startTrial(today: ISODate = todayISO(), billing: Billing = {}): Subscription {
  return makeSubscription('trial', addDays(today, TRIAL_DAYS), billing);
}

/** Perpanjang `months` bulan dari tanggal akhir saat ini (atau dari hari ini bila sudah lewat). */
export function extendSubscription(current: Subscription | null | undefined, months: number, today: ISODate = todayISO()): Subscription {
  if (!Number.isInteger(months) || months < 1 || months > 36) throw new Error('Jumlah bulan tidak valid');
  const base = current && daysBetween(today, current.validUntil) >= 0 ? current.validUntil : today;
  return makeSubscription('berlangganan', addMonths(base, months), pickBilling(current));
}

export type SubscriptionState = 'tanpa_batas' | 'trial' | 'aktif' | 'segera_berakhir' | 'tenggang' | 'terkunci';

export interface SubscriptionStatus {
  state: SubscriptionState;
  /** Sisa hari sampai validUntil (negatif bila sudah lewat). */
  daysLeft: number | null;
  /** true bila pencatatan/pengubahan data masih diizinkan. */
  writable: boolean;
}

export function subscriptionStatus(sub: Subscription | null | undefined, now: Date = new Date()): SubscriptionStatus {
  if (!sub) return { state: 'tanpa_batas', daysLeft: null, writable: true };
  const daysLeft = daysBetween(todayISO('Asia/Jakarta', now), sub.validUntil);
  if (now.getTime() >= sub.lockAtMs) return { state: 'terkunci', daysLeft, writable: false };
  if (daysLeft < 0) return { state: 'tenggang', daysLeft, writable: true };
  if (sub.plan === 'trial') return { state: 'trial', daysLeft, writable: true };
  return { state: daysLeft <= 14 ? 'segera_berakhir' : 'aktif', daysLeft, writable: true };
}

export const SUBSCRIPTION_STATE_LABELS: Record<SubscriptionState, string> = {
  tanpa_batas: 'Belum diatur',
  trial: 'Percobaan gratis',
  aktif: 'Aktif',
  segera_berakhir: 'Segera berakhir',
  tenggang: 'Masa tenggang',
  terkunci: 'Terkunci (hanya-baca)',
};
