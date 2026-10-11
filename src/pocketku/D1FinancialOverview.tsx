/** PocketKu Step 7.19 — read-only D1 financial overview.
 * Real D1 cash, reservations, and monthly funding are never blended with
 * browser-only demonstration data. No money-changing endpoints are used here.
 */
import { useEffect, useMemo, useState } from 'react';
import { getD1Accounts, type D1AccountRecord } from './d1AccountsApi';
import { getD1Commitments, getD1Funding, type D1Commitment, type D1FundingSplit } from './d1CommitmentsApi';
import { amount, monthNames } from './types';
import './d1FinancialOverview.css';

type Props = {
  mode: 'overview' | 'funding';
  monthIndex: number;
  onOpenMonthly: () => void;
  onOpenAccounts: () => void;
};

type Snapshot = {
  accounts: D1AccountRecord[];
  commitments: D1Commitment[];
  funding: D1FundingSplit[];
};

// Stable fallbacks prevent useMemo dependencies changing on each empty render.
const EMPTY_ACCOUNTS: D1AccountRecord[] = [];
const EMPTY_COMMITMENTS: D1Commitment[] = [];
const EMPTY_FUNDING: D1FundingSplit[] = [];

const months = monthNames.map((_, index) => new Date(Date.UTC(2026, 9 + index, 1)).toISOString().slice(0, 7));

function safeSum(numbers: number[]): number {
  return numbers.reduce((total, value) => total + value, 0);
}

function money(value: number): string { return amount(value); }

