import {useEffect,useRef,useState,type FormEvent} from 'react';
import D1AccountsPreview from './D1AccountsPreview';
import {createD1Account,createD1Transfer,getD1Accounts,type D1AccountRecord} from './d1AccountsApi';

const sen=(value:string)=>{if(!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))return null;const [w,f='']=value.trim().split('.');const v=Number(w)*100+Number(f.padEnd(2,'0'));return Number.isSafeInteger(v)?v:null};
export default function D1AccountsManager(){
  const [records,setRecords]=useState<D1AccountRecord[]>([]);
  const [version,setVersion]=useState(0);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{let live=true;void getD1Accounts().then(data=>{if(live)setRecords(data)}).catch(e=>{if(live)setError(e instanceof Error?e.message:String(e))});return()=>{live=false}},[]);
  const transferRef=useRef<{signature:string;id:string}|null>(null);
  async function reload(){const data=await getD1Accounts();setRecords(data);setVersion(v=>v+1);window.dispatchEvent(new Event('pocketku:d1-accounts-changed'))}
  async function add(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;
    const form=event.currentTarget, f=new FormData(form),value=sen(String(f.get('opening')||'0'));
    if(value===null||value<0){setError('Enter a valid starting balance.');return;}
    setBusy(true);setError('');try{await createD1Account({name:String(f.get('name')||'').trim(),bank_name:String(f.get('bank')||'').trim(),account_type:f.get('accountType')==='tabung'?'tabung':'bank',opening_balance_sen:value,is_protected:f.get('protected')==='yes'?1:0});form.reset();await reload();setNotice('Account saved.');}
    catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  async function transfer(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;
    const form=event.currentTarget,f=new FormData(form),from=Number(f.get('from')),to=Number(f.get('to')),value=sen(String(f.get('amount')||'')),note=String(f.get('note')||'Transfer').trim();
    const src=records.find(x=>x.id===from);
    if(!src||from===to||!records.some(x=>x.id===to)||!value||value<1||note.length>200){setError('Choose different accounts, a valid amount and a short note.');return;}
    if(value>src.current_balance_sen-src.reserved_balance_sen){setError('Not enough available cash.');return;}
    if(src.is_protected===1&&!window.confirm(`Transfer from protected savings “${src.name}”?`))return;
    const signature=JSON.stringify([from,to,value,note]);if(transferRef.current?.signature!==signature)transferRef.current={signature,id:crypto.randomUUID()};
    setBusy(true);setError('');try{await createD1Transfer({from_account_id:from,to_account_id:to,amount_sen:value,note,request_id:transferRef.current.id,acknowledge_protected:src.is_protected===1});transferRef.current=null;form.reset();await reload();setNotice('Transfer recorded. Both account balances are updated.');}
    catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  return <div className="pk-prod-panel"><div className="pk-prod-heading"><h1>My accounts</h1><p>Manage your banks and savings pots in one place.</p></div>
    {notice&&<div className="pk-notice" role="status">{notice}</div>}{error&&<p className="pk-red" role="alert">{error}</p>}
    <D1AccountsPreview refreshKey={version}/>
    <div className="pk-cols">
      <section className="pk-card"><h2>Add an account</h2><form className="pk-form pk-two" onSubmit={e=>void add(e)}>
        <label>Name<input name="name" className="pk-input" required maxLength={100} placeholder="Savings account"/></label>
        <label>Bank<input name="bank" className="pk-input" required maxLength={100} placeholder="Bank name"/></label>
        <label>Starting balance (RM)<input className="pk-input" name="opening" type="number" min="0" step=".01" defaultValue="0" required/></label>
        <label>Account type<select name="accountType" className="pk-input"><option value="bank">Bank account</option><option value="tabung">Tabung / savings pot</option></select></label>
        <label>Protection<select name="protected" className="pk-input"><option value="no">Standard</option><option value="yes">Protected savings</option></select></label>
        <button className="pk-btn pk-primary" disabled={busy} type="submit">{busy?'Saving…':'Save account'}</button>
      </form></section>
      <section className="pk-card"><h2>Transfer between accounts</h2><p className="pk-muted">This records money moving between two accounts, not new income.</p>
        <form className="pk-form" onSubmit={e=>void transfer(e)}>
          <label>From<select className="pk-input" name="from" onChange={()=>setError('')} required><option value="">Select account</option>{records.filter(x=>x.is_active===1).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>To<select className="pk-input" name="to" required><option value="">Select account</option>{records.filter(x=>x.is_active===1).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>Amount (RM)<input className="pk-input" name="amount" type="number" min="0.01" step=".01" required/></label>
          <label>Note<input className="pk-input" name="note" maxLength={200} placeholder="Optional"/></label>
          <button className="pk-btn pk-primary" type="submit" disabled={busy||records.length<2}>{busy?'Saving…':'Record transfer'}</button>
        </form>
      </section>
    </div>
  </div>
}
