import { assertRupiah, sum } from './money.ts';

/**
 * Komponen pembagian SHU sesuai AD/ART. Persentase dapat diatur per koperasi lewat UI.
 * Total persentase semua komponen harus tepat 100.
 */
export interface ShuConfig {
  cadangan: number;
  jasaSimpanan: number;
  jasaTransaksi: number;
  pengurus: number;
  pegawai: number;
  danaPendidikan: number;
  danaSosial: number;
  danaPembangunan: number;
}

export const SHU_COMPONENT_LABELS: Record<keyof ShuConfig, string> = {
  cadangan: 'Cadangan koperasi',
  jasaSimpanan: 'Jasa simpanan anggota',
  jasaTransaksi: 'Jasa transaksi (pinjaman) anggota',
  pengurus: 'Pengurus dan pengawas',
  pegawai: 'Pegawai/karyawan',
  danaPendidikan: 'Dana pendidikan',
  danaSosial: 'Dana sosial',
  danaPembangunan: 'Dana pembangunan lingkungan',
};

/** Contoh awal saja. Koperasi wajib mengisi sesuai AD/ART masing-masing. */
export const EXAMPLE_SHU_CONFIG: ShuConfig = {
  cadangan: 40,
  jasaSimpanan: 25,
  jasaTransaksi: 20,
  pengurus: 5,
  pegawai: 0,
  danaPendidikan: 5,
  danaSosial: 5,
  danaPembangunan: 0,
};

export interface MemberShuBasis {
  memberId: string;
  /** Dasar jasa simpanan, mis. rata-rata saldo simpanan selama tahun buku. */
  savingsBasis: number;
  /** Dasar jasa transaksi, mis. total bunga/jasa pinjaman yang dibayar anggota selama tahun buku. */
  transactionBasis: number;
}

export interface ShuMemberResult {
  memberId: string;
  jasaSimpanan: number;
  jasaTransaksi: number;
  total: number;
}

export interface ShuResult {
  shuTotal: number;
  allocations: Record<keyof ShuConfig, number>;
  members: ShuMemberResult[];
  /** Sisa pembulatan Rupiah yang tidak terbagi ke anggota (masuk cadangan atau ditahan). */
  unallocatedRemainder: number;
}

export function validateShuConfig(cfg: ShuConfig): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(cfg)) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      errors.push(`Persentase "${SHU_COMPONENT_LABELS[key as keyof ShuConfig]}" harus antara 0 dan 100`);
    }
  }
  const total = sum(Object.values(cfg));
  if (Math.abs(total - 100) > 1e-9) {
    errors.push(`Total persentase harus 100% (saat ini ${Number(total.toFixed(4))}%)`);
  }
  return errors;
}

/** Bagi `amount` proporsional ke bobot, dengan metode sisa terbesar agar total pas. */
function distribute(amount: number, weights: readonly number[]): number[] {
  const totalWeight = sum(weights);
  if (amount <= 0 || totalWeight <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / totalWeight);
  const floors = raw.map(Math.floor);
  let remainder = amount - sum(floors);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    if (weights[i] > 0) {
      floors[i] += 1;
      remainder -= 1;
    }
  }
  return floors;
}

/**
 * Hitung (estimasi) SHU. `shuTotal` = laba bersih tahun buku; bila negatif/nol, semua alokasi 0.
 * Jika tidak ada dasar jasa (mis. tidak ada anggota meminjam), porsi jasa itu tidak terbagi
 * dan dilaporkan di `unallocatedRemainder` agar pengurus memutuskan perlakuannya.
 */
export function computeShu(shuTotal: number, cfg: ShuConfig, members: readonly MemberShuBasis[]): ShuResult {
  assertRupiah(shuTotal, 'SHU');
  const errors = validateShuConfig(cfg);
  if (errors.length > 0) throw new Error(errors.join('; '));

  const keys = Object.keys(cfg) as (keyof ShuConfig)[];
  const positive = Math.max(0, shuTotal);
  const nominal = distribute(positive, keys.map((k) => cfg[k]));
  const allocations = Object.fromEntries(keys.map((k, i) => [k, nominal[i]])) as Record<keyof ShuConfig, number>;

  const savingsShares = distribute(allocations.jasaSimpanan, members.map((m) => Math.max(0, m.savingsBasis)));
  const transactionShares = distribute(allocations.jasaTransaksi, members.map((m) => Math.max(0, m.transactionBasis)));

  const results: ShuMemberResult[] = members.map((m, i) => ({
    memberId: m.memberId,
    jasaSimpanan: savingsShares[i],
    jasaTransaksi: transactionShares[i],
    total: savingsShares[i] + transactionShares[i],
  }));

  const distributed = sum(results.map((r) => r.total));
  return {
    shuTotal: positive,
    allocations,
    members: results,
    unallocatedRemainder: allocations.jasaSimpanan + allocations.jasaTransaksi - distributed,
  };
}
