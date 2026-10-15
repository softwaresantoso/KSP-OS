import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCash, type CashEntry } from './ledger.ts';
import { formatRupiah, parseRupiah } from './money.ts';
import {
  SavingsError,
  balancesByMember,
  balancesOf,
  buildReversal,
  totalSavings,
  validateNewTx,
  type SavingsTx,
} from './savings.ts';

function tx(over: Partial<SavingsTx>): SavingsTx {
  return {
    id: 't',
    memberId: 'M1',
    savingsType: 'sukarela',
    direction: 'in',
    amount: 100_000,
    date: '2026-10-01',
    note: '',
    reversalOf: null,
    createdByUid: 'u',
    ...over,
  };
}

test('saldo dihitung per anggota dan jenis simpanan', () => {
  const txs = [
    tx({ id: '1', savingsType: 'pokok', amount: 100_000 }),
    tx({ id: '2', savingsType: 'wajib', amount: 50_000 }),
    tx({ id: '3', savingsType: 'wajib', amount: 50_000 }),
    tx({ id: '4', savingsType: 'sukarela', amount: 300_000 }),
    tx({ id: '5', savingsType: 'sukarela', amount: 120_000, direction: 'out' }),
    tx({ id: '6', memberId: 'M2', amount: 10_000 }),
  ];
  const b = balancesOf(txs, 'M1');
  assert.deepEqual(b, { pokok: 100_000, wajib: 100_000, sukarela: 180_000 });
  assert.equal(totalSavings(b), 380_000);
  assert.equal(balancesByMember(txs).M2.sukarela, 10_000);
});

test('penarikan: pokok/wajib terkunci, sukarela tidak boleh melebihi saldo', () => {
  const txs = [tx({ id: '1', savingsType: 'sukarela', amount: 200_000 }), tx({ id: '2', savingsType: 'pokok', amount: 100_000 })];
  assert.throws(() => validateNewTx({ memberId: 'M1', savingsType: 'pokok', direction: 'out', amount: 1000 }, txs), SavingsError);
  assert.throws(() => validateNewTx({ memberId: 'M1', savingsType: 'sukarela', direction: 'out', amount: 200_001 }, txs), /Saldo/);
  assert.doesNotThrow(() => validateNewTx({ memberId: 'M1', savingsType: 'sukarela', direction: 'out', amount: 200_000 }, txs));
  assert.throws(() => validateNewTx({ memberId: 'M1', savingsType: 'sukarela', direction: 'in', amount: 0 }, txs));
  assert.throws(() => validateNewTx({ memberId: 'M1', savingsType: 'sukarela', direction: 'in', amount: 10.5 }, txs));
});

test('koreksi lewat transaksi pembalik, hanya sekali', () => {
  const original = tx({ id: 'A', savingsType: 'wajib', amount: 50_000 });
  const rev = buildReversal(original, [original], { id: 'B', date: '2026-10-02', byUid: 'u2', note: 'Salah input' });
  assert.equal(rev.direction, 'out');
  assert.equal(rev.reversalOf, 'A');
  assert.equal(balancesOf([original, rev], 'M1').wajib, 0);
  assert.throws(() => buildReversal(original, [original, rev], { id: 'C', date: '2026-10-03', byUid: 'u2', note: '' }), /sudah pernah/);
  assert.throws(() => buildReversal(rev, [original, rev], { id: 'D', date: '2026-10-03', byUid: 'u2', note: '' }), /tidak bisa dibalik/);
});

test('koreksi setoran ditolak jika saldo sudah ditarik', () => {
  const dep = tx({ id: 'A', amount: 100_000 });
  const wd = tx({ id: 'W', amount: 80_000, direction: 'out' });
  assert.throws(() => buildReversal(dep, [dep, wd], { id: 'R', date: '2026-10-03', byUid: 'u', note: '' }), /Saldo tidak cukup/);
});

test('ringkasan buku kas per periode', () => {
  const e = (id: string, date: string, direction: 'in' | 'out', amount: number, category: CashEntry['category']): CashEntry => ({
    id, date, direction, amount, category, note: '', ref: null, createdByUid: 'u',
  });
  const entries = [
    e('1', '2026-09-30', 'in', 1_000_000, 'simpanan'),
    e('2', '2026-10-02', 'in', 500_000, 'simpanan'),
    e('3', '2026-10-05', 'out', 300_000, 'operasional'),
    e('4', '2026-11-01', 'in', 999, 'lainnya'),
  ];
  const s = summarizeCash(entries, '2026-10-01', '2026-10-31');
  assert.equal(s.opening, 1_000_000);
  assert.equal(s.totalIn, 500_000);
  assert.equal(s.totalOut, 300_000);
  assert.equal(s.closing, 1_200_000);
  assert.deepEqual(s.byCategory.operasional, { in: 0, out: 300_000 });
});

test('format dan parse Rupiah', () => {
  assert.match(formatRupiah(1_500_000), /^Rp\s1\.500\.000$/);
  assert.equal(parseRupiah('Rp 1.500.000'), 1_500_000);
  assert.equal(parseRupiah(''), 0);
});
