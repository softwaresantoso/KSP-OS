import { useState, type FormEvent } from 'react';
import { doc, orderBy, where, writeBatch } from 'firebase/firestore';
import { db } from '../services/firebase.ts';
import { koperasiPath, newId, useCollection, type Member } from '../services/data.ts';
import { useSession } from '../services/session.tsx';
import { Empty, Notice, Rp, numberInput } from '../components/ui.tsx';
import {
  DEFAULT_WITHDRAWAL_RULES,
  SavingsError,
  balancesOf,
  buildReversal,
  totalSavings,
  validateNewTx,
  type SavingsTx,
} from '../core/savings.ts';
import { SAVINGS_LABELS, SAVINGS_TYPES, type SavingsType } from '../core/types.ts';
import { can } from '../core/permissions.ts';
import { todayISO } from '../core/dates.ts';
import type { CashEntry } from '../core/ledger.ts';

interface DepositRequest {
  memberId: string;
  savingsType: SavingsType;
  amount: number;
  note?: string;
  status: 'menunggu' | 'dikonfirmasi' | 'ditolak';
  requestedAt: string;
}

export function Savings() {
  const { session } = useSession();
  const kid = session!.kid;
  const uid = session!.uid;
  const canRecord = can(session!.role, 'savings.record');

  const members = useCollection<Member>(koperasiPath(kid, 'members'));
  const [memberId, setMemberId] = useState('');
  const memberTx = useCollection<SavingsTx>(
    memberId ? koperasiPath(kid, 'savingsTx') : null,
    where('memberId', '==', memberId),
    orderBy('date', 'desc'),
  );
  const requests = useCollection<DepositRequest>(koperasiPath(kid, 'depositRequests'), where('status', '==', 'menunggu'));

  const [form, setForm] = useState({ savingsType: 'wajib' as SavingsType, direction: 'in' as 'in' | 'out', amount: '', date: todayISO(), note: '' });
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const balances = balancesOf(memberTx.data, memberId);
  const names = new Map(members.data.map((m) => [m.id, m.name]));

  /** Tulis transaksi simpanan + entri kas dalam satu batch; tetap bekerja saat offline. */
  function commitTx(tx: SavingsTx, extra?: (b: ReturnType<typeof writeBatch>) => void) {
    const batch = writeBatch(db);
    const { id, ...data } = tx;
    batch.set(doc(db, koperasiPath(kid, 'savingsTx', id)), data);
    const cash: Omit<CashEntry, 'id'> = {
      date: tx.date,
      direction: tx.direction,
      category: 'simpanan',
      amount: tx.amount,
      note: `${SAVINGS_LABELS[tx.savingsType]}${tx.reversalOf ? ' (koreksi)' : ''}`,
      ref: id,
      createdByUid: uid,
    };
    batch.set(doc(db, koperasiPath(kid, 'cashEntries', `sv-${id}`)), cash);
    extra?.(batch);
    batch.commit().catch((e: unknown) => setMsg({ err: e instanceof Error ? e.message : String(e) }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setMsg({});
    const amount = numberInput(form.amount);
    try {
      validateNewTx({ memberId, savingsType: form.savingsType, direction: form.direction, amount }, memberTx.data, DEFAULT_WITHDRAWAL_RULES);
    } catch (err) {
      setMsg({ err: err instanceof SavingsError || err instanceof Error ? err.message : 'Data tidak valid' });
      return;
    }
    commitTx({
      id: newId(koperasiPath(kid, 'savingsTx')),
      memberId,
      savingsType: form.savingsType,
      direction: form.direction,
      amount,
      date: form.date,
      note: form.note.trim(),
      reversalOf: null,
      createdByUid: uid,
    });
    setForm({ ...form, amount: '', note: '' });
    setMsg({ ok: 'Tercatat. Jika sedang offline, data akan terkirim otomatis saat online.' });
  }

  function reverse(original: SavingsTx & { id: string }) {
    const reason = window.prompt('Alasan koreksi (wajib):');
    if (!reason?.trim()) return;
    try {
      const rev = buildReversal(original, memberTx.data, {
        id: newId(koperasiPath(kid, 'savingsTx')),
        date: todayISO(),
        byUid: uid,
        note: `Koreksi: ${reason.trim()}`,
      });
      commitTx(rev);
      setMsg({ ok: 'Koreksi tercatat' });
    } catch (err) {
      setMsg({ err: err instanceof Error ? err.message : 'Gagal mengoreksi' });
    }
  }

  function confirmRequest(r: DepositRequest & { id: string }) {
    const txId = newId(koperasiPath(kid, 'savingsTx'));
    commitTx(
      {
        id: txId,
        memberId: r.memberId,
        savingsType: r.savingsType,
        direction: 'in',
        amount: r.amount,
        date: todayISO(),
        note: `Setoran via aplikasi${r.note ? `: ${r.note}` : ''}`,
        reversalOf: null,
        createdByUid: uid,
      },
      (b) =>
        b.update(doc(db, koperasiPath(kid, 'depositRequests', r.id)), {
          status: 'dikonfirmasi',
          reviewedByUid: uid,
          savingsTxId: txId,
        }),
    );
  }

  function rejectRequest(r: DepositRequest & { id: string }) {
    const note = window.prompt('Alasan penolakan:') ?? '';
    const batch = writeBatch(db);
    batch.update(doc(db, koperasiPath(kid, 'depositRequests', r.id)), { status: 'ditolak', reviewedByUid: uid, reviewNote: note });
    batch.commit().catch((e: unknown) => setMsg({ err: e instanceof Error ? e.message : String(e) }));
  }

  return (
    <>
      <h1>Simpanan</h1>
      <Notice error={msg.err} success={msg.ok} />

      {requests.data.length > 0 && (
        <>
          <h2>Pengajuan setoran dari anggota</h2>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Anggota</th><th>Jenis</th><th className="num">Jumlah</th><th /></tr></thead>
              <tbody>
                {requests.data.map((r) => (
                  <tr key={r.id}>
                    <td>{names.get(r.memberId) ?? r.memberId}</td>
                    <td>{SAVINGS_LABELS[r.savingsType]}</td>
                    <td className="num"><Rp value={r.amount} /></td>
                    <td className="row">
                      {canRecord && <button className="primary" onClick={() => confirmRequest(r)}>Konfirmasi uang diterima</button>}
                      {canRecord && <button className="danger" onClick={() => rejectRequest(r)}>Tolak</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="card">
        <label>
          Anggota
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">— pilih anggota —</option>
            {members.data
              .filter((m) => m.status === 'aktif')
              .sort((a, b) => a.memberNo.localeCompare(b.memberNo, 'id', { numeric: true }))
              .map((m) => <option key={m.id} value={m.id}>{m.memberNo} — {m.name}</option>)}
          </select>
        </label>
      </div>

      {memberId && (
        <>
          <div className="grid">
            {SAVINGS_TYPES.map((t) => (
              <div key={t} className="card stat"><div className="label">{SAVINGS_LABELS[t]}</div><div className="value"><Rp value={balances[t]} /></div></div>
            ))}
            <div className="card stat"><div className="label">Total</div><div className="value"><Rp value={totalSavings(balances)} /></div></div>
          </div>

          {canRecord && (
            <form className="card stack" onSubmit={submit}>
              <h2 style={{ margin: 0 }}>Catat setoran / penarikan</h2>
              <div className="grid">
                <label>Jenis simpanan
                  <select value={form.savingsType} onChange={(e) => setForm({ ...form, savingsType: e.target.value as SavingsType })}>
                    {SAVINGS_TYPES.map((t) => <option key={t} value={t}>{SAVINGS_LABELS[t]}</option>)}
                  </select>
                </label>
                <label>Transaksi
                  <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as 'in' | 'out' })}>
                    <option value="in">Setoran</option>
                    <option value="out">Penarikan</option>
                  </select>
                </label>
                <label>Jumlah (Rp)<input inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></label>
                <label>Tanggal<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></label>
              </div>
              <label>Catatan<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
              <div><button className="primary">Simpan transaksi</button></div>
            </form>
          )}

          <h2>Riwayat (buku simpanan)</h2>
          <div className="card table-wrap">
            {memberTx.data.length === 0 ? <Empty>Belum ada transaksi.</Empty> : (
              <table>
                <thead><tr><th>Tanggal</th><th>Jenis</th><th className="num">Setoran</th><th className="num">Penarikan</th><th>Catatan</th><th /></tr></thead>
                <tbody>
                  {memberTx.data.map((t) => (
                    <tr key={t.id}>
                      <td>{t.date}</td>
                      <td>{SAVINGS_LABELS[t.savingsType]}</td>
                      <td className="num">{t.direction === 'in' ? <Rp value={t.amount} /> : ''}</td>
                      <td className="num">{t.direction === 'out' ? <Rp value={t.amount} /> : ''}</td>
                      <td>{t.note}</td>
                      <td>{canRecord && !t.reversalOf && !memberTx.data.some((x) => x.reversalOf === t.id) && <button onClick={() => reverse(t)}>Koreksi</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
