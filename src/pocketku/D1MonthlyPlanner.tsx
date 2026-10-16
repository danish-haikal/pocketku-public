import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createDemoData } from './seed';
import D1FinancingSetup from './D1FinancingSetup';
import type { FinancingResult } from './d1FinancingApi';
import './d1MonthlyPlanner.css';
import { getD1Accounts, type D1AccountRecord } from './d1AccountsApi';
import { getD1DebtConnections,connectD1Debt,disconnectD1Debt,
  type CommitmentDebtLink,type DebtOption } from './d1CommitmentDebtApi';
import { amount, fromCents, monthNames, toCents } from './types';
import {
  createD1Commitment, deleteD1Commitment, getD1Commitments, importD1DemoCommitments,
  updateD1Commitment, getD1Funding, assignD1Funding, removeD1Funding,
  changeD1CommitmentStatus, type D1FundingSplit,
  type D1Commitment, type CommitmentDraft, type SeedCommitmentInput,
} from './d1CommitmentsApi';

const periods = monthNames.map((_, index) => new Date(Date.UTC(2026, 9 + index, 1)).toISOString().slice(0, 7));
const monthOptions = (from = 0) => monthNames.slice(from).map((label, i) =>
  <option key={periods[from + i]} value={periods[from + i]}>{label}</option>
);
type DraftState = { name:string; category:string; amount:string; due:string;
  installmentNo:string; installmentTotal:string; endMonth:string; scope:'one'|'future' };
const emptyDraft=(period:string):DraftState=>({name:'',category:'Bill',amount:'0.00',due:'',installmentNo:'',installmentTotal:'',endMonth:period,scope:'one'});

