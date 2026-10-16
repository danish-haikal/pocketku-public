import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {getD1Accounts,type D1AccountRecord} from './d1AccountsApi';
import {confirmD1Income,createD1ExpectedIncome,getD1Income,updateD1IncomeEstimate,type D1IncomeRecord} from './d1IncomeApi';
import {monthNames} from './types';
const fmt=(v:number)=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(v/100);
const cents=(s:string):number|null=>{if(!/^\d+(?:\.\d{1,2})?$/.test(s.trim()))return null;const [w,f='']=s.split('.');const n=Number(w)*100+Number(f.padEnd(2,'0'));return Number.isSafeInteger(n)?n:null};
const monthOptions=monthNames.map((label,index)=>({label,value:new Date(Date.UTC(2026,9+index,1)).toISOString().slice(0,7)}));
export default function D1IncomeManager(){
  const [rows,setRows]=useState<D1IncomeRecord[]>([]);
  const [accounts,setAccounts]=useState<D1AccountRecord[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [month,setMonth]=useState('all');
  const [status,setStatus]=useState<'all'|'expected'|'received'>('all');
  const [editing,setEditing]=useState<string|null>(null);
  const pending=useRef<{signature:string;key:string}|null>(null);
  useEffect(()=>{let active=true;void Promise.all([getD1Income(),getD1Accounts()]).then(([income,banks])=>{if(active){setRows(income);setAccounts(banks)}}).catch(e=>{if(active)setError(e instanceof Error?e.message:String(e))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
  async function refresh(){const [income,banks]=await Promise.all([getD1Income(),getD1Accounts()]);setRows(income);setAccounts(banks);window.dispatchEvent(new Event('pocketku:d1-accounts-changed'))}
  async function create(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;
    const form=e.currentTarget, f=new FormData(form);const source=String(f.get('source')||'').trim(),period=String(f.get('period')||'');
    const amountText=String(f.get('amount')||'').trim(),amount=amountText?cents(amountText):null;
    if(!source||!/^\d{4}-\d{2}$/.test(period)||(amountText!==''&&amount===null)){setError('Enter a source, month and a valid estimated amount.');return}
    const body={source_name:source,income_type:String(f.get('kind')||'other') as D1IncomeRecord['income_type'],period,expected_amount_sen:amount,expected_date:String(f.get('date')||'')||null};
    const signature=JSON.stringify(body);if(pending.current?.signature!==signature)pending.current={signature,key:'manual:'+crypto.randomUUID()};
    setBusy(true);setError('');try{await createD1ExpectedIncome({...body,income_key:pending.current.key});pending.current=null;form.reset();setMessage('Expected income saved. No bank balance was changed.');await refresh()}
    catch(err){setError(err instanceof Error?err.message:String(err))}finally{setBusy(false)}
  }
  async function saveEstimate(e:FormEvent<HTMLFormElement>,item:D1IncomeRecord){e.preventDefault();if(busy)return;const f=new FormData(e.currentTarget),amount=cents(String(f.get('amount')||''));
    if(amount===null){setError('Enter a valid amount.');return}setBusy(true);setError('');try{await updateD1IncomeEstimate({income_key:item.income_key,expected_amount_sen:amount,expected_date:String(f.get('date')||'')||null});await refresh();setEditing(null);setMessage('Estimate updated. No bank balance changed.')}catch(err){setError(err instanceof Error?err.message:String(err))}finally{setBusy(false)}
  }
  async function receive(e:FormEvent<HTMLFormElement>,item:D1IncomeRecord){e.preventDefault();if(busy)return;const f=new FormData(e.currentTarget),amount=cents(String(f.get('amount')||'')),accountId=Number(f.get('bank'));const account=accounts.find(x=>x.id===accountId&&x.is_active===1);
    if(!amount||!account){setError('Select a valid amount and receiving account.');return}
    if(!window.confirm(`Confirm ${fmt(amount)} was actually received into ${account.name}? This will increase the bank balance.`))return;
    setBusy(true);setError('');try{await confirmD1Income({income_key:item.income_key,account_id:accountId,amount_sen:amount});await refresh();setMessage('Income received and credited once.')}catch(err){setError(err instanceof Error?err.message:String(err))}finally{setBusy(false)}
  }
  const visible=useMemo(()=>rows.filter(x=>(month==='all'||(x.period||x.expected_date?.slice(0,7))===month)&&(status==='all'||(status==='received')===(x.ledger_entry_id!==null))),[rows,month,status]);
  const expected=visible.filter(x=>x.ledger_entry_id===null).reduce((n,x)=>n+(x.expected_amount_sen||0),0);
  const received=visible.filter(x=>x.ledger_entry_id!==null).reduce((n,x)=>n+(x.received_amount_sen||0),0);
  return <div className="pk-prod-panel"><div className="pk-prod-heading"><h1>Income</h1><p>Plan expected money and confirm it only after it arrives.</p></div>
    {error&&<p className="pk-red" role="alert">{error}</p>}{message&&<div className="pk-notice" role="status">{message}</div>}
    <section className="pk-card"><h2>New expected income</h2><p className="pk-muted">Adding a forecast does not change your bank balances.</p>
      <form className="pk-form pk-two" onSubmit={e=>void create(e)}>
        <label>Source<input required maxLength={100} className="pk-input" name="source" placeholder="Income source"/></label>
        <label>Type<select className="pk-input" name="kind"><option value="other">Other</option><option value="family">Family</option><option value="refund">Refund</option><option value="mara">Allowance</option></select></label>
        <label>Planning month<select name="period" className="pk-input" defaultValue={monthOptions[0]?.value}>{monthOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Expected amount (RM)<input name="amount" className="pk-input" type="number" min="0" step=".01" placeholder="Optional"/></label>
        <label>Expected date<input name="date" className="pk-input" type="date"/></label>
        <button className="pk-btn pk-primary" type="submit" disabled={busy}>{busy?'Saving…':'Save expected income'}</button>
      </form>
    </section>
    <section className="pk-card"><div className="pk-row"><h2>Income timeline</h2><button className="pk-btn" type="button" disabled={busy||loading} onClick={()=>void refresh()}>↻ Refresh</button></div>
      <div className="pk-prod-filters"><label>Month<select className="pk-input" value={month} onChange={e=>setMonth(e.target.value)}><option value="all">All months</option>{[...new Set(rows.map(r=>r.period||r.expected_date?.slice(0,7)||'unscheduled'))].sort().map(p=><option key={p} value={p}>{p}</option>)}</select></label>
        <label>Status<select className="pk-input" value={status} onChange={e=>setStatus(e.target.value as typeof status)}><option value="all">All</option><option value="expected">Expected</option><option value="received">Received</option></select></label>
      </div>
      <div className="pk-prod-totals"><div><small>Expected</small><strong>{fmt(expected)}</strong></div><div><small>Received</small><strong>{fmt(received)}</strong></div></div>
      {loading?<p role="status">Loading income…</p>:visible.length===0?<p className="pk-muted">No income records for these filters.</p>:visible.map(item=>{const done=item.ledger_entry_id!==null;const edit=editing===item.income_key;return <div className="pk-prod-income" key={item.income_key}>
        <div className="pk-row"><div><strong>{item.source_name}</strong><small>{item.period||'Unscheduled'} · {item.expected_date||'Date not set'}</small></div><span className={'pk-tag '+(done?'pk-done':'')}>{done?'Received':'Expected'}</span></div>
        {done?<div className="pk-simple-row"><strong>{fmt(item.received_amount_sen||0)}</strong><small>{item.receiving_account_name||'Account'}</small></div>:<>
          <div className="pk-simple-row"><span>Planned amount</span><strong>{item.expected_amount_sen===null?'Not set':fmt(item.expected_amount_sen)}</strong></div>
          <button className="pk-btn" type="button" disabled={busy} onClick={()=>setEditing(edit?null:item.income_key)}>{edit?'Cancel edit':'Edit estimate'}</button>
          {edit?<form className="pk-form pk-two" onSubmit={e=>void saveEstimate(e,item)}><label>Amount (RM)<input className="pk-input" name="amount" required type="number" min="0" step=".01" defaultValue={((item.expected_amount_sen||0)/100).toFixed(2)}/></label><label>Expected date<input className="pk-input" name="date" type="date" defaultValue={item.expected_date||''}/></label><button type="submit" className="pk-btn pk-primary" disabled={busy}>Save estimate</button></form>
          :<form className="pk-form pk-two" onSubmit={e=>void receive(e,item)}>
            <label>Actual amount received (RM)<input name="amount" className="pk-input" required type="number" min=".01" step=".01" defaultValue={item.expected_amount_sen===null?'':(item.expected_amount_sen/100).toFixed(2)}/></label>
            <label>Receiving account<select name="bank" className="pk-input" required defaultValue=""><option value="">Choose account</option>{accounts.filter(a=>a.is_active===1).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <button className="pk-btn pk-primary" type="submit" disabled={busy||accounts.length===0}>Mark Received</button>
          </form>}
        </>}
      </div>})}
      <p className="pk-muted">Expected amounts are forecasts. Only Mark Received posts money to an account.</p>
    </section>
  </div>
}
