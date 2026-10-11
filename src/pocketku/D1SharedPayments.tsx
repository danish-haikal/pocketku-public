import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {addMember,communityKey,deleteMember,getCollections,moneySen,newCollection,nextCollection,nextMonth,patchMember,prettyMonth,ringgit,type D1SharedCollection,type D1SharedMember} from './d1CommunityApi';
import './d1Community.css';

export default function D1SharedPayments({monthIndex}:{monthIndex:number}){
  const [collections,setCollections]=useState<D1SharedCollection[]>([]);
  const [members,setMembers]=useState<D1SharedMember[]>([]);
  const [selected,setSelected]=useState<number|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [name,setName]=useState(''),[memberName,setMemberName]=useState(''),[memberAmount,setMemberAmount]=useState(''),[isSelf,setIsSelf]=useState(false);
  const [edit,setEdit]=useState<number|null>(null),[editName,setEditName]=useState(''),[editAmount,setEditAmount]=useState('');
  const [newKey,setNewKey]=useState(communityKey),[carryKey,setCarryKey]=useState(communityKey);
  const month=useMemo(()=>{const d=new Date(Date.UTC(2026,9+monthIndex,1));return d.toISOString().slice(0,7);},[monthIndex]);
  const reload=async()=>{const result=await getCollections();setCollections(result.collections);setMembers(result.members);return result;};
  useEffect(()=>{let active=true;void getCollections().then(r=>{if(active){setCollections(r.collections);setMembers(r.members);setError('');setSelected(previous=>previous&&r.collections.some(c=>c.id===previous)?previous:r.collections.find(c=>c.period===month)?.id??null);}}).catch(e=>{if(active)setError(String(e))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[month]);
  const current=collections.find(x=>x.id===selected)||null;
  const entries=members.filter(m=>m.collection_id===selected);
  const others=entries.filter(m=>m.is_self!==1);
  const collected=others.filter(m=>m.received===1).reduce((s,m)=>s+m.share_sen,0);
  const remaining=others.filter(m=>m.received!==1).reduce((s,m)=>s+m.share_sen,0);
  async function act(job:()=>Promise<unknown>,message:string){setBusy(true);setError('');setNotice('');try{await job();await reload();setNotice(message)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  async function create(e:FormEvent<HTMLFormElement>){e.preventDefault();const key=newKey;const label=name.trim();if(!label){setError('Enter a subscription name.');return}
    await act(async()=>{await newCollection(key,label,month);const r=await getCollections();setSelected(r.collections.find(c=>c.period===month&&c.name.toLowerCase()===label.toLowerCase())?.id??null);setName('');setNewKey(communityKey());},'Collection created. Add each person and their share.');}
  async function carry(){if(!current)return;const target=nextMonth(current.period);if(!window.confirm(`Copy ${current.name} into ${prettyMonth(target)}? All Paid ticks reset to unpaid.`))return;
    await act(async()=>{await nextCollection(current.id,carryKey,target);const r=await getCollections();setSelected(r.collections.find(c=>c.period===target&&c.name===current.name)?.id??null);setCarryKey(communityKey());},'Next month created with fresh unpaid statuses.');}
  async function memberSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!current)return;const sen=moneySen(memberAmount);if(!memberName.trim()||sen===null){setError('Enter a member and a valid amount (e.g. 5.00).');return}
    await act(async()=>{await addMember(current.id,memberName.trim(),sen,isSelf);setMemberName('');setMemberAmount('');setIsSelf(false)},'Member saved.');}
  function startEdit(m:D1SharedMember){setEdit(m.id);setEditName(m.member_name);setEditAmount((m.share_sen/100).toFixed(2));}
  async function saveEdit(id:number){const sen=moneySen(editAmount);if(!editName.trim()||sen===null){setError('Check member name and amount.');return}await act(async()=>{await patchMember(id,{member_name:editName.trim(),share_sen:sen});setEdit(null)},'Member updated.');}
  return <div className="pk-community">
    <div className="pk-com-head"><div><h2>Shared subscriptions</h2><p>Track who owes you and who has reimbursed you. No bank money changes here.</p></div><button className="pk-btn" onClick={()=>void act(async()=>{await reload()},'Up to date.')} disabled={busy}>↻ Refresh</button></div>
    {error&&<div className="pk-com-error" role="alert">{error}</div>}{notice&&<p className="pk-com-notice">✓ {notice}</p>}
    <div className="pk-com-two">
      <section className="pk-com-card"><h3>New shared collection</h3><p className="pk-com-caption">For {prettyMonth(month)}. Example: Netflix, Google One or YouTube Family.</p>
        <form className="pk-com-form" onSubmit={e=>void create(e)}><label>Subscription name<input className="pk-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Netflix shared plan" maxLength={120} required/></label><button className="pk-btn pk-primary" disabled={busy}>+ Create collection</button></form>
      </section>
      <section className="pk-com-card"><h3>Your collections</h3><p className="pk-com-caption">Choose any saved month. Carry forward will copy members, not Paid ticks.</p>
        <label>Collection<select className="pk-input" value={current?.id??''} onChange={e=>{setSelected(e.target.value?Number(e.target.value):null);setEdit(null)}}><option value="">{loading?'Loading…':'Select a collection'}</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name} · {prettyMonth(c.period)}</option>)}</select></label>
        {current&&<button className="pk-btn" style={{marginTop:12}} disabled={busy} onClick={()=>void carry()}>↻ Copy into {prettyMonth(nextMonth(current.period))}</button>}
      </section>
    </div>
    {current?<section className="pk-com-card pk-com-detail">
      <div className="pk-com-title"><div><h3>{current.name}</h3><p>{prettyMonth(current.period)} · {entries.length} participant{entries.length===1?'':'s'}</p></div></div>
      <div className="pk-com-metrics"><div><span>Collected from others</span><strong>{ringgit(collected)}</strong></div><div><span>Still to collect</span><strong>{ringgit(remaining)}</strong></div><div><span>Your own share</span><strong>{ringgit(entries.filter(x=>x.is_self===1).reduce((s,m)=>s+m.share_sen,0))}</strong></div></div>
      <div className="pk-com-members">{entries.length===0?<p className="pk-com-caption">No participants yet. Add people below.</p>:entries.map(m=><div className="pk-com-member" key={m.id}>
        {edit===m.id?<div className="pk-com-edit"><label>Name<input className="pk-input" value={editName} onChange={e=>setEditName(e.target.value)} maxLength={100}/></label><label>Share (RM)<input className="pk-input" type="number" min="0" step="0.01" value={editAmount} onChange={e=>setEditAmount(e.target.value)}/></label><button className="pk-btn pk-primary" disabled={busy} onClick={()=>void saveEdit(m.id)}>Save</button><button className="pk-btn" onClick={()=>setEdit(null)}>Cancel</button></div>:
        <><div className="pk-com-member-meta"><b>{m.member_name}{m.is_self===1?' (you)':''}</b><small>{m.is_self===1?'Your own share':m.received===1?'Received ✓':'Awaiting payment'}</small></div><strong>{ringgit(m.share_sen)}</strong><div className="pk-com-member-actions">{m.is_self!==1&&<label className="pk-com-check"><input type="checkbox" checked={m.received===1} disabled={busy} onChange={e=>void act(()=>patchMember(m.id,{received:e.target.checked}),e.target.checked?'Marked received.':'Marked not received.')}/> Paid me</label>}<button className="pk-com-link" onClick={()=>startEdit(m)} disabled={busy}>Edit</button>{m.received===0&&<button className="pk-com-link" disabled={busy} onClick={()=>{if(window.confirm('Remove '+m.member_name+'?'))void act(()=>deleteMember(m.id),'Member removed.')}}>Remove</button>}</div></>}
      </div>)}</div>
      <form className="pk-com-inline" onSubmit={e=>void memberSubmit(e)}><label>Person<input className="pk-input" value={memberName} onChange={e=>setMemberName(e.target.value)} placeholder="Aiman" maxLength={100} required/></label><label>Share (RM)<input className="pk-input" type="number" min="0" step="0.01" value={memberAmount} onChange={e=>setMemberAmount(e.target.value)} placeholder="7.00" required/></label><label className="pk-com-check pk-com-self"><input type="checkbox" checked={isSelf} onChange={e=>setIsSelf(e.target.checked)}/> My share</label><button className="pk-btn pk-primary" disabled={busy}>+ Add participant</button></form>
    </section>:<section className="pk-com-card"><p className="pk-com-caption">Create or select a collection to manage its members.</p></section>}
    <p className="pk-com-note">These checkboxes are reimbursement records only. Checking Paid me never deposits money into your bank account. If you also record a real bank receipt, do it once in the bank ledger separately.</p>
  </div>
}
