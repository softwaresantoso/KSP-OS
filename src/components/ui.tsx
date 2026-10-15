import type { ReactNode } from 'react';
import { formatRupiah } from '../core/money.ts';
import type { LoanStatus } from '../core/types.ts';

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

export function Rp({ value }: { value: number }) {
  return <>{formatRupiah(value)}</>;
}

const STATUS_STYLE: Record<LoanStatus, string> = {
  diajukan: 'warn',
  diverifikasi: 'warn',
  disetujui: 'ok',
  dicairkan: 'ok',
  lunas: 'ok',
  ditolak: 'bad',
  dibatalkan: 'bad',
};

export function StatusBadge({ status }: { status: LoanStatus }) {
  return <span className={`badge ${STATUS_STYLE[status]}`}>{status}</span>;
}

export function Notice({ error, success }: { error?: string | null; success?: string | null }) {
  if (error) return <p className="error" role="alert">{error}</p>;
  if (success) return <p className="success" role="status">{success}</p>;
  return null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}

export function numberInput(value: string): number {
  const n = Number(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
