import { useState, type FormEvent } from 'react';
import { callCreateAccount, friendlyError, koperasiPath, newId, useCollection, writeQueued, type Member } from '../services/data.ts';
import { useSession } from '../services/session.tsx';
import { Empty, Notice } from '../components/ui.tsx';
import { todayISO } from '../core/dates.ts';

export function Members() {
  const { session } = useSession();
  const kid = session!.kid;
  const { data: members, loading } = useCollection<Member>(koperasiPath(kid, 'members'));
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [form, setForm] = useState({ memberNo: '', name: '', nik: '', phone: '', address: '', dusun: '', joinDate: todayISO() });
  const [account, setAccount] = useState<{ memberId: string; email: string; password: string } | null>(null);

  const filtered = members
    .filter((m) => `${m.memberNo} ${m.name} ${m.dusun ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.memberNo.localeCompare(b.memberNo, 'id', { numeric: true }));

  function addMember(e: FormEvent) {
    e.preventDefault();
    setMsg({});
    if (members.some((m) => m.memberNo === form.memberNo.trim())) {
      setMsg({ err: 'Nomor anggota sudah dipakai' });
      return;
    }
    const id = newId(koperasiPath(kid, 'members'));
    // Antre lokal bila offline; terkirim otomatis saat internet kembali.
    writeQueued(
      koperasiPath(kid, 'members', id),
      {
        memberNo: form.memberNo.trim(),
        name: form.name.trim(),
        nik: form.nik.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        dusun: form.dusun.trim(),
        joinDate: form.joinDate,
        status: 'aktif',
      },
      (m) => setMsg({ err: m }),
    );
    setForm({ ...form, memberNo: '', name: '', nik: '', phone: '', address: '' });
    setMsg({ ok: 'Anggota ditambahkan' });
  }

  function toggleStatus(m: Member) {
    // Dokumen anggota ditulis ulang utuh agar writeQueued (setDoc) tidak menghapus field lain.
    const { id, ...rest } = m;
    writeQueued(koperasiPath(kid, 'members', id), { ...rest, status: m.status === 'aktif' ? 'nonaktif' : 'aktif' }, (e) => setMsg({ err: e }));
  }

  async function createLogin(e: FormEvent) {
    e.preventDefault();
    if (!account) return;
    setMsg({});
    try {
      await callCreateAccount({ email: account.email, password: account.password, role: 'anggota', memberId: account.memberId });
      setMsg({ ok: 'Akun login anggota dibuat. Berikan email dan kata sandi awal kepada anggota.' });
      setAccount(null);
    } catch (err) {
      setMsg({ err: friendlyError(err) });
    }
  }

  return (
    <>
      <h1>Anggota</h1>
      <Notice error={msg.err} success={msg.ok} />
      <form className="card stack" onSubmit={addMember}>
        <h2 style={{ margin: 0 }}>Tambah anggota</h2>
        <div className="grid">
          <label>No. anggota<input value={form.memberNo} onChange={(e) => setForm({ ...form, memberNo: e.target.value })} required /></label>
          <label>Nama lengkap<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label>NIK (opsional)<input inputMode="numeric" value={form.nik} onChange={(e) => setForm({ ...form, nik: e.target.value })} /></label>
          <label>No. HP<input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>Dusun<input value={form.dusun} onChange={(e) => setForm({ ...form, dusun: e.target.value })} /></label>
          <label>Tanggal bergabung<input type="date" value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} required /></label>
        </div>
        <label>Alamat<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
        <div><button className="primary">Simpan anggota</button></div>
      </form>

      {account && (
        <form className="card stack" onSubmit={(e) => void createLogin(e)}>
          <h2 style={{ margin: 0 }}>Buat akun login: {members.find((m) => m.id === account.memberId)?.name}</h2>
          <label>Email<input type="email" value={account.email} onChange={(e) => setAccount({ ...account, email: e.target.value })} required /></label>
          <label>Kata sandi awal (min. 8 karakter)<input type="text" minLength={8} value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} required /></label>
          <div className="row"><button className="primary">Buat akun</button><button type="button" onClick={() => setAccount(null)}>Batal</button></div>
        </form>
      )}

      <div className="card">
        <input placeholder="Cari nama, nomor, atau dusun…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="table-wrap">
          {loading ? <p className="muted">Memuat…</p> : filtered.length === 0 ? <Empty>Belum ada anggota.</Empty> : (
            <table>
              <thead><tr><th>No.</th><th>Nama</th><th>Dusun</th><th>Status</th><th /></tr></thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id}>
                    <td>{m.memberNo}</td>
                    <td>{m.name}</td>
                    <td>{m.dusun}</td>
                    <td><span className={`badge ${m.status === 'aktif' ? 'ok' : 'bad'}`}>{m.status}</span></td>
                    <td className="row">
                      {!m.uid && <button onClick={() => setAccount({ memberId: m.id, email: '', password: '' })}>Buat akun</button>}
                      <button onClick={() => toggleStatus(m)}>{m.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
