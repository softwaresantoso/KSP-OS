/** Semua nilai uang disimpan sebagai bilangan bulat Rupiah (tanpa desimal). */

export function assertRupiah(value: number, label = 'Jumlah'): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} harus berupa bilangan bulat Rupiah`);
  }
}

export function formatRupiah(value: number): string {
  const formatted = new Intl.NumberFormat('id-ID').format(Math.abs(value));
  return `${value < 0 ? '-' : ''}Rp ${formatted}`;
}

/** Ubah teks seperti "Rp 1.500.000" atau "1500000" menjadi angka. Kosong -> 0. */
export function parseRupiah(text: string): number {
  const negative = text.trim().startsWith('-');
  const digits = text.replace(/[^\d]/g, '');
  if (digits === '') return 0;
  const n = Number(digits);
  return negative ? -n : n;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
