import { useEffect, useState, type FormEvent } from 'react';
import { callSetupKoperasi, fetchMe, friendlyError } from '../services/data.ts';
import { Notice } from '../components/ui.tsx';

/** Hanya untuk pemilik platform: membuat koperasi baru beserta akun Ketua. */
export function Platform() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState<boolean | null>(null);

  useEffect(() => {
    fetchMe().then((m) => setOwner(m.superadmin), () => setOwner(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg({});
    try {
      const r = await callSetupKoperasi({ name, ketuaEmail: email, ketuaPassword: password });
      setMsg({ ok: `Koperasi dibuat (id: ${r.koperasiId}). Ketua dapat login dengan email tersebut.` });
      setName('');
      setEmail('');
      setPassword('');
    } catch (err) {
      setMsg({ err: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  }

  if (owner === null) return <p className="muted">Memeriksa akun…</p>;
  if (!owner) return <p className="error">Akun Anda belum terhubung ke koperasi. Hubungi pengurus koperasi Anda.</p>;

  return (
    <>
      <h1>Buat koperasi baru</h1>
      <form className="card stack" onSubmit={(e) => void submit(e)}>
        <label>Nama koperasi<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Email Ketua<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Kata sandi awal Ketua (min. 8 karakter)<input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <Notice error={msg.err} success={msg.ok} />
        <button className="primary" disabled={busy}>Buat koperasi</button>
      </form>
    </>
  );
}