export default function D1FinancialOverview({ mode, monthIndex, onOpenMonthly, onOpenAccounts }: Props) {
  const period = months[monthIndex] ?? months[0];
  const monthLabel = monthNames[monthIndex] ?? monthNames[0];
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadedPeriod, setLoadedPeriod] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const onAccountChange = () => {setBusy(true);setRefreshKey(n => n + 1);};
    window.addEventListener('pocketku:d1-accounts-changed', onAccountChange);
    return () => window.removeEventListener('pocketku:d1-accounts-changed', onAccountChange);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([getD1Accounts(), getD1Commitments(period), getD1Funding(period)])
      .then(([accounts, commitments, funding]) => {
        if (!active) return;
        if (accounts.some(a => !Number.isSafeInteger(a.current_balance_sen) ||
          !Number.isSafeInteger(a.reserved_balance_sen) || a.reserved_balance_sen < 0)) {
          throw new Error('Account balances are incomplete. Check the local Accounts API before proceeding.');
        }
        setSnapshot({accounts, commitments, funding});
        setLoadedPeriod(period);
        setError('');
      })
      .catch(problem => {
        if (active) { setError(problem instanceof Error ? problem.message : 'D1 data is unavailable.'); setSnapshot(null); }
      })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [period, refreshKey]);

  // Don't show stale numbers for a different month during a month change.
  const data = loadedPeriod === period ? snapshot : null;
  const accounts = data?.accounts ?? EMPTY_ACCOUNTS;
  const commitments = data?.commitments ?? EMPTY_COMMITMENTS;
  const funding = data?.funding ?? EMPTY_FUNDING;

  const totals = useMemo(() => {
    const cash = safeSum(accounts.map(a => a.current_balance_sen));
    // Reserved is a GLOBAL current hold, across all allocation months.
    const reserved = safeSum(accounts.map(a => a.reserved_balance_sen));
    const monthPlan = safeSum(commitments.map(c => c.amount_sen));
    const monthReserved = safeSum(commitments.filter(c => c.status === 'reserved').map(c => c.amount_sen));
    const monthPaid = safeSum(commitments.filter(c => c.status === 'paid').map(c => c.amount_sen));
    const monthUnallocated = safeSum(commitments.filter(c => c.status === 'unallocated').map(c => c.amount_sen));
    const monthAssigned = safeSum(funding.map(f => f.amount_sen));
    const byCommitment = new Map<number, number>();
    funding.forEach(f => byCommitment.set(f.commitment_id, (byCommitment.get(f.commitment_id) ?? 0) + f.amount_sen));
    const notFunded = safeSum(commitments.filter(c => c.status === 'unallocated').map(c =>
      Math.max(0, c.amount_sen - (byCommitment.get(c.id) ?? 0))));
    return {cash, reserved, available: cash - reserved, monthPlan, monthReserved,
      monthPaid, monthUnallocated, monthAssigned, notFunded};
  }, [accounts, commitments, funding]);

  const fundingByAccount = useMemo(() => {
    const commitmentsById = new Map(commitments.map(c => [c.id, c]));
    return accounts.map(account => {
      const rows = funding.filter(source => source.account_id === account.id)
        .map(source => ({ source, commitment: commitmentsById.get(source.commitment_id) }))
        .filter((row): row is {source: D1FundingSplit; commitment: D1Commitment} => Boolean(row.commitment));
      return {
        account,
        rows,
        planned: safeSum(rows.filter(row => row.commitment.status === 'unallocated').map(row => row.source.amount_sen)),
        reservedInMonth: safeSum(rows.filter(row => row.commitment.status === 'reserved').map(row => row.source.amount_sen)),
        paidInMonth: safeSum(rows.filter(row => row.commitment.status === 'paid').map(row => row.source.amount_sen)),
      };
    });
  }, [accounts, commitments, funding]);

  return <div className="pk-d1finance" aria-label={mode === 'overview' ? 'D1 financial dashboard' : 'D1 money sources'}>
    <div className="pk-f-header">
      <div><span className="pk-f-eyebrow">LOCAL D1 · SOURCE OF TRUTH</span>
        <h2>{mode === 'overview' ? 'Your money at a glance' : 'Where your monthly money comes from'}</h2>
        <p>{mode === 'overview'
          ? 'Actual account cash and reservations are calculated from your saved records—not the browser demo.'
          : 'See which accounts are funding bills in this month. Make or change assignments from the Monthly Plan.'}</p>
      </div>
      <button className="pk-btn" onClick={() => {setBusy(true);setRefreshKey(n => n + 1)}} disabled={busy} type="button">
        {busy ? 'Refreshing…' : '↻ Refresh'}
      </button>
    </div>

    {error && <div className="pk-f-error" role="alert">Could not load D1 information: {error}</div>}
    {!data && !error && <div className="pk-f-loading" role="status">Loading saved account and commitment balances…</div>}
    {data && <>
      <div className="pk-f-stats" aria-label="Global bank account totals">
        <div><span>Total cash</span><strong>{money(totals.cash)}</strong><small>Ledger balances across D1 accounts</small></div>
        <div><span>Reserved money</span><strong>{money(totals.reserved)}</strong><small>Holds across all months, not spent</small></div>
        <div className="pk-f-available"><span>Available cash</span><strong>{money(totals.available)}</strong><small>Cash minus current reservations</small></div>
      </div>
      <div className="pk-f-periodnote">Cash and reserved totals cover <b>all D1 accounts and all months</b>. The commitment figures below refer only to <b>{monthLabel}</b>.</div>
      <section className="pk-f-panel">
        <div className="pk-f-sectiontitle">
          <div><h3>{monthLabel} commitments</h3><p>{commitments.length} planned items · Allocation month, not necessarily due month</p></div>
          <button className="pk-btn pk-primary" type="button" onClick={onOpenMonthly}>Open Monthly Plan →</button>
        </div>
        <div className="pk-f-monthgrid">
          <div><span>Total planned</span><strong>{money(totals.monthPlan)}</strong></div>
          <div><span>Not allocated</span><strong>{money(totals.monthUnallocated)}</strong></div>
          <div><span>Reserved</span><strong>{money(totals.monthReserved)}</strong></div>
          <div><span>Paid</span><strong>{money(totals.monthPaid)}</strong></div>
        </div>
        <div className="pk-f-fundinggap">
          <span>Still needs a funding source</span><strong>{money(totals.notFunded)}</strong>
        </div>
        <p className="pk-f-note">Assigned to funding sources this month: {money(totals.monthAssigned)}. Assigning money is only a plan; a reservation is a hold; Paid is an actual expense. Never add these three numbers together as cash.</p>
      </section>
      <section className="pk-f-panel">
        <div className="pk-f-sectiontitle">
          <div><h3>D1 accounts & funding</h3><p>Cash reflects income, transfers and paid expenses already recorded in D1.</p></div>
          <button className="pk-btn" type="button" onClick={onOpenAccounts}>Manage accounts →</button>
        </div>
        {accounts.length === 0 ? <p className="pk-f-empty">No saved D1 accounts. Add a fictional test account from My Accounts.</p> :
          <div className="pk-f-accounts">{fundingByAccount.map(({account,rows,planned,reservedInMonth,paidInMonth}) => {
            const available = account.current_balance_sen - account.reserved_balance_sen;
            return <article className="pk-f-account" key={account.id}>
              <div className="pk-f-account-head"><div><strong>{account.name}</strong>
                <span>{account.bank_name} · {account.account_type === 'tabung' ? 'Tabung' : 'Bank account'}{account.is_protected === 1 ? ' · Protected' : ''}</span></div>
                <strong className="pk-f-cash">{money(account.current_balance_sen)}</strong></div>
              <div className="pk-f-account-sums">
                <span>Reserved <b>{money(account.reserved_balance_sen)}</b></span>
                <span>Available <b>{money(available)}</b></span>
              </div>
              {mode === 'funding' && <>
                <div className="pk-f-splits">
                  <div><small>Assigned, not reserved · {monthLabel}</small><strong>{money(planned)}</strong></div>
                  <div><small>Reserved · {monthLabel}</small><strong>{money(reservedInMonth)}</strong></div>
                  <div><small>Paid from this account · {monthLabel}</small><strong>{money(paidInMonth)}</strong></div>
                </div>
                {rows.length > 0 ? <div className="pk-f-commitments">{rows.map(({source,commitment}) =>
                  <div className="pk-f-commitment" key={commitment.id}>
                    <div><strong>{commitment.name}</strong><small>{commitment.status === 'unallocated' ? 'Assigned, not reserved' : commitment.status === 'reserved' ? 'Reserved' : 'Paid'}{commitment.due_date ? ` · Due ${commitment.due_date}` : ''}</small></div>
                    <b>{money(source.amount_sen)}</b>
                  </div>)}</div>
                : <p className="pk-f-noassignments">No commitments assigned to this account for {monthLabel}.</p>}
              </>}
            </article>;
          })}</div>}
      </section>
      {mode === 'funding' && <div className="pk-f-bottom">
        <p><b>To add or edit funding:</b> open Monthly Plan, find the bill, then select <b>+ Add Funding Source</b>. You can split one bill across several accounts. This screen is a read-only summary to prevent double entry.</p>
        <button className="pk-btn pk-primary" type="button" onClick={onOpenMonthly}>Manage bill funding →</button>
      </div>}
    </>}
  </div>;
}
