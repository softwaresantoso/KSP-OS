import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, orderBy, setDoc, where } from 'firebase/firestore';
import { db } from '../services/firebase.ts';
import { friendlyError, koperasiPath, newId, useCollection, useDocument, type Member } from '../services/data.ts';
import { useSession } from '../services/session.tsx';
import { Notice, Rp, numberInput } from '../components/ui.tsx';
import { applyPayments, buildSchedule, checkEligibility, computeDisbursement, listArrears, scheduleTotals } from '../core/loan.ts';
import { balancesOf, totalSavings, type SavingsTx } from '../core/savings.ts';
import { addMonths, todayISO } from '../core/dates.ts';
import { sum } from '../core/money.ts';
import type { Loan, LoanProduct } from '../core/types.ts';

interface Payment { loanId: string; amount: number; date: string }

export function LoanRequest() {
  const { session } = useSession();
  const kid = session!.kid;
  const mid = session!.memberId ?? '';
  const navigate = useNavigate();

  const member = useDocument<Member>(mid ? koperasiPath(kid, 'members', mid) : null);
  const products = useCollection<LoanProduct>(koperasiPath(kid, 'loanProducts'), where('active', '==', true));
  const txs = useCollection<SavingsTx>(mid ? koperasiPath(kid, 'savingsTx') : null, where('memberId', '==', mid), orderBy('date', 'desc'));
  const loans = useCollection<Loan>(mid ? koperasiPath(kid, 'loans') : null, where('memberId', '==', mid));
  const payments = useCollection<Payment>(mid ? koperasiPath(kid, 'loanPayments') : null, where('memberId', '==', mid));

  const [productId, setProductId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [tenor, setTenor] = useState('12');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState<string | null>(null);

  const product = products.data.find((p) => p.id === productId);
  const amount = numberInput(principal);
  const months = Number(tenor);
  const today = todayISO();

  // Status pinjaman berjalan: pengajuan yang masih diproses + pinjaman cair yang belum lunas.
  let activeCount = 0;
  let hasArrears = false;
  for (const l of loans.data) {
    if (['diajukan', 'diverifikasi', 'disetujui'].includes(l.status)) activeCount++;
    if (l.status === 'dicairkan' && l.firstDueDate) {
      const sched = buildSchedule({ principal: l.principal, tenorMonths: l.tenorMonths, ratePerMonth: l.ratePerMonth, method: l.interestMethod, firstDueDate: l.firstDueDate });
      const { rows } = applyPayments(sched, payments.data.filter((p) => p.loanId === l.id));
      if (sum(rows.map((r) => r.outstanding)) > 0) activeCount++;
      if (listArrears(rows, today, l.penalty).items.length > 0) hasArrears = true;
    }
  }

  const reasons = product
    ? checkEligibility({
        product,
        principal: amount,
        tenorMonths: months,
        memberActive: member.data?.status === 'aktif',
        totalSavings: totalSavings(balancesOf(txs.data, mid)),
        activeLoanCount: activeCount,
        hasArrears,
      })
    : [];

  const preview =
    product && amount > 0 && Number.isInteger(months) && months >= 1
      ? buildSchedule({ principal: amount, tenorMonths: months, ratePerMonth: product.ratePerMonth, method: product.interestMethod, firstDueDate: addMonths(today, 1) })
      : [];

  const totals = scheduleTotals(preview);
  const firstInst = preview[0]?.total ?? 0;
  const lastInst = preview[preview.length - 1]?.total ?? 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!product || reasons.length > 0) return;
    setError(null);
    try {
      const id = newId(koperasiPath(kid, 'loans'));
      const { id: _pid, ...p } = product;
      await setDoc(doc(db, koperasiPath(kid, 'loans', id)), {
        memberId: mid,
        productId: product.id,
        principal: amount,
        tenorMonths: months,
        interestMethod: p.interestMethod,
        ratePerMonth: p.ratePerMonth,
        adminFeePercent: p.adminFeePercent,
        penalty: p.penalty,
        purpose: purpose.trim(),
        status: 'diajukan',
        requestedByUid: session!.uid,
        requestedAt: new Date().toISOString(),
        approvals: [],
        history: [],
      });
      navigate(`/pinjaman/${id}`);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <>
      <h1>Ajukan pinjaman</h1>
      <form className="card stack" onSubmit={(e) => void submit(e)}>
        <label>Jenis pinjaman
          <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="">— pilih —</option>
            {products.data.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.ratePerMonth}%/bln, {p.interestMethod})</option>)}
          </select>
        </label>
        <div className="grid">
          <label>Jumlah (Rp)<input inputMode="numeric" value={principal} onChange={(e) => setPrincipal(e.target.value)} required /></label>
          <label>Tenor (bulan){product ? ` — maks. ${product.maxTenorMonths}` : ''}<input type="number" min="1" value={tenor} onChange={(e) => setTenor(e.target.value)} required /></label>
        </div>
        <label>Tujuan pinjaman<input value={purpose} onChange={(e) => setPurpose(e.target.value)} required /></label>


        <div className="card" style={{ margin: 0 }}>
          <h2 style={{ margin: '0 0 8px' }}>Simulasi angsuran</h2>
          {products.data.length === 0 && !products.loading ? (
            <p className="muted">Belum ada jenis pinjaman aktif. Hubungi pengurus.</p>
          ) : !product || preview.length === 0 ? (
            <p className="muted">Pilih jenis pinjaman, isi jumlah dan tenor untuk melihat simulasi angsuran.</p>
          ) : (
            <>
              <div className="grid">
                <div><div className="muted">Angsuran per bulan</div><strong>{firstInst === lastInst ? <Rp value={firstInst} /> : <><Rp value={firstInst} /> – <Rp value={lastInst} /></>}</strong></div>
                <div><div className="muted">Total bunga</div><strong><Rp value={totals.interest} /></strong></div>
                <div><div className="muted">Total yang dibayar</div><strong><Rp value={totals.total} /></strong></div>
                <div><div className="muted">Diterima (setelah biaya admin {product.adminFeePercent}%)</div><strong><Rp value={computeDisbursement(amount, product.adminFeePercent).netAmount} /></strong></div>
              </div>
              <p className="muted">Jadwal bersifat perkiraan (angsuran pertama bulan depan); jadwal final mengikuti tanggal pencairan.</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>#</th><th>Jatuh tempo</th><th className="num">Pokok</th><th className="num">Bunga</th><th className="num">Angsuran</th></tr></thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.no}><td>{r.no}</td><td>{r.dueDate}</td><td className="num"><Rp value={r.principal} /></td><td className="num"><Rp value={r.interest} /></td><td className="num"><Rp value={r.total} /></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {product && reasons.length > 0 && amount > 0 && (
          <div className="error" role="alert">
            Pengajuan belum memenuhi syarat:
            <ul>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}
        <Notice error={error} />
        <div><button className="primary" disabled={!product || reasons.length > 0}>Kirim pengajuan</button></div>
      </form>

    </>
  );
}
