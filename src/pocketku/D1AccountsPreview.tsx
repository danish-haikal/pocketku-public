import { useEffect, useState } from 'react';
import { getD1Accounts, type D1AccountRecord } from './d1AccountsApi';

type Props = { refreshKey?: number };

/** A read-only check against the local database, distinct from the demo ledger. */
export default function D1AccountsPreview({ refreshKey = 0 }: Props) {
  const [accounts, setAccounts] = useState<D1AccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void getD1Accounts()
      .then(rows => { if (active) { setAccounts(rows); setError(''); } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Cannot load accounts'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  return <section className="pk-card">
    <h2>Cloudflare D1 — local database accounts</h2>
    <p className="pk-muted">D1 cash, reserved funds and available cash are shown separately. Reserve does not change actual bank cash. Browser-only demonstration amounts remain separate.</p>
    {loading && <p className="pk-muted">Loading D1 accounts…</p>}
    {error && <p role="alert" className="pk-red">{error}</p>}
    {!loading && !error && accounts.length === 0 && <p className="pk-muted">No active D1 accounts yet.</p>}
    {!loading && !error && accounts.map(a => <div className="pk-simple-row" key={a.id}>
      <div><strong>{a.name}</strong><small>{a.bank_name} · {a.account_type} {a.is_protected ? '· Protected' : ''}</small><small>Opening: {new Intl.NumberFormat('en-MY', { style:'currency', currency:'MYR' }).format(a.opening_balance_sen / 100)}</small></div>
      <div style={{textAlign:'right',flexShrink:0}}>
        <strong>{new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(a.current_balance_sen/100)}</strong>
        <small>Reserved: {new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(a.reserved_balance_sen/100)}</small>
        <small>Available: {new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format((a.current_balance_sen-a.reserved_balance_sen)/100)}</small>
      </div>
    </div>)}
  </section>;
}
