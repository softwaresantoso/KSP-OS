/** Tanggal disimpan sebagai string 'YYYY-MM-DD' (tanpa zona waktu) agar konsisten. */
export type ISODate = string;

interface Parts {
  y: number;
  m: number;
  d: number;
}

function parse(date: ISODate): Parts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Tanggal tidak valid: ${date}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new Error(`Tanggal tidak valid: ${date}`);
  }
  return { y, m, d };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function toISO(y: number, m: number, d: number): ISODate {
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Tambah n bulan; jika hari tidak ada di bulan tujuan, dipakai hari terakhir bulan itu. */
export function addMonths(date: ISODate, n: number): ISODate {
  const { y, m, d } = parse(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (((total % 12) + 12) % 12) + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Selisih hari (b - a). Positif jika b setelah a. */
export function daysBetween(a: ISODate, b: ISODate): number {
  const pa = parse(a);
  const pb = parse(b);
  const ta = Date.UTC(pa.y, pa.m - 1, pa.d);
  const tb = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((tb - ta) / 86_400_000);
}

export function isValidDate(date: string): boolean {
  try {
    parse(date);
    return true;
  } catch {
    return false;
  }
}

/** Tanggal hari ini menurut zona waktu tertentu (default WIB-Jakarta). */
export function todayISO(timeZone = 'Asia/Jakarta', now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
