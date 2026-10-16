import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, endOfDayWibMs, extendSubscription, makeSubscription, startTrial, subscriptionStatus } from './subscription.ts';

test('trial 14 hari: hari ke-14 masih aktif, hari ke-15 terkunci (tanpa tenggang)', () => {
  const sub = startTrial('2026-10-16');
  assert.equal(sub.validUntil, '2026-10-30');
  assert.equal(sub.graceDays, 0);
  assert.equal(sub.lockAtMs, endOfDayWibMs('2026-10-30'));
  const s1 = subscriptionStatus(sub, new Date('2026-10-30T16:00:00Z')); // 30 Okt 23:00 WIB
  assert.deepEqual([s1.state, s1.writable, s1.daysLeft], ['trial', true, 0]);
  const s2 = subscriptionStatus(sub, new Date('2026-10-30T17:00:00Z')); // 31 Okt 00:00 WIB
  assert.deepEqual([s2.state, s2.writable], ['terkunci', false]);
});

test('langganan berbayar: peringatan 14 hari, tenggang 7 hari, lalu terkunci', () => {
  const sub = makeSubscription('berlangganan', '2026-12-31');
  assert.equal(subscriptionStatus(sub, new Date('2026-10-16T01:00:00Z')).state, 'aktif');
  assert.equal(subscriptionStatus(sub, new Date('2026-12-20T01:00:00Z')).state, 'segera_berakhir');
  const t = subscriptionStatus(sub, new Date('2027-01-03T01:00:00Z'));
  assert.deepEqual([t.state, t.writable], ['tenggang', true]);
  const k = subscriptionStatus(sub, new Date('2027-01-08T01:00:00Z'));
  assert.deepEqual([k.state, k.writable], ['terkunci', false]);
});

test('perpanjangan: dari tanggal akhir bila belum lewat, dari hari ini bila sudah lewat', () => {
  const aktif = makeSubscription('berlangganan', '2026-12-31');
  assert.equal(extendSubscription(aktif, 1, '2026-10-16').validUntil, '2027-01-31');
  const lewat = makeSubscription('berlangganan', '2026-01-31');
  assert.equal(extendSubscription(lewat, 3, '2026-10-16').validUntil, '2027-01-16');
  assert.equal(extendSubscription(startTrial('2026-10-16'), 12, '2026-10-20').plan, 'berlangganan');
  assert.throws(() => extendSubscription(null, 0));
});

test('koperasi tanpa data langganan tidak dibatasi; addDays lintas bulan', () => {
  assert.deepEqual(subscriptionStatus(null), { state: 'tanpa_batas', daysLeft: null, writable: true });
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
});
