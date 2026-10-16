import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  callListKoperasi,
  callSetSubscription,
  callSetupKoperasi,
  fetchMe,
  friendlyError,
  type KoperasiRow,
} from '../services/data.ts';
import { Notice, Rp, numberInput } from '../components/ui.tsx';
import { BILLING_MONTH_OPTIONS, SUBSCRIPTION_STATE_LABELS, TRIAL_DAYS, invoiceOf } from '../core/subscription.ts';

const STATE_BADGE: Record<string, string> = {
  tanpa_batas: '',
  trial: 'warn',
  aktif: 'ok',
  segera_berakhir: 'warn',
  tenggang: 'warn',
  terkunci: 'bad',
};

/** Hanya untuk pemilik platform: membuat koperasi baru dan mengelola masa langganan. */
export function Platform() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [plan, setPlan] = useState<'trial' | 'berlangganan'>('trial');
  const [months, setMonths] = useState('12');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState<boolean | null>(null);
  const [rows, setRows] = useState<KoperasiRow[]>([]);
  const [fee, setFee] = useState('');
  const [editBilling, setEditBilling] = useState<{ row: KoperasiRow; fee: string; months: string; note: string } | null>(null);
  const [extend, setExtend] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    try {
      setRows((await callListKoperasi()).koperasi);
    } catch (err) {
      setMsg({ err: friendlyError(err) });
    }
  }, []);

  useEffect(() => {
    fetchMe().then(
      (m) => {
        setOwner(m.superadmin);
        if (m.superadmin) void reload();
      },
      () => setOwner(false),
    );
  }, [reload]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg({});
    try {
      const r = await callSetupKoperasi({ name, ketuaEmail: email, ketuaPassword: password, plan, months: Number(months), ...(fee ? { monthlyFee: numberInput(fee) } : {}) });
      setMsg({ ok: `Koperasi dibuat (id: ${r.koperasiId}). Ketua dapat login dengan email tersebut.` });
      setName('');
      setEmail('');
      setPassword('');
      setFee('');
      await reload();
    } catch (err) {
      setMsg({ err: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function change(row: KoperasiRow, params: { action: 'trial' | 'extend'; months?: number }, okText: string) {
    setMsg({});
    try {
      await callSetSubscription({ koperasiId: row.id, ...params });
      setMsg({ ok: `${row.name}: ${okText}` });
      await reload();
    } catch (err) {
      setMsg({ err: friendlyError(err) });
    }
  }

  async function saveBilling() {
    if (!editBilling) return;
    setMsg({});
    try {
      await callSetSubscription({
        koperasiId: editBilling.row.id,
        action: 'billing',
        monthlyFee: numberInput(editBilling.fee),
        billingMonths: Number(editBilling.months),
        paymentNote: editBilling.note,
      });
      setMsg({ ok: `${editBilling.row.name}: tagihan disimpan` });
      setEditBilling(null);
      await reload();
    } catch (err) {
      setMsg({ err: friendlyError(err) });
    }
  }

  if (owner === null) return <p className="muted">Memeriksa akun…</p>;
  if (!owner) return <p className="error">Akun Anda belum terhubung ke koperasi. Hubungi pengurus koperasi Anda.</p>;

  return (
    <>
      <h1>Koperasi &amp; langganan</h1>
      <Notice error={msg.err} success={msg.ok} />

      <div className="card table-wrap">
        <table>
          <thead><tr><th>Koperasi</th><th>Paket</th><th>Berlaku sampai</th><th>Status</th><th>Tagihan</th><th>Tindakan</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted">Belum ada koperasi.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.subscription ? (r.subscription.plan === 'trial' ? 'Percobaan' : 'Berlangganan') : '—'}</td>
                <td>{r.subscription?.validUntil ?? '—'}{r.daysLeft !== null ? <div className="muted">{r.daysLeft >= 0 ? `${r.daysLeft} hari lagi` : `lewat ${-r.daysLeft} hari`}</div> : null}</td>
                <td><span className={`badge ${STATE_BADGE[r.state]}`}>{SUBSCRIPTION_STATE_LABELS[r.state]}</span></td>
                <td>
                  {invoiceOf(r.subscription) ? <><Rp value={invoiceOf(r.subscription)!.amount} /><div className="muted">{invoiceOf(r.subscription)!.months} bln</div></> : '—'}
                  {r.subscription && (
                    <div><button onClick={() => setEditBilling({ row: r, fee: String(r.subscription?.monthlyFee ?? ''), months: String(r.subscription?.billingMonths ?? 12), note: r.subscription?.paymentNote ?? '' })}>Atur tagihan</button></div>
                  )}
                </td>
                <td>
                  <div className="row">
                    <select style={{ width: 'auto' }} value={extend[r.id] ?? '1'} onChange={(e) => setExtend({ ...extend, [r.id]: e.target.value })}>
                      {[1, 3, 6, 12].map((n) => <option key={n} value={n}>{n} bulan</option>)}
                    </select>
                    <button className="primary" onClick={() => void change(r, { action: 'extend', months: Number(extend[r.id] ?? '1') }, `diperpanjang ${extend[r.id] ?? '1'} bulan`)}>Perpanjang</button>
                    <button onClick={() => { if (window.confirm(`Mulai percobaan gratis ${TRIAL_DAYS} hari dari hari ini untuk ${r.name}?`)) void change(r, { action: 'trial' }, `percobaan ${TRIAL_DAYS} hari dimulai`); }}>Trial {TRIAL_DAYS} hari</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Setelah lewat tanggal berlaku (ditambah tenggang 7 hari untuk paket berlangganan), koperasi otomatis menjadi hanya-baca. Data tidak dihapus.</p>
      </div>

      {editBilling && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void saveBilling(); }}>
          <h2 style={{ margin: 0 }}>Atur tagihan — {editBilling.row.name}</h2>
          <div className="grid">
            <label>Tarif per bulan (Rp)<input inputMode="numeric" value={editBilling.fee} onChange={(e) => setEditBilling({ ...editBilling, fee: e.target.value })} required /></label>
            <label>Periode tagihan
              <select value={editBilling.months} onChange={(e) => setEditBilling({ ...editBilling, months: e.target.value })}>
                {BILLING_MONTH_OPTIONS.map((n) => <option key={n} value={n}>{n} bulan</option>)}
              </select>
            </label>
          </div>
          <label>Petunjuk pembayaran (rekening/QRIS, kontak konfirmasi)
            <textarea rows={3} maxLength={500} value={editBilling.note} onChange={(e) => setEditBilling({ ...editBilling, note: e.target.value })} />
          </label>
          <p className="muted">Nominal tagihan = tarif x periode: <Rp value={numberInput(editBilling.fee) * Number(editBilling.months)} /></p>
          <div className="row"><button className="primary">Simpan</button><button type="button" onClick={() => setEditBilling(null)}>Batal</button></div>
        </form>
      )}

      <h2>Buat koperasi baru</h2>
      <form className="card stack" onSubmit={(e) => void submit(e)}>
        <label>Nama koperasi<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Email Ketua<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Kata sandi awal Ketua (min. 8 karakter)<input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <div className="grid">
          <label>Paket awal
            <select value={plan} onChange={(e) => setPlan(e.target.value as 'trial' | 'berlangganan')}>
              <option value="trial">Percobaan gratis {TRIAL_DAYS} hari</option>
              <option value="berlangganan">Langsung berlangganan</option>
            </select>
          </label>
          {plan === 'berlangganan' && (
            <label>Lama langganan
              <select value={months} onChange={(e) => setMonths(e.target.value)}>
                {[1, 3, 6, 12, 24].map((n) => <option key={n} value={n}>{n} bulan</option>)}
              </select>
            </label>
          )}
        </div>
        <label>Tarif per bulan (Rp, opsional — bisa diatur nanti)<input inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
        <button className="primary" disabled={busy}>Buat koperasi</button>
      </form>
    </>
  );
}
