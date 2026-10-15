import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ROLE_LABELS } from '../core/types.ts';
import { can } from '../core/permissions.ts';
import { PoweredBy } from './ui.tsx';
import { isStaffRole, useSession } from '../services/session.tsx';

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function Layout({ children }: { children: ReactNode }) {
  const { session, logout } = useSession();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  // Tutup sidebar (tampilan ponsel) setiap pindah halaman.
  useEffect(() => setOpen(false), [pathname]);
  if (!session) return null;
  const staff = isStaffRole(session.role);

  return (
    <>
      {!online && (
        <div className="banner" role="status">
          Anda sedang offline. Pencatatan simpanan dan kas tetap tersimpan di perangkat dan otomatis terkirim saat
          internet kembali. Persetujuan pinjaman butuh internet.
        </div>
      )}
      <header className="topbar no-print">
        <button aria-label="Buka menu" aria-expanded={open} onClick={() => setOpen(true)}>☰</button>
        <strong>Koperasi</strong>
      </header>
      {open && <div className="backdrop no-print" onClick={() => setOpen(false)} />}
      <div className="shell">
        <nav className={`nav${open ? ' open' : ''}`}>
          <div className="brand row" style={{ justifyContent: 'space-between' }}>
            Koperasi
            <button className="close-nav" aria-label="Tutup menu" onClick={() => setOpen(false)}>✕</button>
          </div>
          {session.kid === '' ? (
            <NavLink to="/">Koperasi baru</NavLink>
          ) : staff ? (
            <>
              <NavLink to="/" end>Beranda</NavLink>
              {can(session.role, 'member.manage') && <NavLink to="/anggota">Anggota</NavLink>}
              <NavLink to="/simpanan">Simpanan</NavLink>
              <NavLink to="/pinjaman">Pinjaman</NavLink>
              {can(session.role, 'settings.manage') && <NavLink to="/pengaturan">Pengaturan</NavLink>}
            </>
          ) : (
            <>
              <NavLink to="/" end>Beranda saya</NavLink>
              <NavLink to="/ajukan-pinjaman">Ajukan pinjaman</NavLink>
            </>
          )}
          <div className="spacer" />
          <PoweredBy />
          <div className="muted" style={{ padding: '0 10px', fontSize: 12 }}>
            {session.email}
            <br />
            {session.role === 'anggota' ? 'Anggota' : ROLE_LABELS[session.role]}
          </div>
          <button onClick={() => void logout()} style={{ margin: '8px 10px' }}>Keluar</button>
        </nav>
        <main className="content">
          {children}
          <PoweredBy className="in-content" />
        </main>
      </div>
    </>
  );
}