export default function D1MonthlyPlanner({ monthIndex }: { monthIndex: number }) {
  const period=periods[monthIndex] ?? periods[0];
  const [items,setItems]=useState<D1Commitment[]>([]);
  const [funding,setFunding]=useState<D1FundingSplit[]>([]);
  const [debtLinks,setDebtLinks]=useState<CommitmentDebtLink[]>([]);
  const [debtChoices,setDebtChoices]=useState<DebtOption[]>([]);
  const [expandedDebt,setExpandedDebt]=useState<number|null>(null);
  const [sortBy,setSortBy]=useState<'due'|'new'|'amount'|'name'>('due');
  const [showFinancing,setShowFinancing]=useState(false);
  const createdToReveal=useRef<number|null>(null);
  const [accounts,setAccounts]=useState<D1AccountRecord[]>([]);
  const [loading,setLoading]=useState(true);
  const [syncing,setSyncing]=useState(false);
  // Loading is true on mount; only explicit refresh actions turn syncing back on.
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [fundingHints,setFundingHints]=useState<Record<number,string>>({});
  const [search,setSearch]=useState('');
  const [statusFilter,setStatusFilter]=useState<'all'|'unallocated'|'reserved'|'paid'>('all');
  const [expandedFunding,setExpandedFunding]=useState<number|null>(null);
  const [lastTouchedId,setLastTouchedId]=useState<number|null>(null);
  const [refresh,setRefresh]=useState(0);
  const [editId,setEditId]=useState<number|'new'|null>(null);
  const [draft,setDraft]=useState<DraftState>(()=>emptyDraft(period));
  const pending=useRef<{signature:string;requestId:string}|null>(null);

  function requestRefresh(){
    // Refresh existing cards in place, without collapsing the planner/scroll position.
    setSyncing(true);
    setError('');
    setRefresh(value=>value+1);
  }
  useEffect(()=>{
    let active=true;
    void Promise.all([getD1Commitments(period),getD1Funding(period),getD1Accounts(),getD1DebtConnections(period)])
      .then(([rows,splits,banks,debtData])=>{if(active){setItems(rows);setFunding(splits);setAccounts(banks);
        setDebtLinks(debtData.links);setDebtChoices(debtData.debts);setError('')}})
      .catch(err=>{if(active)setError(err instanceof Error?err.message:'Monthly database unavailable.')})
      .finally(()=>{if(active){setLoading(false);setSyncing(false)}});
    return ()=>{active=false};
  },[period,refresh]);

  useEffect(()=>{
    const id=createdToReveal.current;
    if(id!==null&&items.some(x=>x.id===id)){
      document.getElementById(`pk-commitment-${id}`)?.scrollIntoView({behavior:'smooth',block:'center'});
      createdToReveal.current=null;
    }
  },[items]);
  const linkFor=(id:number)=>debtLinks.find(link=>link.commitment_id===id);
  const monthTotal=useMemo(()=>items.reduce((n,x)=>n+x.amount_sen,0),[items]);
  const allUnallocated=items.every(x=>x.status==='unallocated');
  const visibleItems=useMemo(()=>items.filter(item =>
    (statusFilter==='all'||item.status===statusFilter)&&
    (!search.trim()||[item.name,item.category,item.due_date||'']
      .some(field=>field.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
  ).sort((a,b)=>{
    if(sortBy==='new')return b.id-a.id;
    if(sortBy==='amount')return b.amount_sen-a.amount_sen||b.id-a.id;
    if(sortBy==='name')return a.name.localeCompare(b.name)||b.id-a.id;
    if(!a.due_date&&!b.due_date)return b.id-a.id;
    if(!a.due_date)return 1;
    if(!b.due_date)return -1;
    return a.due_date.localeCompare(b.due_date)||b.id-a.id;
  }),[items,search,statusFilter,sortBy]);
  const busy=working||syncing;
  function newItem(){setMessage('');setEditId('new');setDraft(emptyDraft(period))}
  function afterFinancingSetup(result:FinancingResult){
    setShowFinancing(false);setMessage(`Financing set up: ${result.name}. Reserve and pay each monthly instalment normally.`);
    setSearch(result.name);setStatusFilter('all');requestRefresh();
  }
  function editItem(item:D1Commitment){
    setMessage('');setEditId(item.id);
    setDraft({name:item.name,category:item.category,amount:fromCents(item.amount_sen),
      due:item.due_date||'',installmentNo:item.installment_no===null?'':String(item.installment_no),
      installmentTotal:item.installment_total===null?'':String(item.installment_total),
      endMonth:period,scope:'one'});
  }
  function parsedDraft():CommitmentDraft|null{
    const cents=toCents(draft.amount);
    const n=draft.installmentNo.trim()===''?null:Number(draft.installmentNo);
    const max=draft.installmentTotal.trim()===''?null:Number(draft.installmentTotal);
    if (!draft.name.trim()||!draft.category.trim()||!Number.isSafeInteger(cents)||cents<0||
        !(n===null&&max===null || n!==null&&max!==null&&Number.isSafeInteger(n)&&
          Number.isSafeInteger(max)&&n>=1&&max>=n&&max<=600)){
      setError('Enter a name, valid amount and instalment numbers (both blank, or 1–total).');return null;
    }
    return {name:draft.name.trim(),category:draft.category.trim(),amount_sen:cents,
      due_date:draft.due||null,installment_no:n,installment_total:max};
  }
  async function save(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy)return;
    setError('');setMessage('');
    const values=parsedDraft();if(!values)return;
    const signature=JSON.stringify([period,draft.endMonth,values]);
    if(editId==='new' && (!pending.current||pending.current.signature!==signature)){
      pending.current={signature,requestId:crypto.randomUUID()};
    }
    setWorking(true);
    try{
      if(editId==='new'){
        const requestId=pending.current!.requestId;
        await createD1Commitment({...values,request_id:requestId,
          start_month:period,end_month:draft.endMonth});
        const created=(await getD1Commitments(period)).find(x=>x.creation_key===`manual:${requestId}:${period}`);
        if(created){setLastTouchedId(created.id);createdToReveal.current=created.id;setSortBy('new');
          setSearch('');setStatusFilter('all');}
      }else if(typeof editId==='number'){
        await updateD1Commitment(editId,values,draft.scope);
      }
      pending.current=null;
      if(typeof editId==='number')setLastTouchedId(editId);
      setEditId(null);setMessage('Commitment saved.');
      requestRefresh();
    }catch(err){setError(err instanceof Error?err.message:'Could not save. If uncertain, check existing records before retrying.');}
    finally{setWorking(false)}
  }
  async function remove(item:D1Commitment){
    if(busy)return;
    const scope:itemScope= item.series_key&&window.confirm('Delete this and all future unallocated instalments? OK = future, Cancel = only this one')?'future':'one';
    if(!window.confirm(`Delete ${item.name} for ${monthNames[monthIndex]}${scope==='future'?' and later months':''}?`))return;
    setWorking(true);setError('');
    try{await deleteD1Commitment(item.id,scope);requestRefresh();setMessage('Commitment removed.');}
    catch(err){setError(err instanceof Error?err.message:'Delete failed.');}
    finally{setWorking(false)}
  }
  type itemScope='one'|'future';
  async function importExamples(){
    if(busy)return;
    if(!window.confirm('Import privately configured commitments into your accounts?\n\nThis adds the prepared payment schedule as unallocated commitments only. No bank balance is changed and no bill is marked Paid. Existing imports are skipped.'))return;
    const demo=createDemoData();
    if (demo.commitments.length === 0) {
      setMessage('No default commitments are embedded in this public-repo-safe version. Your previously imported D1 commitments are preserved. Use New commitment or Set Up Financing for additional payments.');
      return;
    }
    const grouped=new Map<number,typeof demo.commitments>();
    for(const row of demo.commitments){const a=grouped.get(row.month)||[];a.push(row);grouped.set(row.month,a)}
    const records:SeedCommitmentInput[]=[];
    for(let index=0;index<periods.length;index++){
      (grouped.get(index)||[]).forEach((row,position)=>{
        records.push({
          creation_key:`demo:v1:${periods[index]}:${position}`,
          series_key:row.seriesId?'demo:'+row.seriesId:null,
          allocation_month:periods[index],name:row.name,category:row.category,
          amount_sen:row.amountCents,due_date:row.dueDate||null,
          installment_no:row.installmentNo??null,installment_total:row.installmentTotal??null,
        });
      });
    }
    if(records.length>300){setError('Demo import exceeds the current batch limit.');return}
    setWorking(true);setError('');setMessage('');
    try{
      const out=await importD1DemoCommitments(records);
      setMessage(`Commitment import complete: ${out.inserted} added, ${out.skipped} already present.`);
      requestRefresh();
    }catch(err){setError(err instanceof Error?err.message:'Import failed.');}
    finally{setWorking(false)}
  }
  const reservedTotal=items.filter(x=>x.status==='reserved').reduce((sum,x)=>sum+x.amount_sen,0);
  const paidTotal=items.filter(x=>x.status==='paid').reduce((sum,x)=>sum+x.amount_sen,0);
  const assignedFor=(id:number)=>funding.filter(x=>x.commitment_id===id);
  async function addFunding(event:FormEvent<HTMLFormElement>,item:D1Commitment){
    event.preventDefault();if(busy || item.status!=='unallocated')return;
    const form=event.currentTarget;
    const values=new FormData(form);
    const accountId=Number(values.get('account'));
    const cents=toCents(String(values.get('amount')||''));
    if(!Number.isSafeInteger(accountId)||accountId<1||!Number.isSafeInteger(cents)||cents<=0){
      setError('Select a bank account and a positive funding amount.');return;
    }
    setWorking(true);setError('');setMessage('');
    try {
      await assignD1Funding(item.id,accountId,cents);
      setLastTouchedId(item.id);
      const updatedTotal=assignedFor(item.id).filter(f=>f.account_id!==accountId).reduce((sum,f)=>sum+f.amount_sen,0)+cents;
      if(updatedTotal===item.amount_sen)setExpandedFunding(null);
      setFundingHints(previous=>({...previous,[item.id]:''}));
      setMessage('Funding source saved. Your bank cash is not reduced until the bill is Paid.');
      requestRefresh();
      form.reset();
    }catch(err){setError(err instanceof Error?err.message:'Unable to assign funding.');}
    finally{setWorking(false)}
  }
  async function removeFunding(item:D1Commitment,accountId:number){
    if(busy || item.status!=='unallocated')return;
    setWorking(true);setError('');setMessage('');
    try{await removeD1Funding(item.id,accountId);setLastTouchedId(item.id);setFundingHints(previous=>({...previous,[item.id]:''}));requestRefresh()}
    catch(err){setError(err instanceof Error?err.message:'Unable to remove funding.');}
    finally{setWorking(false)}
  }
  async function connectToDebt(event:FormEvent<HTMLFormElement>,item:D1Commitment){
    event.preventDefault();if(busy)return;
    const fields=new FormData(event.currentTarget);
    const debtId=Number(fields.get('debt'));
    const scope=fields.get('scope')==='future'?'future':'one';
    const principalText=String(fields.get('principal')||'').trim();
    const principal=principalText?toCents(principalText):null;
    if(!debtChoices.find(x=>x.id===debtId&&x.remaining_sen>0)||
       (principalText && (!Number.isSafeInteger(principal)||principal===null||principal<=0||principal>item.amount_sen))){
      setError('Choose an outstanding debt. Principal must be positive and no more than the bill amount.');return;
    }
    setWorking(true);setError('');setMessage('');
    try{
      await connectD1Debt(item.id,debtId,scope,principal);
      setExpandedDebt(null);setLastTouchedId(item.id);
      setMessage('Connected once. When you mark this instalment Paid, PocketKu will update the debt automatically.');
      requestRefresh();
    }catch(err){setError(err instanceof Error?err.message:'Unable to connect this debt.');}
    finally{setWorking(false)}
  }
  async function unlinkDebt(item:D1Commitment){
    if(busy||!window.confirm('Remove this unused connection? For a recurring series, this removes its future connection. Previously recorded repayments remain in history.'))return;
    setWorking(true);setError('');setMessage('');
    try {await disconnectD1Debt(item.id);setLastTouchedId(item.id);setMessage('Unused debt connection removed.');requestRefresh();}
    catch(err){setError(err instanceof Error?err.message:'Could not remove debt connection.');}
    finally{setWorking(false)}
  }
  async function setStatus(item:D1Commitment,next:'unallocated'|'reserved'|'paid'){
    if(busy)return;
    const sources=assignedFor(item.id);
    const fundingTotal=sources.reduce((sum,source)=>sum+source.amount_sen,0);
    if(next==='reserved'&&(item.amount_sen<=0||fundingTotal!==item.amount_sen)){
      const hint=item.amount_sen<=0
        ? 'Set the commitment amount above RM0 before reserving.'
        : fundingTotal<item.amount_sen
          ? `First assign ${amount(item.amount_sen-fundingTotal)} more: choose an account, enter the amount, and click Assign. Then click Reserve.`
          : `You assigned ${amount(fundingTotal-item.amount_sen)} too much. Remove the source and assign the correct total before reserving.`;
      setFundingHints(previous=>({...previous,[item.id]:hint}));
      return;
    }
    setFundingHints(previous=>({...previous,[item.id]:''}));
    const protectedSources=sources.filter(x=>x.is_protected===1);
    const acknowledge=next==='reserved'&&protectedSources.length>0;
    if(acknowledge&&!window.confirm(
      'Protected savings warning: this bill uses '+protectedSources.map(x=>x.account_name).join(', ')+
      '. Reserve this money anyway?'))return;
    const connectedDebt=linkFor(item.id);
    if(next==='paid'&&connectedDebt){
      const balance=debtChoices.find(d=>d.id===connectedDebt.debt_id)?.remaining_sen;
      const principal=connectedDebt.principal_sen??item.amount_sen;
      if(typeof balance==='number'&&principal>balance){
        setError(`This bill would reduce the debt by ${amount(principal)}, but only ${amount(balance)} is outstanding. Disconnect the debt and reconnect with the correct principal amount before paying.`);
        return;
      }
    }
    if(next==='paid'&&!window.confirm(
      `Mark ${item.name} as PAID? This records one bank debit across ${sources.length} account(s). `+
      (connectedDebt?`PocketKu will also reduce your “${connectedDebt.debt_name}” debt automatically. `:'')+
      'Paid transactions cannot be undone in this version.'))return;
    setWorking(true);setError('');setMessage('');
    try {
      const result=await changeD1CommitmentStatus(item.id,next,acknowledge);
      setLastTouchedId(item.id);
      if(next!=='unallocated')setExpandedFunding(null);
      setMessage(result.already_set?'Already recorded in D1; no duplicate debit.':
        next==='paid'?(connectedDebt?'Paid once; bank cash and linked debt both updated.':'Paid and debited once in the financial records.'):
        next==='reserved'?'Funds reserved. Actual bank cash is unchanged.':'Reservation released.');
      requestRefresh();
      // Refresh the parent dashboard and account selectors from the D1 source of truth.
      window.dispatchEvent(new Event('pocketku:d1-accounts-changed'));
    }catch(err){
      const detail=err instanceof Error?err.message:'Unable to change payment status.';
      setError(detail);
      setFundingHints(previous=>({...previous,[item.id]:detail}));
    }
    finally{setWorking(false)}
  }
  return <section className="pk-card pk-d1planner" aria-label="Monthly commitments">
    <header className="pk-d1-header">
      <div>
        <div className="pk-d1-overline">YOUR MONTHLY PLAN</div>
        <h2>Monthly commitments <span className="pk-d1-save-indicator">● Saved</span></h2>
        <p>{monthNames[monthIndex]} · Manage which accounts fund each bill and when you actually pay it.</p>
      </div>
      <button className="pk-btn" type="button" onClick={()=>requestRefresh()} disabled={busy}>
        {syncing?'Updating…':'↻ Refresh'}
      </button>
    </header>

    <div className="pk-d1-overview" aria-label="Monthly planning totals">
      <div><small>Planned</small><strong>{amount(monthTotal)}</strong><span>{items.length} commitments</span></div>
      <div><small>Reserved</small><strong>{amount(reservedTotal)}</strong><span>Earmarked, not spent</span></div>
      <div><small>Paid</small><strong>{amount(paidTotal)}</strong><span>Recorded as expense</span></div>
    </div>

    <div className="pk-d1-explainer">
      <strong>How payments work</strong>
      <span><b>1.</b> Add funding source</span>
      <span><b>2.</b> Reserve money</span>
      <span><b>3.</b> Mark Paid (bank + linked debt update automatically)</span>
    </div>

    <div className="pk-d1-actions">
      <button type="button" className="pk-btn pk-primary" onClick={newItem} disabled={busy}>+ New commitment</button>
      <button type="button" className="pk-btn" onClick={()=>setShowFinancing(v=>!v)} disabled={busy}>+ Set Up Financing</button>
      {createDemoData().commitments.length>0&&<button type="button" className="pk-btn" onClick={()=>void importExamples()} disabled={busy}>Import My Commitments</button>}
    </div>

    {showFinancing&&<D1FinancingSetup planningMonth={period} onClose={()=>setShowFinancing(false)} onSaved={afterFinancingSetup}/>}

    {error && <div className="pk-d1-alert pk-d1-error" role="alert">{error}</div>}
    {message && <div className="pk-d1-alert" role="status">{message}</div>}

    <div className="pk-d1-toolbar">
      <label className="pk-d1-searchlabel">Find a commitment
        <input className="pk-input" type="search" placeholder="Search by name or category…"
          value={search} onChange={e=>setSearch(e.target.value)} />
      </label>
      <label className="pk-d1-filterlabel">Status
        <select className="pk-input" value={statusFilter}
          onChange={e=>setStatusFilter(e.target.value as 'all'|'unallocated'|'reserved'|'paid')}>
          <option value="all">All ({items.length})</option>
          <option value="unallocated">Not allocated ({items.filter(x=>x.status==='unallocated').length})</option>
          <option value="reserved">Reserved ({items.filter(x=>x.status==='reserved').length})</option>
          <option value="paid">Paid ({items.filter(x=>x.status==='paid').length})</option>
        </select>
      </label>
      <label className="pk-d1-filterlabel">Sort by
        <select className="pk-input" value={sortBy} onChange={e=>setSortBy(e.target.value as typeof sortBy)}>
          <option value="due">Due date — earliest</option>
          <option value="new">Recently added — newest</option>
          <option value="amount">Amount — highest</option>
          <option value="name">Name — A to Z</option>
        </select>
      </label>
      <span className="pk-d1-resultcount">{visibleItems.length} shown</span>
    </div>

    {loading ? <p className="pk-d1-empty">Loading commitments…</p> :
      visibleItems.length===0 ? <div className="pk-d1-empty">
        {items.length===0
          ? 'No commitments yet. Use New commitment or import your prepared plan.'
          : 'No matching bills. Change the search or status filter.'}
      </div> :
      <div className="pk-d1-list">
        {visibleItems.map(item=>{
          const sources=assignedFor(item.id);
          const funded=sources.reduce((sum,f)=>sum+f.amount_sen,0);
          const fullyFunded=item.amount_sen>0&&funded===item.amount_sen;
          const statusLabel=item.status==='unallocated'?'Not allocated':item.status==='reserved'?'Reserved':'Paid';
          const addMore=item.status==='unallocated'&&item.amount_sen>0&&accounts.length>0;
          const currentDebt=linkFor(item.id);
          return <article id={`pk-commitment-${item.id}`} key={item.id} className={'pk-d1-item'+(lastTouchedId===item.id?' pk-d1-recent':'')}>
            <div className="pk-d1-itemhead">
              <div className="pk-d1-itemidentity">
                <div className="pk-d1-itemtitle">{item.name}
                  {item.installment_total?<span className="pk-d1-installment">{item.installment_no}/{item.installment_total}</span>:null}
                </div>
                <div className="pk-d1-meta"><span>{item.category}</span>
                  {item.due_date&&<span>Due {item.due_date}</span>}
                  <span className={'pk-d1-status pk-d1-'+item.status}>{statusLabel}</span>
                </div>
              </div>
              <div className="pk-d1-amount">{amount(item.amount_sen)}</div>
            </div>

            <div className="pk-d1-debtconnection">
              {currentDebt?<div className="pk-d1-debtlinked">
                <div><strong>↗ Connected debt: {currentDebt.debt_name}</strong>
                  <small>{item.status==='paid'?'Debt updated when payment was recorded.':
                    `When Paid: reduces this debt by ${currentDebt.principal_sen===null?amount(item.amount_sen):amount(currentDebt.principal_sen)}. No extra bank debit.`}
                  </small>
                  {currentDebt.scope==='future'&&<small>Applies to this and future instalments in the same series.</small>}
                </div>
                {item.status!=='paid'&&<button type="button" className="pk-mini-link" disabled={busy}
                  onClick={()=>void unlinkDebt(item)}>Disconnect</button>}
              </div>:item.status!=='paid'&&<>
                <button className="pk-d1-addsource" type="button" disabled={busy}
                  onClick={()=>setExpandedDebt(prev=>prev===item.id?null:item.id)}
                  aria-expanded={expandedDebt===item.id}>
                  {expandedDebt===item.id?'− Close debt connection':'+ Connect to a Debt (optional)'}
                </button>
                {expandedDebt===item.id&&<form className="pk-d1-debtform" onSubmit={e=>void connectToDebt(e,item)}>
                  <p>Connect this financing instalment once. After you pay, both the bank and debt balance update automatically.</p>
                  {debtChoices.some(d=>d.remaining_sen>0)?<>
                    <label>Outstanding debt
                      <select className="pk-input" name="debt" required>
                        {debtChoices.filter(d=>d.remaining_sen>0).map(d=><option value={d.id} key={d.id}>
                          {d.name} · {amount(d.remaining_sen)} remaining
                        </option>)}
                      </select>
                    </label>
                    {item.series_key&&<label>Apply connection
                      <select className="pk-input" name="scope" defaultValue="future">
                        <option value="future">This and future instalments</option>
                        <option value="one">This month only</option>
                      </select>
                    </label>}
                    <label>Debt reduction per instalment (RM, optional)
                      <input className="pk-input" name="principal" type="number" min="0.01" step="0.01"
                        max={(item.amount_sen/100).toFixed(2)} placeholder="Blank = full bill amount" />
                    </label>
                    <small>Leave blank for the full payment. If some money is interest or fees, enter only the principal portion.</small>
                    <button className="pk-btn pk-primary" disabled={busy} type="submit">Connect Debt</button>
                  </>:<p>Add a fictional debt under Settlements first, then return here to connect it.</p>}
                </form>}
              </>}
            </div>

            <div className="pk-d1-funding">
              <div className="pk-d1-fundinghead">
                <strong>Funding sources</strong>
                <span>{amount(funded)} <span className="pk-d1-muted">/ {amount(item.amount_sen)}</span></span>
              </div>
              <div className="pk-d1-progress" aria-label={`Funding progress ${amount(funded)} of ${amount(item.amount_sen)}`}>
                <div style={{width:`${item.amount_sen>0?Math.min(100,Math.max(0,funded/item.amount_sen*100)):0}%`}} />
              </div>
              {sources.length===0 ? <p className="pk-d1-nofunding">No account assigned yet.</p> :
                <ul className="pk-d1-source-list">{sources.map(f=><li key={f.account_id}>
                  <span>{f.account_name}{f.is_protected===1&&<em>Protected savings</em>}</span>
                  <div><strong>{amount(f.amount_sen)}</strong>
                    {item.status==='unallocated'&&<button className="pk-mini-link" type="button" disabled={busy}
                      onClick={()=>void removeFunding(item,f.account_id)}>Remove</button>}
                  </div>
                </li>)}</ul>}
              {item.status==='unallocated'&&<p className={'pk-d1-fundinghint'+(fullyFunded?' pk-d1-ready':'')}>
                {fullyFunded?'✓ Fully funded — ready to reserve.' :
                  funded<item.amount_sen
                    ? `${amount(item.amount_sen-funded)} more needed before reserving.`
                    : funded>item.amount_sen
                      ? `${amount(funded-item.amount_sen)} overfunded — adjust a source before reserving.`
                      : 'Set an amount above RM0 to reserve.'}
              </p>}
              {addMore&&<>
                <button type="button" className="pk-d1-addsource" disabled={busy}
                  aria-expanded={expandedFunding===item.id}
                  onClick={()=>setExpandedFunding(previous=>previous===item.id?null:item.id)}>
                  {expandedFunding===item.id?'− Close funding form':'+ Add Funding Source'}
                </button>
                {expandedFunding===item.id&&<form className="pk-d1-addform"
                  onSubmit={event=>void addFunding(event,item)}>
                  <label>Bank / Tabung
                    <select aria-label={'Funding account for '+item.name} className="pk-input" name="account" required>
                      {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                  <label>Contribution (RM)
                    <input aria-label={'Funding amount for '+item.name+' in RM'}
                      type="number" min="0.01" step="0.01" placeholder="0.00" name="amount"
                      required className="pk-input"/>
                  </label>
                  <button className="pk-btn pk-primary" disabled={busy} type="submit">Assign</button>
                </form>}
              </>}
            </div>

            {fundingHints[item.id]&&<p className="pk-d1-inline-error" role="alert">{fundingHints[item.id]}</p>}
            {lastTouchedId===item.id && <span className="pk-d1-updated" role="status">
              ✓ This is the commitment you just updated.
            </span>}
            <div className="pk-d1-itemactions">
              {item.status==='unallocated'&&<>
                <button className="pk-btn pk-primary" disabled={busy} type="button"
                  onClick={()=>void setStatus(item,'reserved')}>Reserve {amount(item.amount_sen)}</button>
                <div className="pk-d1-actionspacer"/>
                <button className="pk-mini-link" type="button" disabled={busy} onClick={()=>editItem(item)}>Edit</button>
                <button className="pk-mini-link" type="button" disabled={busy} onClick={()=>void remove(item)}>Delete</button>
              </>}
              {item.status==='reserved'&&<>
                <button className="pk-btn pk-primary" type="button" disabled={busy}
                  onClick={()=>void setStatus(item,'paid')}>Mark Paid</button>
                <button className="pk-btn" type="button" disabled={busy}
                  onClick={()=>void setStatus(item,'unallocated')}>Release Reservation</button>
              </>}
              {item.status==='paid'&&<span className="pk-d1-paidnote">✓ Payment recorded. Cash was deducted once.</span>}
            </div>
          </article>;
        })}
      </div>
    }

    <p className="pk-d1-footnote">Debt connections must be set up before an instalment is Paid. For older paid instalments, use Settlements → Link previously Paid instalment. If your loan includes interest or fees, enter the principal reduction correctly. Assigning a funding source does not move money between banks. Reserved money remains in its bank account. Mark Paid only after the actual payment has happened; this step posts the expense. The original browser-only demo is separate.</p>
    {!allUnallocated&&<p className="pk-d1-footnote">Reserved and paid commitments cannot be edited until their status allows it. Paid entries cannot be undone in this version.</p>}

    {editId!==null&&<div className="pk-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setEditId(null)}}>
      <div className="pk-modal pk-d1-editmodal" role="dialog" aria-modal="true" aria-label={editId==='new'?'New commitment':'Edit commitment'}>
        <div className="pk-row"><h2>{editId==='new'?'New commitment':'Edit commitment'}</h2>
          <button type="button" className="pk-btn" onClick={()=>setEditId(null)} disabled={busy} aria-label="Close editor">×</button>
        </div>
        <form className="pk-form pk-two" onSubmit={e=>void save(e)}>
          <label>Payment name<input className="pk-input" maxLength={120} required autoFocus value={draft.name} onChange={e=>setDraft(x=>({...x,name:e.target.value}))}/></label>
          <label>Amount (RM)<input className="pk-input" type="number" min="0" step=".01" required value={draft.amount} onChange={e=>setDraft(x=>({...x,amount:e.target.value}))}/></label>
          <label>Category<input className="pk-input" maxLength={60} required value={draft.category} onChange={e=>setDraft(x=>({...x,category:e.target.value}))}/></label>
          <label>Actual due date (optional)<input className="pk-input" type="date" value={draft.due} onChange={e=>setDraft(x=>({...x,due:e.target.value}))}/></label>
          <label>Instalment number (optional)<input className="pk-input" type="number" min="1" value={draft.installmentNo} onChange={e=>setDraft(x=>({...x,installmentNo:e.target.value}))} placeholder="4"/></label>
          <label>Total instalments (optional)<input className="pk-input" type="number" min="1" value={draft.installmentTotal} onChange={e=>setDraft(x=>({...x,installmentTotal:e.target.value}))} placeholder="24"/></label>
          {editId==='new'?<label>Create through month<select className="pk-input" value={draft.endMonth} onChange={e=>setDraft(x=>({...x,endMonth:e.target.value}))}>
            {monthOptions(monthIndex)}</select></label>
          :<label>Apply changes<select className="pk-input" value={draft.scope} onChange={e=>setDraft(x=>({...x,scope:e.target.value as 'one'|'future'}))}>
              <option value="one">This month only</option>
              <option value="future">This &amp; future in series</option>
            </select></label>}
          <div className="pk-d1-editactions">
            <button className="pk-btn" type="button" onClick={()=>setEditId(null)} disabled={busy}>Cancel</button>
            <button className="pk-btn pk-primary" type="submit" disabled={busy}>{working?'Saving…':'Save changes'}</button>
          </div>
        </form>
      </div>
    </div>}
  </section>;
}
