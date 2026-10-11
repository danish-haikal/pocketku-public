import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { getD1Accounts, type D1AccountRecord } from './d1AccountsApi';
import {
  createD1Debt,editD1Debt,postD1DebtPayment,readD1Debts,
  readEligibleDebtCommitments,
  type CreateDebt,type D1Debt,type D1DebtPayment,type PaidCommitment,
} from './d1DebtsApi';
import './d1Debts.css';

const money=(sen:number)=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(sen/100);
const dateToday=()=>{
  const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const cents=(value:string):number|null=>{
  if(!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))return null;
  const [whole,dec='']=value.trim().split('.');
  const result=Number(whole)*100+Number(dec.padEnd(2,'0'));
  return Number.isSafeInteger(result)&&result>=0&&result<=100000000000?result:null;
};
const rm=(sen:number)=>((sen/100).toFixed(2));
const uuid=()=>crypto.randomUUID();

type DraftPayment={mode:'direct'|'commitment';amount:string;account:string;commitment:string;date:string;note:string};
const freshPayment=():DraftPayment=>({mode:'direct',amount:'',account:'',commitment:'',date:dateToday(),note:''});
type DraftDebt={name:string;creditor:string;outstanding:string;date:string;note:string};
const freshDebt=():DraftDebt=>({name:'',creditor:'',outstanding:'',date:dateToday(),note:''});

