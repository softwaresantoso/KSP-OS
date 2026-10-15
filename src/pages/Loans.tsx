import { useState } from 'react';
import { Link } from 'react-router-dom';
import { orderBy } from 'firebase/firestore';
import { koperasiPath, useCollection, type Member } from '../services/data.ts';
import { useSession } from '../services/session.tsx';
import { Empty, Rp, StatusBadge } from '../components/ui.tsx';
import type { Loan, LoanStatus } from '../core/types.ts';

const FILTERS: (LoanStatus | 'semua')[] = ['semua', 'diajukan', 'diverifikasi', 'disetujui', 'dicairkan', 'lunas', 'ditolak', 'dibatalkan'];

export function Loans() {
  const { session } = useSession();
  const kid = session!.kid;
  const loans = useCollection<Loan>(koperasiPath(kid, 'loans'), orderBy('requestedAt', 'desc'));
  const members = useCollection<Member>(koperasiPath(kid, 'members'));
  const [filter, setFilter] = useState<LoanStatus | 'semua'>('semua');
  const names = new Map(members.data.map((m) => [m.id, m.name]));
  const rows = loans.data.filter((l) => filter === 'semua' || l.status === filter);

  return (
    <>
      <h1>Pinjaman</h1>
      <div className="card">
        <label>Filter status
          <select value={filter} onChange={(e) => setFilter(e.target.value as LoanStatus | 'semua')}>
            {FILTERS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <p className="muted">Status “lunas” ditampilkan otomatis di halaman rincian saat seluruh angsuran terbayar.</p>
      </div>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>Tidak ada pinjaman.</Empty> : (
          <table>
            <thead><tr><th>Diajukan</th><th>Anggota</th><th className="num">Jumlah</th><th className="num">Tenor</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>{l.requestedAt.slice(0, 10)}</td>
                  <td>{names.get(l.memberId) ?? l.memberId}</td>
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
    </>
  );
}
