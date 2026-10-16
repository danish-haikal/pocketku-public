import {useEffect,useState,type FormEvent} from 'react';
import {archivePersonalSubscription,createPersonalSubscription,dayDifference,downloadTrialCalendar,getPersonalSubscriptions,rm,updatePersonalSubscription,type PersonalSubscription,type PersonalSubscriptionDraft} from './d1PersonalSubscriptionsApi';
import './d1PersonalSubscriptions.css';

const todayLocal=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const emptyDraft=():PersonalSubscriptionDraft=>({name:'',provider:'',status:'trial',renewal_amount_sen:0,next_charge_date:todayLocal(),cancel_by_date:null,billing_cycle:'monthly',note:''});
const cycles:{value:PersonalSubscriptionDraft['billing_cycle'];label:string}[]=[{value:'monthly',label:'Every month'},{value:'quarterly',label:'Every 3 months'},{value:'half_yearly',label:'Every 6 months'},{value:'yearly',label:'Every year'},{value:'one_time',label:'One-time charge'}];
const description=(s:PersonalSubscription)=>{
  if(s.status==='cancelled')return 'Cancellation recorded';
  const days=dayDifference(s.cancel_by_date||s.next_charge_date);
  if(days<0)return `Review overdue date (${Math.abs(days)} days ago)`;
  if(days===0)return 'Deadline today';
  if(days===1)return 'Only 1 day left';
  return `${days} days until ${s.cancel_by_date?'cancellation deadline':'next charge'}`;
};
export default function D1PersonalSubscriptions(){
  const [rows,setRows]=useState<PersonalSubscription[]>([]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [editing,setEditing]=useState<number|'new'|null>(null);
  const [draft,setDraft]=useState<PersonalSubscriptionDraft>(emptyDraft);
  const [amount,setAmount]=useState('0.00');
  const [creationKey,setCreationKey]=useState(()=>crypto.randomUUID());
  const [filter,setFilter]=useState<'all'|'trial'|'active'|'cancelled'>('all');
  useEffect(()=>{let active=true;void getPersonalSubscriptions().then(result=>{if(active){setRows(result);setError('');}}).catch(err=>{if(active)setError(String(err))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
  async function reload(){setRows(await getPersonalSubscriptions());}
  function startNew(){setDraft(emptyDraft());setAmount('0.00');setEditing('new');setError('');setNotice('');}
  function startEdit(row:PersonalSubscription){setDraft({name:row.name,provider:row.provider,status:row.status,renewal_amount_sen:row.renewal_amount_sen,next_charge_date:row.next_charge_date,cancel_by_date:row.cancel_by_date,billing_cycle:row.billing_cycle,note:row.note});setAmount((row.renewal_amount_sen/100).toFixed(2));setEditing(row.id);setError('');}
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;
    const raw=amount.trim();if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(raw)){setError('Enter a valid RM amount with at most two decimals.');return}
    const sen=Math.round(Number(raw)*100);
    if(!Number.isSafeInteger(sen)){setError('Enter a valid renewal amount.');return}
    const next={...draft,renewal_amount_sen:sen};
    if(next.cancel_by_date && next.cancel_by_date>next.next_charge_date){setError('Cancellation deadline must be on or before the charge date.');return}
    setBusy(true);setError('');setNotice('');
    try{
      if(editing==='new'){await createPersonalSubscription(next,creationKey);setCreationKey(crypto.randomUUID());}
      else if(typeof editing==='number')await updatePersonalSubscription(editing,next);
      await reload();setEditing(null);setNotice('Subscription saved. No bank transaction was created.');
    }catch(err){setError(err instanceof Error?err.message:String(err))}finally{setBusy(false)}
  }
  async function changeStatus(item:PersonalSubscription){
    if(!window.confirm(`Only mark ${item.name} cancelled AFTER you have confirmed cancellation with the provider. PocketKu cannot cancel it. Continue?`))return;
    setBusy(true);setError('');setNotice('');
    try{await updatePersonalSubscription(item.id,{...item,status:'cancelled'});await reload();setNotice('Recorded as cancelled in PocketKu. Check the provider confirmation separately.');}
    catch(err){setError(err instanceof Error?err.message:String(err))}finally{setBusy(false)}
  }
  async function archive(item:PersonalSubscription){
    if(!window.confirm(`Archive ${item.name} from PocketKu? This only hides the reminder. It does not cancel the subscription at the provider.`))return;
    setBusy(true);setError('');
    try{await archivePersonalSubscription(item.id);await reload();setNotice('Reminder archived; provider subscription unaffected.');}
    catch(err){setError(err instanceof Error?err.message:String(err))}finally{setBusy(false)}
  }
  const visible=rows.filter(item=>filter==='all'||item.status===filter);
  const approaching=rows.filter(item=>item.status!=='cancelled'&&dayDifference(item.cancel_by_date||item.next_charge_date)<=7)
    .sort((a,b)=>(a.cancel_by_date||a.next_charge_date).localeCompare(b.cancel_by_date||b.next_charge_date));
  const trials=rows.filter(x=>x.status==='trial');
  const renewals=rows.filter(x=>x.status!=='cancelled').reduce((sum,item)=>sum+item.renewal_amount_sen,0);
  return <div className="pk-subscriptions">
    <div className="pk-sub-header"><div><h2>My Subscriptions</h2><p>Know when trials finish, what renewals may cost, and when to cancel.</p></div>
      <button className="pk-btn pk-primary" onClick={startNew}>+ Add subscription</button></div>
    {error&&<div role="alert" className="pk-sub-alert pk-sub-danger">{error}</div>}
    {notice&&<div role="status" className="pk-sub-alert pk-sub-success">✓ {notice}</div>}
    <div className="pk-sub-metrics"><div><small>Active free trials</small><strong>{trials.length}</strong></div><div><small>Potential renewal amounts*</small><strong>{rm(renewals)}</strong></div><div><small>Due or overdue within 7 days</small><strong>{approaching.length}</strong></div></div>
    <p className="pk-sub-disclaimer">*Combined amounts for tracked renewals, not a monthly total. Some subscriptions renew on different schedules.</p>
    {approaching.length>0&&<section className="pk-sub-alert pk-sub-warning"><h3>⚠ Check these subscriptions soon</h3>
      {approaching.slice(0,8).map(item=><div key={item.id}><b>{item.name}</b> — {description(item)} · {rm(item.renewal_amount_sen)} potential charge</div>)}
    </section>}
    {editing!==null&&<section className="pk-sub-card"><h3>{editing==='new'?'Add subscription or trial':'Edit subscription'}</h3>
      <form onSubmit={e=>void save(e)} className="pk-sub-form">
        <label>Subscription name<input className="pk-input" maxLength={120} required value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="e.g. Music trial"/></label>
        <label>Provider (optional)<input className="pk-input" maxLength={120} value={draft.provider} onChange={e=>setDraft({...draft,provider:e.target.value})} placeholder="Provider name"/></label>
        <label>Status<select className="pk-input" value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value as PersonalSubscriptionDraft['status']})}><option value="trial">Free trial</option><option value="active">Paid / active</option><option value="cancelled">Cancelled (confirmed with provider)</option></select></label>
        <label>Next potential charge (RM)<input className="pk-input" type="number" min="0" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <label>{draft.status==='trial'?'First charge date / trial ends':'Next charge date'}<input className="pk-input" type="date" required value={draft.next_charge_date} onChange={e=>setDraft({...draft,next_charge_date:e.target.value})}/></label>
        <label>Cancel by (optional)<input className="pk-input" type="date" value={draft.cancel_by_date||''} onChange={e=>setDraft({...draft,cancel_by_date:e.target.value||null})}/></label>
        <label>Billing frequency<select className="pk-input" value={draft.billing_cycle} onChange={e=>setDraft({...draft,billing_cycle:e.target.value as PersonalSubscriptionDraft['billing_cycle']})}>{cycles.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
        <label className="pk-sub-wide">Notes (optional)<textarea className="pk-input" maxLength={1000} value={draft.note} onChange={e=>setDraft({...draft,note:e.target.value})} rows={2} placeholder="Where to cancel, policy details…"/></label>
        <div className="pk-sub-actions pk-sub-wide"><button className="pk-btn pk-primary" disabled={busy}>{busy?'Saving…':'Save subscription'}</button><button type="button" className="pk-btn" onClick={()=>setEditing(null)}>Cancel</button></div>
      </form>
    </section>}
    <div className="pk-sub-filter"><label htmlFor="pk-sub-status-filter">Show</label><select id="pk-sub-status-filter" className="pk-input" value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}><option value="all">All subscriptions</option><option value="trial">Free trials</option><option value="active">Active / paid</option><option value="cancelled">Cancelled</option></select></div>
    {loading?<p>Loading your subscriptions…</p>:visible.length===0?<div className="pk-sub-card"><p>No subscriptions in this view. Add a trial to track its renewal date.</p></div>:<div className="pk-sub-list">{visible.map(item=>{
      const days=dayDifference(item.cancel_by_date||item.next_charge_date);
      return <article key={item.id} className="pk-sub-card"><div className="pk-sub-title"><div><h3>{item.name}</h3><p>{item.provider||'Personal subscription'} · {item.status==='trial'?'Free trial':item.status==='cancelled'?'Cancelled':'Active / paid'}</p></div><strong>{rm(item.renewal_amount_sen)}</strong></div>
        <div className="pk-sub-details"><div><span>{item.status==='trial'?'Trial ends / next charge':'Next listed charge'}</span><b>{item.next_charge_date}</b></div><div><span>Cancel by</span><b>{item.cancel_by_date||'Not specified'}</b></div><div><span>Frequency</span><b>{cycles.find(c=>c.value===item.billing_cycle)?.label}</b></div></div>
        <p className={'pk-sub-status '+(item.status!=='cancelled'&&days<=7?'urgent':'')}>{description(item)}</p>
        {item.note&&<p className="pk-sub-note">{item.note}</p>}
        <div className="pk-sub-actions"><button className="pk-btn" disabled={busy} onClick={()=>startEdit(item)}>Edit</button>
          {item.status!=='cancelled'&&<><button className="pk-btn" onClick={()=>downloadTrialCalendar(item)}>↓ Calendar alerts</button><button className="pk-btn" disabled={busy} onClick={()=>void changeStatus(item)}>Mark cancelled</button></>}
          <button className="pk-btn" disabled={busy} onClick={()=>void archive(item)}>Archive</button></div>
      </article>})}</div>}
    <div className="pk-sub-alert"><b>How alerts work:</b> PocketKu highlights upcoming deadlines when you open this page. For phone notifications, import the calendar file (7, 3 and 1 day beforehand) into a calendar that supports event alerts. PocketKu does not cancel subscriptions, send background push notifications, or charge your bank. If you edit a deadline, download a new reminder file.</div>
  </div>;
}
