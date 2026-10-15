import { Link } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { koperasiPath, useCollection, type Member } from '../services/data.ts';
import { useSession } from '../services/session.tsx';
import { Empty, Rp, Stat, StatusBadge } from '../components/ui.tsx';
import { balancesByMember, totalSavings, type SavingsTx } from '../core/savings.ts';
import { summarizeCash, type CashEntry } from '../core/ledger.ts';
import { sum } from '../core/money.ts';
import type { Loan } from '../core/types.ts';
import { todayISO } from '../core/dates.ts';

export function Dashboard() {
  const { session } = useSession();
  const kid = session!.kid;
  const members = useCollection<Member>(koperasiPath(kid, 'members'));
  const txs = useCollection<SavingsTx>(koperasiPath(kid, 'savingsTx'));
  const cash = useCollection<CashEntry>(koperasiPath(kid, 'cashEntries'));
  const pending = useCollection<Loan>(koperasiPath(kid, 'loans'), where('status', 'in', ['diajukan', 'diverifikasi', 'disetujui']));
  const active = useCollection<Loan>(koperasiPath(kid, 'loans'), where('status', '==', 'dicairkan'));

  const balances = balancesByMember(txs.data);
  const totalAllSavings = sum(Object.values(balances).map(totalSavings));
  const cashNow = summarizeCash(cash.data, '0000-01-01', todayISO()).closing;
  const names = new Map(members.data.map((m) => [m.id, m.name]));

  return (
    <>
      <h1>Beranda</h1>
      <div className="grid">
        <Stat label="Anggota aktif" value={members.data.filter((m) => m.status === 'aktif').length} />
        <Stat label="Total simpanan" value={<Rp value={totalAllSavings} />} />
        <Stat label="Saldo kas" value={<Rp value={cashNow} />} />
        <Stat label="Pokok pinjaman berjalan" value={<Rp value={sum(active.data.map((l) => l.principal))} />} />
      </div>
      <h2>Pengajuan pinjaman yang perlu diproses</h2>
      <div className="card table-wrap">
        {pending.data.length === 0 ? (
          <Empty>Tidak ada pengajuan yang menunggu.</Empty>
        ) : (
          <table>
            <thead><tr><th>Anggota</th><th className="num">Jumlah</th><th>Status</th><th /></tr></thead>
            <tbody>
              {pending.data.map((l) => (
                <tr key={l.id}>
                  <td>{names.get(l.memberId) ?? l.memberId}</td>
                  <td className="num"><Rp value={l.principal} /></td>
                  <td><StatusBadge status={l.status} /></td>
                  <td><Link to={`/pinjaman/${l.id}`}>Buka</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