export default function D1Debts() {
  const [debts,setDebts]=useState<D1Debt[]>([]);
  const [payments,setPayments]=useState<D1DebtPayment[]>([]);
  const [accounts,setAccounts]=useState<D1AccountRecord[]>([]);
  const [eligible,setEligible]=useState<PaidCommitment[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [search,setSearch]=useState('');
  const [createOpen,setCreateOpen]=useState(false);
  const [newDebt,setNewDebt]=useState<DraftDebt>(freshDebt);
  const [expanded,setExpanded]=useState<number|null>(null);
  const [editId,setEditId]=useState<number|null>(null);
  const [editDraft,setEditDraft]=useState<DraftDebt>(freshDebt);
  const [paymentDraft,setPaymentDraft]=useState<DraftPayment>(freshPayment);
  const [recent,setRecent]=useState<number|null>(null);
  // Reuse the same reference after a network interruption to avoid charging twice.
  const pendingCreate=useRef<{signature:string;key:string}|null>(null);
  const pendingPayment=useRef<{signature:string;key:string}|null>(null);

  async function refresh(){
    try {
      const [data,banks,links]=await Promise.all([readD1Debts(),getD1Accounts(),readEligibleDebtCommitments()]);
      setDebts(data.debts);setPayments(data.payments);setAccounts(banks);setEligible(links);setError('');
    } catch(err){setError(err instanceof Error?err.message:'Could not load debt data.');}
  }
  // Initial fetch: only update React state when the asynchronous request settles.
  useEffect(()=>{
    let active=true;
    void Promise.all([readD1Debts(),getD1Accounts(),readEligibleDebtCommitments()])
      .then(([data,banks,links])=>{if(active){setDebts(data.debts);setPayments(data.payments);setAccounts(banks);setEligible(links);setError('')}})
      .catch(err=>{if(active)setError(err instanceof Error?err.message:'Could not load debt data.')})
      .finally(()=>{if(active)setLoading(false)});
    return ()=>{active=false};
  },[]);

  const shown=useMemo(()=>debts.filter(d=>`${d.name} ${d.creditor}`.toLowerCase().includes(search.trim().toLowerCase())),[debts,search]);
  const totalStart=debts.reduce((s,d)=>s+d.starting_balance_sen,0);
  const totalPaid=debts.reduce((s,d)=>s+d.repaid_sen,0);
  const totalLeft=debts.reduce((s,d)=>s+d.remaining_sen,0);

  async function submitDebt(e:FormEvent){
    e.preventDefault();if(busy)return;
    const amount=cents(newDebt.outstanding);
    if(!newDebt.name.trim()||!amount||!newDebt.date){setError('Enter a debt name, positive outstanding balance and valid date.');return}
    const draft:Omit<CreateDebt,'creation_key'>={name:newDebt.name.trim(),creditor:newDebt.creditor.trim(),
      starting_balance_sen:amount,as_of_date:newDebt.date,note:newDebt.note.trim()};
    const sig=JSON.stringify(draft);
    const key=pendingCreate.current?.signature===sig?pendingCreate.current.key:`debt:${uuid()}`;
    pendingCreate.current={signature:sig,key};
    setBusy(true);setError('');setMessage('');
    try {
      await createD1Debt({...draft,creation_key:key});
      pendingCreate.current=null;
      setNewDebt(freshDebt());setCreateOpen(false);setMessage('Debt saved in local D1. It has not changed any bank balance.');
      await refresh();
    } catch(err){setError(err instanceof Error?err.message:'Unable to create debt.');}
    finally {setBusy(false)}
  }
  function startEdit(d:D1Debt){
    setEditId(d.id);setEditDraft({name:d.name,creditor:d.creditor,outstanding:rm(d.starting_balance_sen),date:d.as_of_date,note:d.note});
  }
  async function submitEdit(e:FormEvent,d:D1Debt){
    e.preventDefault();if(busy)return;
    const amount=cents(editDraft.outstanding);
    if(!amount || amount<d.repaid_sen){setError('Starting balance must not be below already recorded repayments.');return;}
    setBusy(true);setError('');setMessage('');
    try {
      await editD1Debt(d.id,{name:editDraft.name.trim(),creditor:editDraft.creditor.trim(),starting_balance_sen:amount,note:editDraft.note.trim()});
      setEditId(null);setRecent(d.id);setMessage('Debt details saved. No bank transactions changed.');await refresh();
    } catch(err){setError(err instanceof Error?err.message:'Unable to edit debt.');}
    finally {setBusy(false)}
  }
  function openRepayment(id:number){
    setExpanded(prev=>prev===id?null:id);setPaymentDraft(freshPayment());setEditId(null);setError('');
    pendingPayment.current=null;
  }
  async function submitPayment(e:FormEvent,d:D1Debt){
    e.preventDefault();if(busy)return;
    const amount=cents(paymentDraft.amount);
    if(!amount||amount>d.remaining_sen){setError('Repayment must be positive and no more than this debt’s remaining balance.');return}
    const mode=paymentDraft.mode;
    const accountId=mode==='direct'?Number(paymentDraft.account):null;
    const commitmentId=mode==='commitment'?Number(paymentDraft.commitment):null;
    const bank=accounts.find(a=>a.id===accountId);
    const linked=eligible.find(c=>c.id===commitmentId);
    if(mode==='direct'&&(!bank||bank.is_active!==1)) {setError('Select an active D1 bank account.');return;}
    if(mode==='direct'&&bank && bank.current_balance_sen-bank.reserved_balance_sen<amount){
      setError('This account does not have enough available cash after reservations.');return;
    }
    if(mode==='commitment'&&(!linked||linked.paid_sen<amount)){
      setError('Select an already-paid monthly commitment with enough recorded payment value.');return;
    }
    const protectedBank=mode==='direct'&&bank?.is_protected===1;
    const summary=mode==='direct'
      ? `Record ${money(amount)} paid from ${bank?.name} towards “${d.name}”? This will debit your D1 bank cash.`
      : `Link ${money(amount)} of the already-paid commitment “${linked?.name}” to “${d.name}”? No second bank debit will be created.`;
    if(!window.confirm(summary+(protectedBank?' This uses a protected Tabung.':'')))return;
    const draft={mode,amount_sen:amount,account_id:accountId,commitment_id:commitmentId,
      paid_on:paymentDraft.date,note:paymentDraft.note.trim(),acknowledge_protected:protectedBank};
    const sig=JSON.stringify({debtId:d.id,...draft});
    const key=pendingPayment.current?.signature===sig?pendingPayment.current.key:`pay:${uuid()}`;
    pendingPayment.current={signature:sig,key};
    setBusy(true);setError('');setMessage('');
    try {
      await postD1DebtPayment(d.id,{...draft,payment_key:key});
      pendingPayment.current=null;
      setRecent(d.id);setExpanded(null);
      setMessage(mode==='direct'?'Bank debit and debt reduction saved once.':'Existing paid commitment linked—no extra bank debit.');
      await refresh();
      // Let Overview and My Accounts update their D1 balance snapshots.
      window.dispatchEvent(new Event('pocketku:d1-accounts-changed'));
    } catch(err){setError(err instanceof Error?err.message:'Could not record repayment. Refresh before retrying.');}
    finally {setBusy(false)}
  }
  return <div className="pk-debt" aria-label="D1 debts and repayments">
    <header className="pk-debt-head"><div><small className="pk-debt-eyebrow">LOCAL D1 · DEBT TRACKER</small>
      <h2>Debts & repayments</h2>
      <p>Track an outstanding balance, payments and the cash account actually used.</p>
    </div><button className="pk-btn" type="button" disabled={busy} onClick={()=>void refresh()}>↻ Refresh</button></header>
    <div className="pk-debt-stats">
      <div><span>Starting debt</span><strong>{money(totalStart)}</strong><small>Snapshot when each debt was added</small></div>
      <div><span>Repayments recorded</span><strong>{money(totalPaid)}</strong><small>Bank debits or linked paid instalments</small></div>
      <div><span>Outstanding now</span><strong>{money(totalLeft)}</strong><small>Not deducted from your bank cash</small></div>
    </div>
    <div className="pk-debt-explain"><b>If the debt has monthly instalments:</b> Use Monthly Plan → Set Up Financing once. After that, Mark Paid updates both your bank and remaining debt automatically. Direct repayments here are for extra or early payments; link an old paid instalment only when correcting past records.</div>
    {error&&<div className="pk-debt-alert error" role="alert">{error}</div>}
    {message&&<div className="pk-debt-alert" role="status">{message}</div>}
    <div className="pk-debt-toolbar">
      <label>Find a debt<input className="pk-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or creditor"/></label>
      <span>{shown.length} of {debts.length} debts</span>
      <button className="pk-btn pk-primary" type="button" onClick={()=>setCreateOpen(v=>!v)}>{createOpen?'Close form':'+ Add standalone debt'}</button>
    </div>
    {createOpen&&<form className="pk-debt-form" onSubmit={e=>void submitDebt(e)}>
      <h3>New standalone debt or settlement</h3>
      <p>Enter the amount still owed <b>as of the date below</b>, not the original borrowed amount if you've already made repayments.</p>
      <div className="pk-debt-fields">
        <label>Debt name<input required className="pk-input" maxLength={120} value={newDebt.name} onChange={e=>setNewDebt(v=>({...v,name:e.target.value}))} placeholder="Fictional Loan Test"/></label>
        <label>Creditor / provider<input className="pk-input" maxLength={120} value={newDebt.creditor} onChange={e=>setNewDebt(v=>({...v,creditor:e.target.value}))} placeholder="Demo provider"/></label>
        <label>Outstanding as of this date (RM)<input required type="number" min="0.01" step="0.01" className="pk-input" value={newDebt.outstanding} onChange={e=>setNewDebt(v=>({...v,outstanding:e.target.value}))} placeholder="20.00"/></label>
        <label>Balance as-of date<input required type="date" className="pk-input" value={newDebt.date} onChange={e=>setNewDebt(v=>({...v,date:e.target.value}))}/></label>
        <label className="pk-debt-wide">Optional note<textarea className="pk-input" rows={2} maxLength={500} value={newDebt.note} onChange={e=>setNewDebt(v=>({...v,note:e.target.value}))} placeholder="Estimated figure; verify final statement"/></label>
      </div>
      <button className="pk-btn pk-primary" disabled={busy} type="submit">{busy?'Saving…':'Save debt to D1'}</button>
    </form>}
    {loading?<p className="pk-debt-empty">Loading debts from D1…</p>:
      shown.length===0?<p className="pk-debt-empty">No matching debts yet. Add a fictional one to test the tracker.</p>:
      <div className="pk-debt-list">{shown.map(d=>{
        const related=payments.filter(p=>p.debt_id===d.id);
        const progress=d.starting_balance_sen>0?Math.max(0,Math.min(100,d.repaid_sen/d.starting_balance_sen*100)):0;
        const active=expanded===d.id;
        const paidChoice=eligible.find(c=>String(c.id)===paymentDraft.commitment);
        return <article className={`pk-debt-card ${recent===d.id?'recent':''}`} key={d.id}>
          <div className="pk-debt-cardhead"><div><h3>{d.name}</h3><small>{d.creditor||'No provider entered'} · Balance as at {d.as_of_date}</small></div>
            <div><span>Outstanding</span><strong>{money(d.remaining_sen)}</strong></div></div>
          <div className="pk-debt-track"><div style={{width:`${progress}%`}}/></div>
          <div className="pk-debt-mini"><span>Starting {money(d.starting_balance_sen)}</span><span>Paid {money(d.repaid_sen)}</span><b>{d.remaining_sen===0?'Settled':'In progress'}</b></div>
          {d.note&&<p className="pk-debt-note">{d.note}</p>}
          <div className="pk-debt-cardactions">
            <button type="button" className="pk-btn pk-primary" disabled={busy||d.remaining_sen===0} onClick={()=>openRepayment(d.id)}>{active?'Close repayment':'+ Record repayment'}</button>
            <button type="button" className="pk-btn" disabled={busy} onClick={()=>{if(editId===d.id){setEditId(null);}else{startEdit(d);}setExpanded(null);}}>✎ Edit details</button>
          </div>
          {editId===d.id&&<form className="pk-debt-form inner" onSubmit={e=>void submitEdit(e,d)}>
            <h4>Adjust debt details</h4><div className="pk-debt-fields">
              <label>Name<input className="pk-input" required maxLength={120} value={editDraft.name} onChange={e=>setEditDraft(v=>({...v,name:e.target.value}))}/></label>
              <label>Creditor<input className="pk-input" maxLength={120} value={editDraft.creditor} onChange={e=>setEditDraft(v=>({...v,creditor:e.target.value}))}/></label>
              <label>Starting balance (RM)<input className="pk-input" min="0.01" step="0.01" required type="number" value={editDraft.outstanding} onChange={e=>setEditDraft(v=>({...v,outstanding:e.target.value}))}/></label>
              <label>Balance as-of date<input className="pk-input" value={d.as_of_date} disabled/></label>
              <label className="pk-debt-wide">Notes<textarea className="pk-input" rows={2} value={editDraft.note} onChange={e=>setEditDraft(v=>({...v,note:e.target.value}))}/></label>
            </div><div className="pk-debt-cardactions"><button className="pk-btn pk-primary" disabled={busy} type="submit">Save changes</button><button className="pk-btn" type="button" onClick={()=>setEditId(null)}>Cancel</button></div>
          </form>}
          {active&&<form className="pk-debt-form inner" onSubmit={e=>void submitPayment(e,d)}>
            <h4>Record repayment — {d.name}</h4>
            <div className="pk-debt-method">
              <label><input type="radio" name={`method-${d.id}`} checked={paymentDraft.mode==='direct'} onChange={()=>setPaymentDraft(v=>({...v,mode:'direct',amount:'',commitment:''}))}/> Pay from bank now</label>
              <label><input type="radio" name={`method-${d.id}`} checked={paymentDraft.mode==='commitment'} onChange={()=>setPaymentDraft(v=>({...v,mode:'commitment',amount:'',account:''}))}/> Link previously Paid instalment (older record)</label>
            </div>
            <div className="pk-debt-fields">
              {paymentDraft.mode==='direct'?<label>Payment account<select required className="pk-input" value={paymentDraft.account} onChange={e=>setPaymentDraft(v=>({...v,account:e.target.value}))}><option value="">Choose a bank account</option>{accounts.map(a=><option value={a.id} key={a.id}>{a.name} · Available {money(a.current_balance_sen-a.reserved_balance_sen)}{a.is_protected?' · Protected':''}</option>)}</select></label>
                :<label className="pk-debt-wide">Already-paid monthly commitment<select required className="pk-input" value={paymentDraft.commitment} onChange={e=>{
                  const chosen=eligible.find(c=>String(c.id)===e.target.value);
                  setPaymentDraft(v=>({...v,commitment:e.target.value,amount:chosen?rm(Math.min(chosen.paid_sen,d.remaining_sen)):''}));
                }}><option value="">Choose a paid instalment</option>{eligible.map(c=><option value={c.id} key={c.id}>{c.allocation_month} · {c.name} · {money(c.paid_sen)} paid</option>)}</select></label>}
              <label>Debt principal reduction (RM)<input required className="pk-input" type="number" min="0.01" step="0.01" max={rm(Math.min(d.remaining_sen,paymentDraft.mode==='commitment'?(paidChoice?.paid_sen??d.remaining_sen):d.remaining_sen))} value={paymentDraft.amount} onChange={e=>setPaymentDraft(v=>({...v,amount:e.target.value}))} placeholder="5.00"/></label>
              <label>Payment date<input required className="pk-input" type="date" value={paymentDraft.date} onChange={e=>setPaymentDraft(v=>({...v,date:e.target.value}))}/></label>
              <label className="pk-debt-wide">Reference / note<input className="pk-input" maxLength={300} value={paymentDraft.note} onChange={e=>setPaymentDraft(v=>({...v,note:e.target.value}))} placeholder="Optional"/></label>
            </div>
            <p className="pk-debt-hint">{paymentDraft.mode==='direct'?'This posts a new expense to the selected bank, checks free cash and reduces debt by the amount entered.':'Only use this for a payment made BEFORE you connected a debt in Monthly Planner. Future linked instalments update debts automatically. No extra bank debit.'}</p>
            <button className="pk-btn pk-primary" disabled={busy} type="submit">{busy?'Recording…':paymentDraft.mode==='direct'?'Confirm bank payment':'Link paid instalment'}</button>
          </form>}
          {related.length>0&&<details className="pk-debt-history"><summary>Payment history · {related.length} {related.length===1?'record':'records'}</summary><div>{related.map(p=><div className="pk-debt-historyrow" key={p.id}><div><b>{p.mode==='direct'?'Bank payment':'Linked Paid instalment'}</b><small>{p.paid_on} · {p.account_name||p.commitment_name||'D1 record'}</small>{p.note&&<small>{p.note}</small>}</div><strong>{money(p.amount_sen)}</strong></div>)}</div></details>}
        </article>;
      })}</div>}
    <p className="pk-debt-footer"><b>Important:</b> Linking a paid instalment doesn't automatically edit future monthly commitments. If you fully settle a financing facility, review and remove only its future <em>unallocated</em> bills in Monthly Plan. Don't duplicate a repayment here and as a new paid bill. Local prototype only; no payment reversal tool yet.</p>
  </div>;
}
