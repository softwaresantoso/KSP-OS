import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, where, writeBatch } from 'firebase/firestore';
import { db } from '../services/firebase.ts';
import { callLoanAction, friendlyError, koperasiPath, newId, useCollection, useDocument, type Member } from '../services/data.ts';
import { useSession } from '../services/session.tsx';
import { Notice, Rp, StatusBadge, numberInput } from '../components/ui.tsx';
import {
  DEFAULT_APPROVAL_POLICY,
  approvalMode,
  cancel,
  decide,
  disburse,
  verify,
  type ApprovalPolicy,
} from '../core/approval.ts';
import { applyPayments, buildSchedule, computeDisbursement, listArrears, scheduleTotals } from '../core/loan.ts';
import { sum } from '../core/money.ts';
import { todayISO } from '../core/dates.ts';
import { can } from '../core/permissions.ts';
import type { Actor, Loan } from '../core/types.ts';

interface Payment {
  loanId: string;
  memberId: string;
  amount: number;
  penaltyPaid: number;
  date: string;
  note?: string;
}

function dryRun(fn: () => unknown): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

export function LoanDetail() {
  const { loanId = '' } = useParams();
  const { session } = useSession();
  const kid = session!.kid;
  const uid = session!.uid;

  const loanDoc = useDocument<Omit<Loan, 'id'>>(koperasiPath(kid, 'loans', loanId));
  const koperasi = useDocument<{ approvalPolicy?: ApprovalPolicy }>(`koperasi/${kid}`);
  const loan = loanDoc.data as Loan | null;
  const member = useDocument<Member>(loan ? koperasiPath(kid, 'members', loan.memberId) : null);
  const payments = useCollection<Payment>(
    loan ? koperasiPath(kid, 'loanPayments') : null,
    where('loanId', '==', loanId),
    where('memberId', '==', loan?.memberId ?? ''),
  );

  const [note, setNote] = useState('');
  const [disburseDate, setDisburseDate] = useState(todayISO());
  const [pay, setPay] = useState({ amount: '', penalty: '', date: todayISO() });
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);

  if (loanDoc.loading) return <p className="muted">Memuat…</p>;
  if (!loan) return <p className="error">Pinjaman tidak ditemukan atau Anda tidak berhak melihatnya.</p>;

  const policy = koperasi.data?.approvalPolicy ?? DEFAULT_APPROVAL_POLICY;
  const actor: Actor = { uid, role: session!.role, memberId: session!.memberId };
  const isStaff = session!.role !== 'anggota';

  const schedule =
    loan.status === 'dicairkan' || loan.status === 'lunas'
      ? buildSchedule({
          principal: loan.principal,
          tenorMonths: loan.tenorMonths,
          ratePerMonth: loan.ratePerMonth,
          method: loan.interestMethod,
          firstDueDate: loan.firstDueDate as string,
        })
      : [];
  const { rows, excess } = applyPayments(schedule, payments.data.map((p) => ({ date: p.date, amount: p.amount })));
  const totals = scheduleTotals(schedule);
  const remaining = sum(rows.map((r) => r.outstanding));
  const settled = schedule.length > 0 && remaining === 0;
  const effectiveStatus = settled ? 'lunas' : loan.status;
  const arrears = listArrears(rows, todayISO(), loan.penalty);
  const fee = computeDisbursement(loan.principal, loan.adminFeePercent);

  const can_ = {
    verify: dryRun(() => verify(loan, actor, '', policy)),
    decide: dryRun(() => decide(loan, actor, 'approve', '', policy)),
    disburse: dryRun(() => disburse(loan, actor, todayISO(), policy)),
    cancel: dryRun(() => cancel(loan, actor, '', policy)),
    pay: loan.status === 'dicairkan' && !settled && can(session!.role, 'loan.record_payment'),
  };

  async function act(action: 'verify' | 'approve' | 'reject' | 'disburse' | 'cancel') {
    setBusy(true);
    setMsg({});
    try {
      await callLoanAction({ loanId, action, note, disbursedDate: disburseDate });
      setNote('');
      setMsg({ ok: 'Berhasil diproses' });
    } catch (e) {
      setMsg({ err: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }

  function recordPayment(e: FormEvent) {
    e.preventDefault();
    setMsg({});
    const amount = numberInput(pay.amount);
    const penaltyPaid = numberInput(pay.penalty);
    if (amount < 0 || penaltyPaid < 0 || amount + penaltyPaid <= 0) {
      setMsg({ err: 'Isi jumlah angsuran dan/atau denda' });
      return;
    }
    if (amount > remaining) {
      setMsg({ err: 'Jumlah angsuran melebihi sisa kewajiban' });
      return;
    }
    const prior = payments.data.map((p) => ({ date: p.date, amount: p.amount }));
    const before = applyPayments(schedule, prior).rows;
    const after = applyPayments(schedule, [...prior, { date: pay.date, amount }]).rows;
    const principalDelta = sum(after.map((r) => r.paidPrincipal)) - sum(before.map((r) => r.paidPrincipal));
    const interestDelta = sum(after.map((r) => r.paidInterest)) - sum(before.map((r) => r.paidInterest));

    const id = newId(koperasiPath(kid, 'loanPayments'));
    const batch = writeBatch(db);
    const payment: Payment & { createdByUid: string } = { loanId, memberId: loan!.memberId, amount, penaltyPaid, date: pay.date, createdByUid: uid };
    batch.set(doc(db, koperasiPath(kid, 'loanPayments', id)), payment);
    const addCash = (suffix: string, category: string, value: number, text: string) => {
      if (value <= 0) return;
      batch.set(doc(db, koperasiPath(kid, 'cashEntries', `pay-${id}-${suffix}`)), {
        date: pay.date, direction: 'in', category, amount: value, note: text, ref: loanId, createdByUid: uid,
      });
    };
    addCash('pokok', 'angsuran_pokok', principalDelta, 'Angsuran pokok');
    addCash('bunga', 'angsuran_bunga', interestDelta, 'Angsuran bunga');
    addCash('denda', 'denda', penaltyPaid, 'Denda keterlambatan');
    batch.commit().catch((err: unknown) => setMsg({ err: err instanceof Error ? err.message : String(err) }));
    setPay({ amount: '', penalty: '', date: todayISO() });
    setMsg({ ok: 'Pembayaran tercatat. Jika offline, akan terkirim otomatis saat online.' });
  }

  return (
    <>
      <p><Link to={isStaff ? '/pinjaman' : '/'}>← Kembali</Link></p>
      <h1>Pinjaman {member.data?.name ?? ''} <StatusBadge status={effectiveStatus} /></h1>
      <Notice error={msg.err} success={msg.ok} />

      <div className="card">
        <div className="grid">
          <div><div className="muted">Pokok</div><strong><Rp value={loan.principal} /></strong></div>
          <div><div className="muted">Tenor</div><strong>{loan.tenorMonths} bulan</strong></div>
          <div><div className="muted">Bunga</div><strong>{loan.ratePerMonth}% / bln ({loan.interestMethod})</strong></div>
          <div><div className="muted">Biaya admin</div><strong><Rp value={fee.adminFee} /></strong></div>
          <div><div className="muted">Diterima anggota</div><strong><Rp value={fee.netAmount} /></strong></div>
        </div>
        <p className="muted">Tujuan: {loan.purpose || '-'}</p>
        <p className="muted">
          Persetujuan: {approvalMode(loan.principal, policy) === 'single' ? 'satu pengurus berwenang' : 'Ketua dan Bendahara'} ·
          sudah menyetujui: {loan.approvals.map((a) => a.role).join(', ') || 'belum ada'}
        </p>
      </div>

      {isStaff && (can_.verify || can_.decide || can_.disburse || can_.cancel) && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Tindakan</h2>
          <label>Catatan (wajib untuk penolakan)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {can_.disburse && <label>Tanggal pencairan<input type="date" value={disburseDate} onChange={(e) => setDisburseDate(e.target.value)} /></label>}
          <div className="row">
            {can_.verify && <button className="primary" disabled={busy} onClick={() => void act('verify')}>Verifikasi kelengkapan</button>}
            {can_.decide && <button className="primary" disabled={busy} onClick={() => void act('approve')}>Setujui</button>}
            {can_.decide && <button className="danger" disabled={busy} onClick={() => void act('reject')}>Tolak</button>}
            {can_.disburse && <button className="primary" disabled={busy} onClick={() => void act('disburse')}>Cairkan</button>}
            {can_.cancel && <button disabled={busy} onClick={() => void act('cancel')}>Batalkan</button>}
          </div>
          <p className="muted">Tindakan ini membutuhkan koneksi internet.</p>
        </div>
      )}
      {!isStaff && loan.status === 'diajukan' && (
        <div className="card"><button className="danger" disabled={busy} onClick={() => void act('cancel')}>Batalkan pengajuan</button></div>
      )}

      {schedule.length > 0 && (
        <>
          <h2>Jadwal angsuran</h2>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>#</th><th>Jatuh tempo</th><th className="num">Pokok</th><th className="num">Bunga</th><th className="num">Total</th><th className="num">Dibayar</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.no}>
                    <td>{r.no}</td><td>{r.dueDate}</td>
                    <td className="num"><Rp value={r.principal} /></td>
                    <td className="num"><Rp value={r.interest} /></td>
                    <td className="num"><Rp value={r.total} /></td>
                    <td className="num"><Rp value={r.paid} /></td>
                    <td>{r.outstanding === 0 ? <span className="badge ok">lunas</span> : r.dueDate < todayISO() ? <span className="badge bad">menunggak</span> : <span className="badge">belum</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th colSpan={2}>Total</th><th className="num"><Rp value={totals.principal} /></th><th className="num"><Rp value={totals.interest} /></th><th className="num"><Rp value={totals.total} /></th><th className="num" colSpan={2}>Sisa: <Rp value={remaining} /></th></tr></tfoot>
            </table>
          </div>
          {arrears.items.length > 0 && (
            <p className="error">Tunggakan: <Rp value={arrears.totalOutstanding} /> · estimasi denda: <Rp value={arrears.totalPenalty} /></p>
          )}
          {excess > 0 && <p className="warn">Ada kelebihan pembayaran <Rp value={excess} />. Periksa pencatatan.</p>}

          {can_.pay && (
            <form className="card stack" onSubmit={recordPayment}>
              <h2 style={{ margin: 0 }}>Catat pembayaran angsuran</h2>
              <div className="grid">
                <label>Jumlah angsuran (Rp)<input inputMode="numeric" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
                <label>Denda dibayar (Rp, opsional)<input inputMode="numeric" value={pay.penalty} onChange={(e) => setPay({ ...pay, penalty: e.target.value })} /></label>
                <label>Tanggal<input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} required /></label>
              </div>
              <div><button className="primary">Simpan pembayaran</button></div>
            </form>
          )}
        </>
      )}

      <h2>Riwayat proses</h2>
      <div className="card">
        {[{ at: loan.requestedAt, role: 'anggota', action: 'ajukan', note: loan.purpose }, ...loan.history].map((h, i) => (
          <div key={i} className="muted">{h.at.slice(0, 16).replace('T', ' ')} · {h.role} · {h.action}{h.note ? ` — ${h.note}` : ''}</div>
        ))}
      </div>
    </>
  );
}
