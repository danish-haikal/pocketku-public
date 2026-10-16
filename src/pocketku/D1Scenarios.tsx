import {useEffect,useMemo,useState} from 'react';
import {getD1Accounts,type D1AccountRecord} from './d1AccountsApi';
import {getD1Income,type D1IncomeRecord} from './d1IncomeApi';
import {getD1Commitments,type D1Commitment} from './d1CommitmentsApi';
import {readD1Debts,type D1Debt} from './d1DebtsApi';
import {monthNames} from './types';
import './d1Scenarios.css';
const fmt=(sen:number)=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(sen/100);
export default function D1Scenarios({monthIndex}:{monthIndex:number}){
  const period=new Date(Date.UTC(2026,9+monthIndex,1)).toISOString().slice(0,7);
  const [accounts,setAccounts]=useState<D1AccountRecord[]>([]);
  const [income,setIncome]=useState<D1IncomeRecord[]>([]);
  const [bills,setBills]=useState<D1Commitment[]>([]);
  const [debts,setDebts]=useState<D1Debt[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [version,setVersion]=useState(0);
  const [refundKey,setRefundKey]=useState('');
  const [selectedDebts,setSelectedDebts]=useState<number[]>([]);
  useEffect(()=>{let active=true;void Promise.all([getD1Accounts(),getD1Income(),getD1Commitments(period),readD1Debts()]).then(([a,i,b,d])=>{if(active){setAccounts(a);setIncome(i);setBills(b);setDebts(d.debts);setError('')}}).catch(err=>{if(active)setError(err instanceof Error?err.message:String(err))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[period,version]);
  const refundOptions=useMemo(()=>income.filter(r=>r.income_type==='refund'&&r.ledger_entry_id===null),[income]);
  const refund=refundOptions.find(r=>r.income_key===refundKey)||refundOptions[0];
  const forecast=refund?.expected_amount_sen??0;
  const cash=accounts.reduce((sum,a)=>sum+a.current_balance_sen,0);
  const reserved=accounts.reduce((sum,a)=>sum+a.reserved_balance_sen,0);
  const unpaid=bills.filter(b=>b.status!=='paid').reduce((sum,b)=>sum+b.amount_sen,0);
  const settlementTotal=debts.filter(d=>!d.archived_at&&selectedDebts.includes(d.id)).reduce((sum,d)=>sum+d.remaining_sen,0);
  const selectedMonth=monthNames[monthIndex]||monthNames[0];
  const compare=(withRefund:boolean)=>{
    const incoming=withRefund?forecast:0;
    const afterBills=cash+incoming-unpaid;
    return {incoming,afterBills,afterSettlements:afterBills-settlementTotal};
  };
  const toggle=(id:number)=>setSelectedDebts(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  return <section className="pk-scenario" aria-label="Financial scenarios">
    <div className="pk-prod-heading"><h1>Financial scenarios</h1><p>Plan for both outcomes of an expected refund, without changing your saved money.</p></div>
    {error&&<div role="alert" className="pk-red">{error}</div>}
    {loading?<p role="status">Loading your financial records…</p>:<>
      <div className="pk-scenario-overview">
        <div><small>Cash across accounts</small><strong>{fmt(cash)}</strong></div>
        <div><small>Currently reserved</small><strong>{fmt(reserved)}</strong></div>
        <div><small>Unpaid commitments · {selectedMonth}</small><strong>{fmt(unpaid)}</strong></div>
      </div>
      <section className="pk-card"><div className="pk-row"><h2>Expected refund</h2><button className="pk-btn" type="button" onClick={()=>setVersion(v=>v+1)}>↻ Refresh</button></div>
        {refundOptions.length>0?<>
          <label className="pk-scenario-label">Choose a planned refund
            <select className="pk-input" value={refund?.income_key||''} onChange={e=>setRefundKey(e.target.value)}>{refundOptions.map(r=><option value={r.income_key} key={r.income_key}>{r.source_name} · {fmt(r.expected_amount_sen||0)}{r.expected_date?` · ${r.expected_date}`:''}</option>)}</select>
          </label><p className="pk-muted">PocketKu uses the amount from your Income page. To update this estimate, edit that record under Income.</p>
        </>:<p className="pk-muted">No pending refund is recorded. Add an expected refund under Income to compare its arrival against a no-refund plan.</p>}
      </section>
      {refund?.expected_date&&refund.expected_date.slice(0,7)>period&&<p className="pk-scenario-disclaimer">The selected refund is expected after {selectedMonth}. Scenario A is a hypothetical future receipt, not money available during that month.</p>}
      <div className="pk-scenario-grid">
        {[{yes:true,title:'Scenario A',subtitle:'Refund received',note:'Assumes your pending refund arrives.'},{yes:false,title:'Scenario B',subtitle:'Refund delayed / not received',note:'No refund assumed. Conservative baseline.'}].map(option=>{
          const output=compare(option.yes);
          return <article className="pk-scenario-card" key={option.title}>
            <div className="pk-scenario-label-small">{option.title}</div><h2>{option.subtitle}</h2><p>{option.note}</p>
            <dl><div><dt>Refund assumed</dt><dd>{fmt(output.incoming)}</dd></div><div><dt>Starting cash</dt><dd>{fmt(cash)}</dd></div><div><dt>Unpaid {selectedMonth} commitments</dt><dd>−{fmt(unpaid)}</dd></div></dl>
            <div className="pk-scenario-result"><small>Illustrative cash after unpaid bills</small><strong className={output.afterBills<0?'pk-scenario-negative':''}>{fmt(output.afterBills)}</strong></div>
            {settlementTotal>0&&<div className="pk-scenario-result secondary"><small>After selected lump-sum settlements ({fmt(settlementTotal)})</small><strong className={output.afterSettlements<0?'pk-scenario-negative':''}>{fmt(output.afterSettlements)}</strong></div>}
          </article>
        })}
      </div>
      <section className="pk-card"><h2>Optional: include lump-sum settlements</h2><p className="pk-muted">Select debts you might settle in full. This is only a hypothetical calculation; use current verified settlement quotes before acting.</p>
        {debts.filter(d=>!d.archived_at&&d.remaining_sen>0).length===0?<p className="pk-muted">No outstanding debts recorded yet.</p>:<div className="pk-scenario-debts">{debts.filter(d=>!d.archived_at&&d.remaining_sen>0).map(d=><label className="pk-scenario-debt" key={d.id}><input type="checkbox" checked={selectedDebts.includes(d.id)} onChange={()=>toggle(d.id)}/><span>{d.name}</span><strong>{fmt(d.remaining_sen)}</strong></label>)}</div>}
        {settlementTotal>0&&<p className="pk-muted">Selected settlements: {fmt(settlementTotal)}. Some monthly instalments may belong to these debts. Review both lists to avoid treating the same obligation as an additional expense.</p>}
      </section>
      <p className="pk-scenario-disclaimer"><b>Planning only.</b> No scenario changes bank cash, income status, reservations, repayments or debt balances. The figures are projections, not a recommendation to spend. Refund timing and settlement amounts remain uncertain.</p>
    </>}
  </section>;
}
