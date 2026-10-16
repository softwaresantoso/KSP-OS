import { useDocument } from '../services/data.ts';
import { Rp } from './ui.tsx';
import { SUBSCRIPTION_STATE_LABELS, invoiceOf, subscriptionStatus, type Subscription } from '../core/subscription.ts';

const BADGE: Record<string, string> = { trial: 'warn', aktif: 'ok', segera_berakhir: 'warn', tenggang: 'warn', terkunci: 'bad', tanpa_batas: '' };

/** Status langganan aplikasi, jatuh tempo, dan nominal tagihan (untuk Ketua dan Bendahara). */
export function SubscriptionCard({ kid }: { kid: string }) {
  const koperasi = useDocument<{ subscription?: Subscription }>(`koperasi/${kid}`);
  const sub = koperasi.data?.subscription;
  if (koperasi.loading || !sub) return null;
  const st = subscriptionStatus(sub);
  const invoice = invoiceOf(sub);
  const needsPayment = st.state !== 'aktif';
  const left = st.daysLeft ?? 0;

  return (
    <>
      <h2>Langganan aplikasi</h2>
      <div className="card">
        <div className="grid">
          <div>
            <div className="muted">Status</div>
            <strong><span className={`badge ${BADGE[st.state]}`}>{SUBSCRIPTION_STATE_LABELS[st.state]}</span></strong>
            <div className="muted">{sub.plan === 'trial' ? 'Masa percobaan gratis' : 'Paket berlangganan'}</div>
          </div>
          <div>
            <div className="muted">Jatuh tempo pembayaran</div>
            <strong>{sub.validUntil}</strong>
            <div className="muted">{left >= 0 ? (left === 0 ? 'hari ini' : `${left} hari lagi`) : `lewat ${-left} hari`}</div>
          </div>
          <div>
            <div className="muted">Nominal tagihan</div>
            <strong>{invoice ? <Rp value={invoice.amount} /> : 'Belum ditetapkan'}</strong>
            {invoice && <div className="muted">perpanjangan {invoice.months} bulan (<Rp value={invoice.amount / invoice.months} />/bulan)</div>}
          </div>
        </div>
        {sub.paymentNote && needsPayment && (
          <p className="muted" style={{ whiteSpace: 'pre-line' }}><strong>Cara pembayaran:</strong>{'\n'}{sub.paymentNote}</p>
        )}
        {needsPayment && <p className="muted">Setelah membayar, konfirmasi ke pemilik platform; masa aktif akan diperbarui olehnya.</p>}
      </div>
    </>
  );
}
