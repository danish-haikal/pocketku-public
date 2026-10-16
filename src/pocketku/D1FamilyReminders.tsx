import {useEffect,useState,type FormEvent} from 'react';
import {archiveFamily,communityKey,getFamilyMonth,getFamilyProfiles,newFamilyProfile,moneySen,patchFamily,ringgit,setFamilyCheck,newFamily,monthFromIndex,prettyMonth,type FamilyOccurrence,type FamilyReminder,type FamilyProfile} from './d1CommunityApi';
import './d1Community.css';
export default function D1FamilyReminders({monthIndex}:{monthIndex:number}){
  const period=monthFromIndex(monthIndex);
  const [profiles,setProfiles]=useState<FamilyProfile[]>([]);
  const [person,setPerson]=useState<number|'all'>(1);
  const [addingPerson,setAddingPerson]=useState(false);
  const [personName,setPersonName]=useState('');
  const [all,setAll]=useState<FamilyReminder[]>([]),[rows,setRows]=useState<FamilyOccurrence[]>([]);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [name,setName]=useState(''),[amount,setAmount]=useState(''),[date,setDate]=useState(period+'-15');
  const [freq,setFreq]=useState<'one-time'|'monthly'|'yearly'>('monthly'),[note,setNote]=useState(''),[key,setKey]=useState(communityKey);
  const [editing,setEditing]=useState<number|null>(null),[editName,setEditName]=useState(''),[editAmount,setEditAmount]=useState(''),[editNote,setEditNote]=useState('');
  async function reload(){const [r,pr]=await Promise.all([getFamilyMonth(period),getFamilyProfiles()]);setAll(r.reminders);setRows(r.occurrences);setProfiles(pr.profiles)}
  useEffect(()=>{let active=true;void Promise.all([getFamilyMonth(period),getFamilyProfiles()]).then(([r,pr])=>{if(active){setAll(r.reminders);setRows(r.occurrences);setProfiles(pr.profiles);setError('')}}).catch(e=>{if(active)setError(String(e))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[period]);
  async function act(job:()=>Promise<unknown>,message:string){setBusy(true);setError('');setNotice('');try{await job();await reload();setNotice(message)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  async function create(e:FormEvent<HTMLFormElement>){e.preventDefault();const sen=moneySen(amount);if(!name.trim()||sen===null||sen<=0){setError('Enter a name and an amount greater than RM0.');return}
    if(person==='all'){setError('Select a family member to create a reminder.');return}
    await act(async()=>{await newFamily({creation_key:key,name:name.trim(),amount_sen:sen,first_due_date:date,frequency:freq,note:note.trim(),person_id:person});setName('');setAmount('');setNote('');setKey(communityKey())},'Reminder saved. It will appear in its scheduled months.');}
  const visibleRows=rows.filter(r=>person==='all'||r.person_id===person);
  const visibleReminders=all.filter(r=>person==='all'||r.person_id===person);
  async function savePerson(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!personName.trim())return;
    await act(async()=>{const out=await newFamilyProfile(personName.trim());setPerson(out.id);setAddingPerson(false);setPersonName('')},'Family member added.');}
  const total=visibleRows.reduce((sum,r)=>sum+r.amount_sen,0);
  const paid=visibleRows.filter(r=>r.paid===1).reduce((sum,r)=>sum+r.amount_sen,0);
  function startEdit(r:FamilyReminder){setEditing(r.id);setEditName(r.name);setEditAmount((r.amount_sen/100).toFixed(2));setEditNote(r.note)}
  async function saveEdit(id:number){const sen=moneySen(editAmount);if(!editName.trim()||sen===null||sen<=0){setError('Enter a name and valid amount.');return}
    await act(async()=>{await patchFamily(id,{name:editName.trim(),amount_sen:sen,note:editNote.trim()});setEditing(null)},'Reminder updated for future unchecked occurrences.');}
  return <div className="pk-community">
    <div className="pk-com-head"><div><h2>Family payment reminders</h2><p>A separate checklist of upcoming family bills. No bank or debt entries are created.</p></div><button className="pk-btn" disabled={busy} onClick={()=>void act(reload,'Up to date.')}>↻ Refresh</button></div>
    {error&&<div role="alert" className="pk-com-error">{error}</div>}{notice&&<p className="pk-com-notice">✓ {notice}</p>}
    <div className="pk-family-members" aria-label="Family member filters">
      {profiles.map(x=><button key={x.id} type="button" className={'pk-btn '+(person===x.id?'pk-primary':'')} onClick={()=>setPerson(x.id)}>{x.name}</button>)}
      <button type="button" className={'pk-btn '+(person==='all'?'pk-primary':'')} onClick={()=>setPerson('all')}>All</button>
      <button type="button" className="pk-btn" onClick={()=>setAddingPerson(x=>!x)}>+ Add person</button>
    </div>
    {addingPerson&&<form className="pk-family-add" onSubmit={e=>void savePerson(e)}>
      <label>Family member name<input className="pk-input" required maxLength={80} value={personName} onChange={e=>setPersonName(e.target.value)} placeholder="e.g. Sister"/></label>
      <button className="pk-btn pk-primary" disabled={busy}>Save person</button>
      <button className="pk-btn" type="button" onClick={()=>setAddingPerson(false)}>Cancel</button>
    </form>}
    <div className="pk-com-two">
      <section className="pk-com-card"><h3>Add a reminder</h3><p className="pk-com-caption">Monthly and yearly reminders repeat automatically; each month/year has its own Paid tick.</p>
        <form className="pk-com-form" onSubmit={e=>void create(e)}>
          <label>Reminder for<select className="pk-input" required value={person==='all'?'':person} onChange={e=>setPerson(Number(e.target.value))}>
            {person==='all'&&<option value="">Select a person</option>}
            {profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select></label>
          <label>Bill name<input className="pk-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Insurance renewal" maxLength={120} required/></label>
          <div className="pk-com-inline"><label>Amount (RM)<input className="pk-input" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required/></label><label>First due date<input className="pk-input" type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label></div>
          <label>Repeat<select className="pk-input" value={freq} onChange={e=>setFreq(e.target.value as typeof freq)}><option value="one-time">One time</option><option value="monthly">Every month</option><option value="yearly">Every year</option></select></label>
          <label>Notes (optional)<input className="pk-input" value={note} maxLength={500} onChange={e=>setNote(e.target.value)} placeholder="Policy or reference note"/></label>
          <button className="pk-btn pk-primary" disabled={busy}>+ Save reminder</button>
        </form>
      </section>
      <section className="pk-com-card"><h3>{prettyMonth(period)} overview</h3><div className="pk-com-metrics pk-com-mini"><div><span>Scheduled</span><strong>{ringgit(total)}</strong></div><div><span>Paid</span><strong>{ringgit(paid)}</strong></div><div><span>Unpaid</span><strong>{ringgit(total-paid)}</strong></div></div><p className="pk-com-note">Choose another month in the PocketKu toolbar to see that month's occurrences. A paid October bill stays paid when November is still unpaid.</p></section>
    </div>
    <section className="pk-com-card pk-com-detail"><h3>Payment checklist · {prettyMonth(period)}</h3>
      {loading?<p className="pk-com-caption">Loading reminders…</p>:visibleRows.length===0?<p className="pk-com-caption">Nothing due this month. Add a reminder or change the month selector.</p>:visibleRows.map(r=><div className="pk-com-reminder" key={r.id+'-'+r.due_date}>
        <div className="pk-com-reminder-info"><b>{r.name}</b><small>{profiles.find(p=>p.id===r.person_id)?.name || 'Family'} · Due {r.due_date} · {r.frequency==='one-time'?'One-time':r.frequency==='monthly'?'Monthly':'Yearly'}{r.note?' · '+r.note:''}</small></div><strong>{ringgit(r.amount_sen)}</strong><label className="pk-com-check"><input disabled={busy} type="checkbox" checked={r.paid===1} onChange={e=>void act(()=>setFamilyCheck(r.id,r.due_date,e.target.checked),e.target.checked?'Marked paid for this due date.':'Marked unpaid for this due date.')}/> Paid</label>
      </div>)}
    </section>
    <section className="pk-com-card"><h3>Manage recurring reminders</h3><p className="pk-com-caption">Edit the name/amount for future occurrences, or archive a reminder. Previous checked amounts are kept as snapshots.</p>
      {visibleReminders.filter(x=>x.is_active===1).length===0?<p className="pk-com-caption">No saved reminders yet.</p>:visibleReminders.filter(x=>x.is_active===1).map(r=><div key={r.id} className="pk-com-rule">
        {editing===r.id?<div className="pk-com-form"><label>Name<input className="pk-input" value={editName} onChange={e=>setEditName(e.target.value)}/></label><label>Amount (RM)<input className="pk-input" type="number" min="0.01" step="0.01" value={editAmount} onChange={e=>setEditAmount(e.target.value)}/></label><label>Notes<input className="pk-input" value={editNote} onChange={e=>setEditNote(e.target.value)}/></label><div className="pk-com-actions"><button className="pk-btn pk-primary" onClick={()=>void saveEdit(r.id)} disabled={busy}>Save</button><button className="pk-btn" onClick={()=>setEditing(null)}>Cancel</button></div></div>:
          <><div className="pk-com-reminder-info"><b>{r.name}</b><small>{ringgit(r.amount_sen)} · Starts {r.first_due_date} · {r.frequency}</small></div><div className="pk-com-actions"><button className="pk-com-link" disabled={busy} onClick={()=>startEdit(r)}>Edit</button><button className="pk-com-link" disabled={busy} onClick={()=>{if(window.confirm('Archive '+r.name+'? It will disappear from future checklists.'))void act(()=>archiveFamily(r.id),'Reminder archived.')}}>Archive</button></div></>}
      </div>)}
    </section>
    <p className="pk-com-note">Paid here means the family bill was checked off; it does not deduct your cash or another family member’s cash. PocketKu does not send automatic notifications yet.</p>
  </div>;
}
