import { useState, type FormEvent } from 'react';
import { useSession } from '../services/session.tsx';
import { Notice } from '../components/ui.tsx';

export function Login() {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch {
      setError('Email atau kata sandi salah, atau tidak ada koneksi internet.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <h1>Koperasi Simpan Pinjam</h1>
      <form className="card stack" onSubmit={(e) => void submit(e)}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Kata sandi
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <Notice error={error} />
        <button className="primary" disabled={busy}>{busy ? 'Masuk…' : 'Masuk'}</button>
      </form>
      <p className="muted">Akun dibuat oleh pengurus koperasi. Lupa kata sandi? Minta pengurus mengatur ulang.</p>
    </div>
  );
}
