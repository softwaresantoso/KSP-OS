import { useState, type FormEvent } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase.ts';
import { callCreateAccount, friendlyError, koperasiPath, newId, useCollection, useDocument, type Product } from '../services/data.ts';
import { useSession } from '../services/session.tsx';
import { Notice, Rp, numberInput } from '../components/ui.tsx';
import { DEFAULT_APPROVAL_POLICY, type ApprovalPolicy } from '../core/approval.ts';
import { ROLE_LABELS, ROLES, type InterestMethod, type LoanProduct, type PenaltyConfig, type Role } from '../core/types.ts';

const EMPTY: Omit<LoanProduct, 'id'> = {
  name: '',
  interestMethod: 'flat',
  ratePerMonth: 1.5,
  minPrincipal: 500_000,
  maxPrincipal: 10_000_000,
  maxTenorMonths: 12,
  adminFeePercent: 1,
  penalty: { type: 'none', value: 0, graceDays: 0 },
  maxMultipleOfSavings: 3,
  maxActiveLoans: 1,
  active: true,
};

export function Settings() {
  const { session } = useSession();
  const kid = session!.kid;
  const products = useCollection<LoanProduct>(koperasiPath(kid, 'loanProducts'));
  const koperasi = useDocument<{ name: string; approvalPolicy?: ApprovalPolicy }>(`koperasi/${kid}`);
  const policy = koperasi.data?.approvalPolicy ?? DEFAULT_APPROVAL_POLICY;

  const [editing, setEditing] = useState<(Omit<LoanProduct, 'id'> & { id?: string }) | null>(null);
  const [threshold, setThreshold] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [staff, setStaff] = useState({ email: '', password: '', role: 'bendahara' as Role });

  async function saveProduct(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      const { id, ...data } = editing;
      await setDoc(doc(db, koperasiPath(kid, 'loanProducts', id ?? newId(koperasiPath(kid, 'loanProducts')))), data);
      setEditing(null);
      setMsg({ ok: 'Produk pinjaman disimpan' });
    } catch (err) {
      setMsg({ err: friendlyError(err) });
    }
  }

  async function createStaff(e: FormEvent) {
    e.preventDefault();
    setMsg({});
    try {
      await callCreateAccount({ email: staff.email, password: staff.password, role: staff.role });
      setStaff({ email: '', password: '', role: staff.role });
      setMsg({ ok: 'Akun pengurus dibuat. Berikan email dan kata sandi awal kepada yang bersangkutan.' });
    } catch (err) {
      setMsg({ err: friendlyError(err) });
    }
  }

  async function saveThreshold() {
    try {
      await setDoc(doc(db, `koperasi/${kid}`), { approvalPolicy: { ...policy, singleApprovalMaxAmount: numberInput(threshold ?? '0') } }, { merge: true });
      setThreshold(null);
      setMsg({ ok: 'Aturan persetujuan disimpan' });
    } catch (err) {
      setMsg({ err: friendlyError(err) });
    }
  }

  const set = <K extends keyof LoanProduct>(key: K, value: LoanProduct[K]) => setEditing((p) => (p ? { ...p, [key]: value } : p));
  const setPenalty = (patch: Partial<PenaltyConfig>) => setEditing((p) => (p ? { ...p, penalty: { ...p.penalty, ...patch } } : p));

  return (
    <>
      <h1>Pengaturan {koperasi.data?.name}</h1>
      <Notice error={msg.err} success={msg.ok} />
      {!koperasi.loading && !koperasi.data && (
        <p className="error" role="alert">
          Data koperasi tidak dapat dibaca{koperasi.error ? ` (${koperasi.error})` : ' (dokumen tidak ditemukan)'}. Pengaturan tidak bisa
          disimpan sampai ini diperbaiki. Hubungi pemilik platform.
        </p>
      )}
      {products.error && <p className="error" role="alert">Daftar produk tidak dapat dibaca: {products.error}</p>}

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Aturan persetujuan pinjaman</h2>
        <p className="muted">
          Pinjaman sampai batas ini cukup disetujui satu pengurus berwenang (Ketua atau Bendahara). Di atas batas, Ketua
          dan Bendahara harus sama-sama menyetujui.
        </p>
        <label>Batas persetujuan tunggal (Rp)
          <input inputMode="numeric" value={threshold ?? String(policy.singleApprovalMaxAmount)} onChange={(e) => setThreshold(e.target.value)} />
        </label>
        <div><button className="primary" disabled={threshold === null} onClick={() => void saveThreshold()}>Simpan</button></div>
      </div>

      {session!.role === 'ketua' && (
        <form className="card stack" onSubmit={(e) => void createStaff(e)}>
          <h2 style={{ margin: 0 }}>Buat akun pengurus</h2>
          <div className="grid">
            <label>Peran
              <select value={staff.role} onChange={(e) => setStaff({ ...staff, role: e.target.value as Role })}>
                {ROLES.filter((r) => r !== 'ketua').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </label>
            <label>Email<input type="email" value={staff.email} onChange={(e) => setStaff({ ...staff, email: e.target.value })} required /></label>
            <label>Kata sandi awal (min. 8)<input type="text" minLength={8} value={staff.password} onChange={(e) => setStaff({ ...staff, password: e.target.value })} required /></label>
          </div>
          <div><button className="primary">Buat akun</button></div>
        </form>
      )}

      <h2>Produk pinjaman</h2>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Nama</th><th>Bunga</th><th className="num">Maks.</th><th>Tenor maks.</th><th>Status</th><th /></tr></thead>
          <tbody>
            {products.data.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.ratePerMonth}% / bln · {p.interestMethod}</td>
                <td className="num"><Rp value={p.maxPrincipal} /></td>
                <td>{p.maxTenorMonths} bln</td>
                <td><span className={`badge ${p.active ? 'ok' : 'bad'}`}>{p.active ? 'aktif' : 'nonaktif'}</span></td>
                <td><button onClick={() => setEditing(p as Product)}>Ubah</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p><button onClick={() => setEditing({ ...EMPTY })}>+ Produk baru</button></p>
      </div>

      {editing && (
        <form className="card stack" onSubmit={(e) => void saveProduct(e)}>
          <h2 style={{ margin: 0 }}>{editing.id ? 'Ubah produk' : 'Produk baru'}</h2>
          <div className="grid">
            <label>Nama<input value={editing.name} onChange={(e) => set('name', e.target.value)} required /></label>
            <label>Metode bunga
              <select value={editing.interestMethod} onChange={(e) => set('interestMethod', e.target.value as InterestMethod)}>
                <option value="flat">Flat</option>
                <option value="menurun">Menurun (efektif)</option>
              </select>
            </label>
            <label>Bunga per bulan (%)<input type="number" step="0.01" min="0" value={editing.ratePerMonth} onChange={(e) => set('ratePerMonth', Number(e.target.value))} /></label>
            <label>Pinjaman minimum (Rp)<input inputMode="numeric" value={editing.minPrincipal} onChange={(e) => set('minPrincipal', numberInput(e.target.value))} /></label>
            <label>Pinjaman maksimum (Rp)<input inputMode="numeric" value={editing.maxPrincipal} onChange={(e) => set('maxPrincipal', numberInput(e.target.value))} /></label>
            <label>Tenor maksimum (bulan)<input type="number" min="1" value={editing.maxTenorMonths} onChange={(e) => set('maxTenorMonths', Number(e.target.value))} /></label>
            <label>Biaya admin (% dari pokok)<input type="number" step="0.01" min="0" value={editing.adminFeePercent} onChange={(e) => set('adminFeePercent', Number(e.target.value))} /></label>
            <label>Batas = kelipatan simpanan (0 = tanpa batas)<input type="number" min="0" step="0.5" value={editing.maxMultipleOfSavings} onChange={(e) => set('maxMultipleOfSavings', Number(e.target.value))} /></label>
            <label>Maks. pinjaman aktif per anggota<input type="number" min="1" value={editing.maxActiveLoans} onChange={(e) => set('maxActiveLoans', Number(e.target.value))} /></label>
            <label>Denda
              <select value={editing.penalty.type} onChange={(e) => setPenalty({ type: e.target.value as PenaltyConfig['type'] })}>
                <option value="none">Tanpa denda</option>
                <option value="fixed_per_day">Tetap per hari (Rp)</option>
                <option value="percent_per_day">Persen angsuran per hari</option>
              </select>
            </label>
            <label>Nilai denda<input type="number" min="0" step="0.01" value={editing.penalty.value} onChange={(e) => setPenalty({ value: Number(e.target.value) })} /></label>
            <label>Toleransi (hari)<input type="number" min="0" value={editing.penalty.graceDays} onChange={(e) => setPenalty({ graceDays: Number(e.target.value) })} /></label>
          </div>
          <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={editing.active} onChange={(e) => set('active', e.target.checked)} /> Produk aktif</label>
          <div className="row"><button className="primary">Simpan</button><button type="button" onClick={() => setEditing(null)}>Batal</button></div>
        </form>
      )}
    </>
  );
}
