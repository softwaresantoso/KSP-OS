import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { useSession, isStaffRole } from './services/session.tsx';
import { Login } from './pages/Login.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Members } from './pages/Members.tsx';
import { Savings } from './pages/Savings.tsx';
import { Loans } from './pages/Loans.tsx';
import { LoanDetail } from './pages/LoanDetail.tsx';
import { Settings } from './pages/Settings.tsx';
import { Platform } from './pages/Platform.tsx';
import { Portal } from './pages/Portal.tsx';
import { LoanRequest } from './pages/LoanRequest.tsx';

export function App() {
  const { session, loading } = useSession();
  if (loading) return <p className="content muted">Memuat…</p>;
  if (!session) return <Login />;

  // Akun tanpa koperasi: hanya pemilik platform (dicek server) yang bisa membuat koperasi baru.
  if (!session.kid) {
    return (
      <Layout>
        <Platform />
      </Layout>
    );
  }

  const staff = isStaffRole(session.role);
  return (
    <Layout>
      <Routes>
        {staff ? (
          <>
            <Route path="/" element={<Dashboard />} />
            <Route path="/anggota" element={<Members />} />
            <Route path="/simpanan" element={<Savings />} />
            <Route path="/pinjaman" element={<Loans />} />
            <Route path="/pinjaman/:loanId" element={<LoanDetail />} />
            <Route path="/pengaturan" element={<Settings />} />
          </>
        ) : (
          <>
            <Route path="/" element={<Portal />} />
            <Route path="/ajukan-pinjaman" element={<LoanRequest />} />
            <Route path="/pinjaman/:loanId" element={<LoanDetail />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
