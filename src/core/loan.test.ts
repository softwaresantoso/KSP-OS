import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, daysBetween } from './dates.ts';
import {
  applyPayments,
  buildSchedule,
  calcPenalty,
  checkEligibility,
  computeDisbursement,
  listArrears,
  outstandingPrincipal,
  scheduleTotals,
} from './loan.ts';
import type { LoanProduct } from './types.ts';

const product: LoanProduct = {
  id: 'p1',
  name: 'Pinjaman Umum',
  interestMethod: 'flat',
  ratePerMonth: 1.5,
  minPrincipal: 500_000,
  maxPrincipal: 20_000_000,
  maxTenorMonths: 24,
  adminFeePercent: 1,
  penalty: { type: 'fixed_per_day', value: 1000, graceDays: 3 },
  maxMultipleOfSavings: 3,
  maxActiveLoans: 1,
  active: true,
};

test('addMonths menjepit ke akhir bulan dan melewati pergantian tahun', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
});

test('daysBetween', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
  assert.equal(daysBetween('2026-02-01', '2026-01-01'), -31);
});

test('jadwal flat: bunga tetap, total pokok tepat', () => {
  const s = buildSchedule({ principal: 10_000_000, tenorMonths: 10, ratePerMonth: 1.5, method: 'flat', firstDueDate: '2026-11-14' });
  assert.equal(s.length, 10);
  assert.ok(s.every((r) => r.interest === 150_000));
  assert.ok(s.every((r) => r.principal === 1_000_000));
  const t = scheduleTotals(s);
  assert.equal(t.principal, 10_000_000);
  assert.equal(t.interest, 1_500_000);
  assert.equal(s[0].dueDate, '2026-11-14');
  assert.equal(s[9].dueDate, '2027-08-14');
});

test('jadwal flat: sisa pembulatan pokok masuk angsuran terakhir', () => {
  const s = buildSchedule({ principal: 1_000_000, tenorMonths: 3, ratePerMonth: 2, method: 'flat', firstDueDate: '2026-11-14' });
  assert.deepEqual(s.map((r) => r.principal), [333_333, 333_333, 333_334]);
  assert.equal(scheduleTotals(s).principal, 1_000_000);
});

test('jadwal menurun: bunga dihitung dari sisa pokok', () => {
  const s = buildSchedule({ principal: 1_200_000, tenorMonths: 4, ratePerMonth: 2, method: 'menurun', firstDueDate: '2026-11-14' });
  assert.deepEqual(s.map((r) => r.interest), [24_000, 18_000, 12_000, 6_000]);
  assert.deepEqual(s.map((r) => r.principal), [300_000, 300_000, 300_000, 300_000]);
  assert.equal(scheduleTotals(s).principal, 1_200_000);
});

test('jadwal: input tidak valid ditolak', () => {
  const base = { principal: 1_000_000, tenorMonths: 6, ratePerMonth: 1, method: 'flat' as const, firstDueDate: '2026-11-14' };
  assert.throws(() => buildSchedule({ ...base, principal: 0 }));
  assert.throws(() => buildSchedule({ ...base, principal: 1000.5 }));
  assert.throws(() => buildSchedule({ ...base, tenorMonths: 0 }));
  assert.throws(() => buildSchedule({ ...base, ratePerMonth: -1 }));
});

test('biaya admin dipotong dari pencairan', () => {
  assert.deepEqual(computeDisbursement(10_000_000, 1), { adminFee: 100_000, netAmount: 9_900_000 });
});

test('alokasi pembayaran: bunga lebih dulu, lalu pokok; kelebihan dilaporkan', () => {
  const s = buildSchedule({ principal: 1_200_000, tenorMonths: 4, ratePerMonth: 2, method: 'menurun', firstDueDate: '2026-11-14' });
  const { rows, excess } = applyPayments(s, [
    { date: '2026-11-14', amount: 324_000 },
    { date: '2026-12-20', amount: 100_000 },
  ]);
  assert.equal(rows[0].outstanding, 0);
  assert.equal(rows[0].paidAt, '2026-11-14');
  assert.equal(rows[1].paid, 100_000);
  assert.equal(rows[1].paidInterest, 18_000);
  assert.equal(rows[1].paidPrincipal, 82_000);
  assert.equal(rows[1].paidAt, null);
  assert.equal(excess, 0);
  assert.equal(outstandingPrincipal(rows), 1_200_000 - 300_000 - 82_000);

  const over = applyPayments(s, [{ date: '2027-01-01', amount: 2_000_000 }]);
  assert.ok(over.rows.every((r) => r.outstanding === 0));
  assert.equal(over.excess, 2_000_000 - scheduleTotals(s).total);
});

test('denda memperhitungkan masa toleransi', () => {
  const fixed = { type: 'fixed_per_day', value: 1000, graceDays: 3 } as const;
  assert.equal(calcPenalty(500_000, 3, fixed), 0);
  assert.equal(calcPenalty(500_000, 10, fixed), 7000);
  const pct = { type: 'percent_per_day', value: 0.1, graceDays: 0 } as const;
  assert.equal(calcPenalty(500_000, 4, pct), 2000);
  assert.equal(calcPenalty(500_000, 40, { type: 'none', value: 0, graceDays: 0 }), 0);
});

test('daftar tunggakan hanya angsuran lewat jatuh tempo yang belum lunas', () => {
  const s = buildSchedule({ principal: 1_200_000, tenorMonths: 4, ratePerMonth: 2, method: 'menurun', firstDueDate: '2026-11-14' });
  const { rows } = applyPayments(s, [{ date: '2026-11-14', amount: 324_000 }]);
  const a = listArrears(rows, '2027-01-20', product.penalty);
  assert.deepEqual(a.items.map((i) => i.no), [2, 3]);
  assert.equal(a.items[0].daysLate, 37);
  assert.equal(a.items[0].penalty, (37 - 3) * 1000);
  assert.equal(a.items[1].daysLate, 6);
  assert.equal(a.items[1].penalty, (6 - 3) * 1000);
  assert.equal(a.totalOutstanding, a.items[0].outstanding + a.items[1].outstanding);
  const none = listArrears(rows, '2026-12-14', product.penalty);
  assert.equal(none.items.length, 0);
});

test('kelayakan pengajuan pinjaman', () => {
  const ok = {
    product,
    principal: 3_000_000,
    tenorMonths: 12,
    memberActive: true,
    totalSavings: 2_000_000,
    activeLoanCount: 0,
    hasArrears: false,
  };
  assert.deepEqual(checkEligibility(ok), []);
  const bad = checkEligibility({ ...ok, principal: 9_000_000, tenorMonths: 30, activeLoanCount: 1, hasArrears: true });
  assert.ok(bad.length >= 4);
  assert.ok(bad.some((r) => r.includes('3x total simpanan')));
});
