import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { orderBy, where } from 'firebase/firestore';
import { koperasiPath, newId, useCollection, useDocument, writeQueued, type Member } from '../services/data.ts';
import { useSession } from '../services/session.tsx';
import { Empty, Notice, Rp, Stat, StatusBadge, numberInput } from '../components/ui.tsx';
import { balancesOf, totalSavings, type SavingsTx } from '../core/savings.ts';
import { SAVINGS_LABELS, SAVINGS_TYPES, type Loan, type SavingsType } from '../core/types.ts';
import { todayISO } from '../core/dates.ts';
import type { ShuMemberResult } from '../core/shu.ts';

export function Portal() {
  const { session } = useSession();
  const kid = session!.kid;
  const mid = session!.memberId ?? '';
  const year = todayISO().slice(0, 4);

  const member = useDocument<Member>(mid ? koperasiPath(kid, 'members', mid) : null);
  // Query anggota HARUS menyertakan where memberId == mid agar lolos Security Rules.
  const txs = useCollection<SavingsTx>(mid ? koperasiPath(kid, 'savingsTx') : null, where('memberId', '==', mid), orderBy('date', 'desc'));
  const loans = useCollection<Loan>(mid ? koperasiPath(kid, 'loans') : null, where('memberId', '==', mid), orderBy('requestedAt', 'desc'));
  const shu = useDocument<ShuMemberResult & { shuYear?: string }>(mid ? koperasiPath(kid, 'shuEstimates', year, 'members', mid) : null);

  const [form, setForm] = useState({ savingsType: 'wajib' as SavingsType, amount: '', note: '' });
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  if (!mid) return <p className="error">Akun Anda belum dikaitkan dengan data anggota. Hubungi pengurus.</p>;

  const balances = balancesOf(txs.data, mid);

  function requestDeposit(e: FormEvent) {
    e.preventDefault();
    setMsg({});
    const amount = numberInput(form.amount);
    if (amount <= 0) {
      setMsg({ err: 'Isi jumlah setoran' });
      return;
    }
    writeQueued(
      koperasiPath(kid, 'depositRequests', newId(koperasiPath(kid, 'depositRequests'))),
      { memberId: mid, savingsType: form.savingsType, amount, note: form.note.trim(), status: 'menunggu', requestedAt: new Date().toISOString() },
      (m) => setMsg({ err: m }),
    );
    setForm({ ...form, amount: '', note: '' });
    setMsg({ ok: 'Pengajuan setoran terkirim. Serahkan uang ke pengurus; saldo bertambah setelah pengurus mengonfirmasi.' });
  }

  return (
    <>
      <h1>Halo, {member.data?.name ?? 'Anggota'}</h1>
      <div className="grid">
        {SAVINGS_TYPES.map((t) => <Stat key={t} label={SAVINGS_LABELS[t]} value={<Rp value={balances[t]} />} />)}
        <Stat label="Total simpanan" value={<Rp value={totalSavings(balances)} />} />
      </div>

      <h2>Estimasi SHU {year}</h2>
      <div className="card">
        {shu.data ? (
          <>
            <strong><Rp value={shu.data.total} /></strong>
            <div className="muted">Jasa simpanan <Rp value={shu.data.jasaSimpanan} /> · jasa pinjaman <Rp value={shu.data.jasaTransaksi} /></div>
            <p className="muted">Ini perkiraan; nilai final ditetapkan Rapat Anggota Tahunan.</p>
          </>
        ) : <Empty>Estimasi SHU belum diterbitkan pengurus.</Empty>}
      </div>

      <h2>Pinjaman saya</h2>
      <div className="card table-wrap">
        {loans.data.length === 0 ? <Empty>Belum ada pinjaman. <Link to="/ajukan-pinjaman">Ajukan pinjaman</Link></Empty> : (
          <table>
            <thead><tr><th>Diajukan</th><th className="num">Jumlah</th><th className="num">Tenor</th><th>Status</th><th /></tr></thead>
            <tbody>
              {loans.data.map((l) => (
                <tr key={l.id}>
                  <td>{l.requestedAt.slice(0, 10)}</td>
                  <td className="num"><Rp value={l.principal} /></td>
                  <td className="num">{l.tenorMonths} bln</td>
                  <td><StatusBadge status={l.status} /></td>
                  <td><Link to={`/pinjaman/${l.id}`}>Rincian</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Ajukan setoran</h2>
      <form className="card stack" onSubmit={requestDeposit}>
        <Notice error={msg.err} success={msg.ok} />
        <div className="grid">
          <label>Jenis simpanan
            <select value={form.savingsType} onChange={(e) => setForm({ ...form, savingsType: e.target.value as SavingsType })}>
              {SAVINGS_TYPES.map((t) => <option key={t} value={t}>{SAVINGS_LABELS[t]}</option>)}
            </select>
          </label>
          <label>Jumlah (Rp)<input inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></label>
        </div>
        <label>Catatan<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        <div><button className="primary">Kirim pengajuan</button></div>
      </form>

      <h2>Riwayat simpanan</h2>
      <div className="card table-wrap">
        {txs.data.length === 0 ? <Empty>Belum ada transaksi.</Empty> : (
          <table>
            <thead><tr><th>Tanggal</th><th>Jenis</th><th className="num">Setoran</th><th className="num">Penarikan</th></tr></thead>
            <tbody>
              {txs.data.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{SAVINGS_LABELS[t.savingsType]}</td>
                  <td className="num">{t.direction === 'in' ? <Rp value={t.amount} /> : ''}</td>
                  <td className="num">{t.direction === 'out' ? <Rp value={t.amount} /> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
