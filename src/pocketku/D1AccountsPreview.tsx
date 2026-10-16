import {useEffect,useState,type FormEvent} from 'react';
import {archiveD1Account,getD1Accounts,updateD1Account,type D1AccountRecord} from './d1AccountsApi';
import './d1AccountsManager.css';
type Props={refreshKey?:number};
const format=(n:number)=>'RM '+(n/100).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function D1AccountsPreview({refreshKey=0}:Props){
 const [accounts,setAccounts]=useState<D1AccountRecord[]>([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [editing,setEditing]=useState<number|null>(null),[name,setName]=useState(''),[bank,setBank]=useState('');
 const [type,setType]=useState<'bank'|'tabung'>('bank'),[protectedSavings,setProtectedSavings]=useState(false);
 useEffect(()=>{let live=true;void getD1Accounts().then(rows=>{if(live){setAccounts(rows);setError('')}}).catch(e=>{if(live)setError(String(e))}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[refreshKey]);
 function begin(a:D1AccountRecord){setEditing(a.id);setName(a.name);setBank(a.bank_name);setType(a.account_type);setProtectedSavings(a.is_protected===1);setError('');setNotice('')}
 async function refresh(){const rows=await getD1Accounts();setAccounts(rows);window.dispatchEvent(new Event('pocketku:d1-accounts-changed'))}
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(editing===null||busy)return;setBusy(true);setError('');try{await updateD1Account(editing,{name:name.trim(),bank_name:bank.trim(),account_type:type,is_protected:protectedSavings?1:0});await refresh();setEditing(null);setNotice('Account details updated. Your balance and transaction history were not changed.')}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 async function archive(a:D1AccountRecord){if(!window.confirm(`Archive ${a.name}? Only empty accounts with no history can be archived.`))return;setBusy(true);setError('');try{await archiveD1Account(a.id);await refresh();setNotice('Unused account archived.')}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <section className="pk-card pk-account-manager">
  <h2>Accounts & balances</h2><p className="pk-muted">Cash, reserved money and available money are shown separately. You can edit account details here; balances change only through recorded transactions.</p>
  {error&&<p role="alert" className="pk-account-error">{error}</p>}{notice&&<p role="status" className="pk-account-success">{notice}</p>}
  {loading?<p>Loading accounts…</p>:accounts.length===0?<p>No saved accounts yet.</p>:accounts.map(a=><div className="pk-account-row" key={a.id}>
    <div className="pk-account-info"><strong>{a.name}</strong><small>{a.bank_name} · {a.account_type==='tabung'?'Savings / Tabung':'Bank account'}{a.is_protected?' · Protected':''}</small></div>
    <div className="pk-account-values"><strong>{format(a.current_balance_sen)}</strong><small>Reserved: {format(a.reserved_balance_sen)}</small><small>Available: {format(a.current_balance_sen-a.reserved_balance_sen)}</small></div>
    <div className="pk-account-controls"><button type="button" className="pk-btn" onClick={()=>begin(a)} disabled={busy}>Edit</button>
    <button type="button" className="pk-btn" disabled={busy||a.opening_balance_sen!==0||a.current_balance_sen!==0} onClick={()=>void archive(a)}>Archive</button></div>
    {editing===a.id&&<form className="pk-account-edit" onSubmit={e=>void save(e)}><h3>Edit account details</h3><div className="pk-two">
      <label>Name<input className="pk-input" value={name} onChange={e=>setName(e.target.value)} required maxLength={100}/></label>
      <label>Bank / provider<input className="pk-input" value={bank} onChange={e=>setBank(e.target.value)} required maxLength={100}/></label>
      <label>Type<select className="pk-input" value={type} onChange={e=>setType(e.target.value as 'bank'|'tabung')}><option value="bank">Bank</option><option value="tabung">Savings / Tabung</option></select></label>
      <label>Protection<select className="pk-input" value={protectedSavings?'yes':'no'} onChange={e=>setProtectedSavings(e.target.value==='yes')}><option value="no">Normal</option><option value="yes">Protected savings</option></select></label>
    </div><p className="pk-muted">Opening and current balances cannot be edited here; changing them requires a separate recorded adjustment.</p>
    <div className="pk-account-actions"><button className="pk-btn pk-primary" disabled={busy}>Save changes</button><button type="button" className="pk-btn" onClick={()=>setEditing(null)}>Cancel</button></div></form>}
   </div>)}
 </section>;
}
