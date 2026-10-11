import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {readFinancingOptions,setupFinancing,
  type FinancingSeries,type FinancingDebt,type FinancingInput,type FinancingResult} from './d1FinancingApi';
import './d1FinancingSetup.css';

type Props={planningMonth:string;onClose:()=>void;onSaved:(result:FinancingResult)=>void};
const toSen=(raw:string):number|null=>{
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw.trim()))return null;
  const [a,b='']=raw.trim().split('.');
  const value=Number(a)*100+Number(b.padEnd(2,'0'));
  return Number.isSafeInteger(value)&&value>=0&&value<=100000000000?value:null;
};
const money=(n:number)=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(n/100);
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const monthLabels=[...Array(22)].map((_,i)=>{
  const d=new Date(Date.UTC(2026,9+i,1));return {value:d.toISOString().slice(0,7),label:d.toLocaleString('en-MY',{month:'short',year:'numeric',timeZone:'UTC'})};
});

export default function D1FinancingSetup({planningMonth,onClose,onSaved}:Props){
  const [options,setOptions]=useState<{series:FinancingSeries[];debts:FinancingDebt[]}>({series:[],debts:[]});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [mode,setMode]=useState<'existing'|'new'>('existing');
  const [debtMode,setDebtMode]=useState<'existing'|'new'>('new');
  const [seriesKey,setSeriesKey]=useState('');
  const [debtId,setDebtId]=useState('');
  const [start,setStart]=useState(planningMonth);
  const [name,setName]=useState('');
  const [creditor,setCreditor]=useState('');
  const [balance,setBalance]=useState('');
  const [date,setDate]=useState(today);
  const note=''; // No notes field in this setup form; keep API payload compatible.
  const [amount,setAmount]=useState('');
  const [number,setNumber]=useState('1');
  const [total,setTotal]=useState('12');
  const [dueDay,setDueDay]=useState('15');
  const [principal,setPrincipal]=useState('');
  const pending=useRef<{signature:string;id:string}|null>(null);
  useEffect(()=>{
    let active=true;
    void readFinancingOptions(planningMonth).then(data=>{
      if(active){setOptions(data);setSeriesKey(prev=>prev||data.series[0]?.series_key||'');
        setDebtId(prev=>prev||String(data.debts.find(d=>d.remaining_sen>0)?.id||''));setError('');}
    }).catch(err=>{if(active)setError(err instanceof Error?err.message:'Could not load setup options.')})
      .finally(()=>{if(active)setLoading(false)});
    return ()=>{active=false};
  },[planningMonth]);
  const pickedSeries=options.series.find(s=>s.series_key===seriesKey);
  const pickedDebt=options.debts.find(d=>String(d.id)===debtId);
  const outstanding=debtMode==='new'?toSen(balance):pickedDebt?.remaining_sen??null;
  const principalSen=principal.trim()?toSen(principal):null;
  const principalInvalid=principal.trim()!==''&&(principalSen===null||principalSen<=0);
  const preview=useMemo(()=>{
    if(mode==='existing'){
      if(!pickedSeries)return null;
      const count=Number(pickedSeries.unpaid_count);
      return {count,monthly:pickedSeries.minimum_sen,
        total:principalSen===null?pickedSeries.future_total_sen:principalSen*count,
        variable:pickedSeries.minimum_sen!==pickedSeries.maximum_sen,
        last:''};
    }
    const n=Number(number),max=Number(total),payment=toSen(amount);
    if(!Number.isInteger(n)||!Number.isInteger(max)||max<n||n<1||payment===null||payment<=0)return null;
    const count=max-n+1;
    const year=Number(start.slice(0,4)),month=Number(start.slice(5,7));
    const last=new Date(Date.UTC(year,month-1+count-1,1)).toISOString().slice(0,7);
    return {count,monthly:payment,total:(principalSen===null?payment:principalSen)*count,variable:false,last};
  },[mode,pickedSeries,number,total,amount,start,principalSen]);
  const tooMuch=Boolean(preview&&outstanding!==null&&preview.total>outstanding);
  const invalidPeriod=Boolean(preview&&preview.last&&preview.last>'2028-07');
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy)return;
    setError('');
    const newBalance=toSen(balance);
    if(!preview||preview.count<1||preview.count>36||invalidPeriod||tooMuch||principalInvalid){
      setError('Check the instalment schedule and outstanding balance. Projected debt reductions must fit within the balance.');return;
    }
    if(debtMode==='new'&&(!newBalance||!date)){
      setError('Enter a positive outstanding balance and an as-of date.');return;
    }
    if(mode==='new'&&!name.trim()){setError('Enter the financing name.');return;}
    if(mode==='existing'&&!pickedSeries){setError('Select an existing instalment series.');return;}
    if(debtMode==='existing'&&(!pickedDebt||pickedDebt.remaining_sen<=0)){
      setError('Select an existing outstanding debt.');return;
    }
    const payload:Omit<FinancingInput,'setup_id'>={
      mode,debt_mode:debtMode,start_month:mode==='existing'?pickedSeries!.first_month:start,
      principal_sen:principal.trim()?principalSen:null,
      ...(mode==='existing'?{series_key:seriesKey}:{name:name.trim(),monthly_amount_sen:toSen(amount)!,
        current_installment:Number(number),installment_total:Number(total),due_day:Number(dueDay)}),
      ...(debtMode==='existing'?{debt_id:Number(debtId)}:{
        debt_name:(name.trim()||(pickedSeries?.name??''))+' — Outstanding',
        creditor:creditor.trim(),outstanding_sen:newBalance!,as_of_date:date,note:note.trim()}),
    };
    if(debtMode==='new'&&mode==='existing')payload.debt_name=(name.trim()||pickedSeries!.name)+' — Outstanding';
    const signature=JSON.stringify(payload);
    if(!pending.current||pending.current.signature!==signature)
      pending.current={signature,id:crypto.randomUUID()};
    setBusy(true);
    try{
      const result=await setupFinancing({...payload,setup_id:pending.current.id});
      pending.current=null;onSaved(result);
    }catch(err){setError(err instanceof Error?err.message:'Could not save financing. Review records before retrying.');}
    finally{setBusy(false)}
  }
  return <div className="pk-fin-setup" aria-label="Set up financing">
    <div className="pk-fin-title"><div><h3>Set up financing once</h3>
      <p>Connect your monthly instalments and outstanding debt automatically. No bank money moves during setup.</p></div>
      <button className="pk-btn" type="button" onClick={onClose} disabled={busy}>Close</button></div>
    {loading?<p>Loading existing plans…</p>:<form onSubmit={e=>void submit(e)}>
      <fieldset className="pk-fin-choice"><legend>1. Which instalments?</legend>
        <label className={mode==='existing'?'selected':''}><input type="radio" checked={mode==='existing'} onChange={()=>setMode('existing')}/>
          <span><strong>Use existing instalments</strong><small>Recommended if you've already imported your monthly commitments. No duplicates.</small></span></label>
        <label className={mode==='new'?'selected':''}><input type="radio" checked={mode==='new'} onChange={()=>setMode('new')}/>
          <span><strong>Create new instalments</strong><small>For financing not yet in PocketKu.</small></span></label>
      </fieldset>
      {mode==='existing'?<div className="pk-fin-fields">
        <label>Recurring commitment
          <select className="pk-input" value={seriesKey} onChange={e=>setSeriesKey(e.target.value)} required>
            {options.series.map(s=><option value={s.series_key} key={s.series_key}>
              {s.name} · {s.unpaid_count} upcoming · {money(s.minimum_sen)}{s.minimum_sen!==s.maximum_sen?'+' :''}
            </option>)}
          </select></label>
        {!options.series.length&&<p className="pk-fin-note">No unconnected recurring series found in this month or later. You can create a new financing schedule instead.</p>}
        {pickedSeries&&<p className="pk-fin-note">Existing schedule: {pickedSeries.unpaid_count} unpaid instalments starting {pickedSeries.first_month}. Already-paid months stay unchanged.</p>}
      </div>:<div className="pk-fin-fields two">
        <label>Financing name<input className="pk-input" required maxLength={120} placeholder="e.g. Fictional phone instalment" value={name} onChange={e=>setName(e.target.value)}/></label>
        <label>Monthly payment (RM)<input className="pk-input" type="number" required min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="4.00"/></label>
        <label>Current instalment<input className="pk-input" type="number" required min="1" max="600" value={number} onChange={e=>setNumber(e.target.value)}/></label>
        <label>Total instalments<input className="pk-input" type="number" required min="1" max="600" value={total} onChange={e=>setTotal(e.target.value)}/></label>
        <label>Start allocating in<select className="pk-input" value={start} onChange={e=>setStart(e.target.value)}>
          {monthLabels.filter(m=>m.value>=planningMonth).map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
        </select></label>
        <label>Provider due day (following month)<input className="pk-input" type="number" min="1" max="28" required value={dueDay} onChange={e=>setDueDay(e.target.value)}/></label>
      </div>}
      <fieldset className="pk-fin-choice"><legend>2. Outstanding balance</legend>
        <label className={debtMode==='new'?'selected':''}><input type="radio" checked={debtMode==='new'} onChange={()=>setDebtMode('new')}/>
          <span><strong>Add balance now</strong><small>Creates your debt record and connects the instalments in one step.</small></span></label>
        <label className={debtMode==='existing'?'selected':''}><input type="radio" checked={debtMode==='existing'} onChange={()=>setDebtMode('existing')}/>
          <span><strong>Use a debt already in Settlements</strong><small>Choose this if you've already entered its outstanding balance.</small></span></label>
      </fieldset>
      {debtMode==='existing'?<div className="pk-fin-fields">
        <label>Outstanding debt<select className="pk-input" required value={debtId} onChange={e=>setDebtId(e.target.value)}>
          {options.debts.filter(d=>d.remaining_sen>0).map(d=><option key={d.id} value={d.id}>{d.name} · {money(d.remaining_sen)} remaining</option>)}
        </select></label>
      </div>:<div className="pk-fin-fields two">
        {mode==='existing'&&<label>Debt name (optional)<input className="pk-input" maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder={pickedSeries?.name||'Financing'} /></label>}
        <label>Outstanding balance (RM)<input required className="pk-input" type="number" min="0.01" step="0.01" value={balance} onChange={e=>setBalance(e.target.value)} placeholder="20.00"/></label>
        <label>Balance as-of date<input required className="pk-input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
        <label>Provider (optional)<input className="pk-input" maxLength={120} value={creditor} onChange={e=>setCreditor(e.target.value)}/></label>
      </div>}
      <fieldset className="pk-fin-fields"><legend>3. Repayment calculation</legend>
        <label>Debt reduction per instalment (RM) · optional
          <input className="pk-input" type="number" min="0.01" step="0.01" value={principal}
            placeholder="Blank = entire monthly payment" onChange={e=>setPrincipal(e.target.value)}/></label>
        <small>Enter the principal portion only if your instalment includes interest or fees.</small>
      </fieldset>
      {preview&&<div className="pk-fin-preview"><strong>Before you create</strong>
        <div><span>Upcoming instalments</span><b>{preview.count}</b></div>
        <div><span>Planned debt reductions</span><b>{money(preview.total)}</b></div>
        <div><span>Current outstanding balance</span><b>{outstanding===null?'Enter balance':money(outstanding)}</b></div>
        <p>One-time setup only. All instalments remain Not allocated. No money is reserved or paid.</p>
        {preview.variable&&principalSen===null&&<p>Monthly amounts vary; the debt reduction will match each month's bill.</p>}
        {invalidPeriod&&<p className="pk-fin-warning">This plan goes beyond July 2028, the current PocketKu month range.</p>}
        {tooMuch&&<p className="pk-fin-warning">The planned debt reductions exceed the recorded balance. Correct the balance or enter a smaller amount that reduces the debt each month.</p>}
      </div>}
      {error&&<p className="pk-fin-warning" role="alert">{error}</p>}
      <div className="pk-fin-actions"><button type="button" className="pk-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="pk-btn pk-primary" disabled={busy||loading||!preview||tooMuch||invalidPeriod||principalInvalid||Boolean(mode==='existing'&&!pickedSeries)}>
          {busy?'Saving…':mode==='existing'?'Connect Financing Once':'Create Financing Plan'}
        </button></div>
    </form>}
  </div>;
}
