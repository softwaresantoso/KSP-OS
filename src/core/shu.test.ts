import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE_SHU_CONFIG, computeShu, validateShuConfig, type ShuConfig } from './shu.ts';

test('konfigurasi harus berjumlah 100%', () => {
  assert.deepEqual(validateShuConfig(EXAMPLE_SHU_CONFIG), []);
  assert.ok(validateShuConfig({ ...EXAMPLE_SHU_CONFIG, cadangan: 50 }).length > 0);
  assert.ok(validateShuConfig({ ...EXAMPLE_SHU_CONFIG, sosial: -5 } as unknown as ShuConfig).length > 0);
});

test('SHU dibagi sesuai persentase dan total anggota pas tanpa selisih', () => {
  const members = [
    { memberId: 'A', savingsBasis: 1_000_000, transactionBasis: 100_000 },
    { memberId: 'B', savingsBasis: 2_000_000, transactionBasis: 0 },
    { memberId: 'C', savingsBasis: 3_000_000, transactionBasis: 300_000 },
  ];
  const r = computeShu(10_000_000, EXAMPLE_SHU_CONFIG, members);
  assert.equal(r.allocations.cadangan, 4_000_000);
  assert.equal(r.allocations.jasaSimpanan, 2_500_000);
  assert.equal(r.allocations.jasaTransaksi, 2_000_000);
  assert.equal(Object.values(r.allocations).reduce((a, b) => a + b, 0), 10_000_000);
  const sumSavings = r.members.reduce((a, m) => a + m.jasaSimpanan, 0);
  const sumTx = r.members.reduce((a, m) => a + m.jasaTransaksi, 0);
  assert.equal(sumSavings, 2_500_000);
  assert.equal(sumTx, 2_000_000);
  assert.equal(r.unallocatedRemainder, 0);
  assert.equal(r.members[1].jasaTransaksi, 0);
  assert.ok(r.members[2].jasaSimpanan > r.members[0].jasaSimpanan);
});

test('pembulatan tidak menyisakan selisih Rupiah', () => {
  const members = ['A', 'B', 'C'].map((id) => ({ memberId: id, savingsBasis: 1, transactionBasis: 1 }));
  const r = computeShu(1_000_001, EXAMPLE_SHU_CONFIG, members);
  assert.equal(Object.values(r.allocations).reduce((a, b) => a + b, 0), 1_000_001);
  assert.equal(r.members.reduce((a, m) => a + m.jasaSimpanan, 0), r.allocations.jasaSimpanan);
});

test('tanpa dasar jasa, porsi dilaporkan sebagai sisa; laba nol/negatif menghasilkan 0', () => {
  const none = computeShu(1_000_000, EXAMPLE_SHU_CONFIG, [{ memberId: 'A', savingsBasis: 100, transactionBasis: 0 }]);
  assert.equal(none.members[0].jasaTransaksi, 0);
  assert.equal(none.unallocatedRemainder, none.allocations.jasaTransaksi);
  const loss = computeShu(-500_000, EXAMPLE_SHU_CONFIG, [{ memberId: 'A', savingsBasis: 100, transactionBasis: 100 }]);
  assert.equal(loss.shuTotal, 0);
  assert.equal(loss.members[0].total, 0);
});

test('konfigurasi tidak valid ditolak saat menghitung', () => {
  assert.throws(() => computeShu(1_000_000, { ...EXAMPLE_SHU_CONFIG, cadangan: 10 }, []));
});
