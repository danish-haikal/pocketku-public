import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createDemoData } from './pocketku/seed';
import D1AccountsPreview from './pocketku/D1AccountsPreview';
import D1MonthlyPlanner from './pocketku/D1MonthlyPlanner';
import D1FinancialOverview from './pocketku/D1FinancialOverview';
import D1Debts from './pocketku/D1Debts';
import D1SharedPayments from './pocketku/D1SharedPayments';
import D1FamilyReminders from './pocketku/D1FamilyReminders';
import D1DataSafety from './pocketku/D1DataSafety';
import PocketKuAuthGate from './pocketku/PocketKuAuthGate';
import { createD1Account, createD1Transfer, getD1Accounts, type D1AccountRecord } from './pocketku/d1AccountsApi';
import { confirmD1Income, createD1ExpectedIncome, getD1Income, updateD1IncomeEstimate, type D1IncomeRecord } from './pocketku/d1IncomeApi';
import {
  billStatusSum, billsFor, cashBalance, freeBalance,
  monthTarget, reservedBalance, totalCash, totalReserved, validateFinances,
} from './pocketku/finance';
import {
  amount, fromCents, monthNames, toCents, uid,
  type Account, type Commitment, type FinanceData, type PaymentStatus,
} from './pocketku/types';

const KEY = 'pocketku-demo-v1';
const tabs = [
  ['overview','Overview','▦'],['monthly','Monthly plan','☷'],['accounts','My accounts','▣'],
  ['funding','Money sources','↗'],['income','Income','⊕'],['settlements','Settlements','◇'],
  ['shared','Shared payments','♧'],['mother',"Mother's reminders",'♡'],['scenario','Scenarios','◷'],['safety','Data & safety','◈'],
] as const;
type Tab = (typeof tabs)[number][0];
function readData(): FinanceData {
  try {
    const saved = localStorage.getItem(KEY);
    if(saved){const parsed: FinanceData=JSON.parse(saved); if(parsed.version===1&&Array.isArray(parsed.accounts)&&Array.isArray(parsed.commitments))return parsed;}
  }catch { /* Invalid demo cache: restore example data. */ }
  return createDemoData();
}
/** Sync D1 account definitions and their ledger-calculated cash into the demo UI.
 * D1 account IDs stay stable; browser-only payments/transfers remain temporary demo overlays.
 * Until migration is complete, do not enter real money movements in the demo forms.
 */
function mergeD1AccountDefinitions(previous: FinanceData, rows: D1AccountRecord[]): FinanceData {
  const dbAccounts: Account[] = rows
    .filter(row => Number.isSafeInteger(row.id) && row.is_active === 1)
    .map(row => ({
      id: `d1-${row.id}`,
      name: row.name,
      bank: row.bank_name,
      // This temporary display-model openingCents is the *current D1 cash*,
      // so all existing dashboard/available/Money Sources calculations see it.
      // The real opening amount is untouched and stored in the D1 database.
      openingCents: row.current_balance_sen,
      protected: row.is_protected === 1,
      color: row.account_type === 'tabung' ? '#76618b' : '#516d83',
    }));
  const browserDemoAccounts = previous.accounts.filter(account => !account.id.startsWith('d1-'));
  return { ...previous, accounts: [...browserDemoAccounts, ...dbAccounts] };
}

function PocketKuDashboard() {
  const [data,setData]=useState<FinanceData>(readData);
  const [theme,setTheme]=useState<'light'|'dark'>(()=>localStorage.getItem('pocketku-theme')==='dark'?'dark':'light');
  const [tab,setTab]=useState<Tab>('overview');
  const [month,setMonth]=useState(0);
  const [notice,setNotice]=useState('');
  const [savingAccount,setSavingAccount]=useState(false);
  const [savingTransfer,setSavingTransfer]=useState(false);
  // Keep the same request ID if a network error makes a transfer's result uncertain.
  const pendingTransfer=useRef<{signature:string;requestId:string}|null>(null);
  const [d1Refresh,setD1Refresh]=useState(0);
  const [d1Income,setD1Income]=useState<D1IncomeRecord[]>([]);
  const [incomeRefresh,setIncomeRefresh]=useState(0);
  const [loadingIncome,setLoadingIncome]=useState(true);
  const [incomeError,setIncomeError]=useState('');
  const [confirmingIncome,setConfirmingIncome]=useState<string|null>(null);
  const [incomeMonthFilter,setIncomeMonthFilter]=useState('all');
  const [incomeStatusFilter,setIncomeStatusFilter]=useState<'all'|'expected'|'received'>('all');
  const [editingExpectedKey,setEditingExpectedKey]=useState<string|null>(null);
  const [savingExpectedKey,setSavingExpectedKey]=useState<string|null>(null);
  const [creatingExpectedIncome,setCreatingExpectedIncome]=useState(false);
  // Reuse the reference if a network request is interrupted; do not create a
  // second forecast inadvertently by retrying the same form submission.
  const pendingExpectedCreation=useRef<{signature:string;key:string}|null>(null);
  const [editing,setEditing]=useState<string|null>(null);
  const [draft,setDraft]=useState({name:'',amount:'0.00',category:'Bill',seq:'0',total:'0',dueDate:'',scope:'one',repeat:false,endMonth:21});

  useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(data))}catch{/*Browser storage disabled*/}},[data]);
  useEffect(()=>{try{localStorage.setItem('pocketku-theme',theme)}catch{/*Browser storage disabled*/}},[theme]);

  // Import locally saved D1 account definitions on app load. Ids stay stable
  // (d1-1, d1-2, ...) so Money Sources can reference the same accounts.
  useEffect(() => {
    let active = true;
    void getD1Accounts().then(rows => {
      if (active) setData(prev => mergeD1AccountDefinitions(prev, rows));
    }).catch(err => {
      if (active) setNotice('D1 is unavailable; local demo remains usable. ' + (err instanceof Error ? err.message : ''));
    });
    const update=()=>{
      void getD1Accounts().then(rows=>{
        if(active){setData(prev=>mergeD1AccountDefinitions(prev,rows));setD1Refresh(n=>n+1)}
      }).catch(err=>{if(active)setNotice('Could not refresh D1 bank balances: '+String(err))});
    };
    window.addEventListener('pocketku:d1-accounts-changed',update);
    return () => { active = false;window.removeEventListener('pocketku:d1-accounts-changed',update); };
  }, []);


  // Income in this section is read from D1, never copied to demo income.
  // Existing browser-only income is left untouched for backwards compatibility.
  useEffect(() => {
    let active = true;
    void getD1Income().then(rows => {
      if (active) { setD1Income(rows); setIncomeError(''); }
    }).catch(err => {
      if (active) setIncomeError(err instanceof Error ? err.message : 'Income API unavailable.');
    }).finally(() => { if (active) setLoadingIncome(false); });
    return () => { active = false; };
  }, [incomeRefresh]);


  const incomeMonthOptions=useMemo(() =>
    [...new Set(d1Income.map(row => row.period || (row.expected_date ? row.expected_date.slice(0,7) : 'unscheduled')))]
      .sort((a,b)=>a.localeCompare(b)),[d1Income]);
  const visibleIncome=useMemo(() => d1Income.filter(row => {
    const key=row.period || (row.expected_date ? row.expected_date.slice(0,7) : 'unscheduled');
    const received=row.ledger_entry_id!==null;
    return (incomeMonthFilter==='all'||incomeMonthFilter===key) &&
      (incomeStatusFilter==='all'||
        (incomeStatusFilter==='received'?received:!received));
  }),[d1Income,incomeMonthFilter,incomeStatusFilter]);
  const incomeExpectedTotal=visibleIncome.reduce((sum,row)=>sum+
    (row.ledger_entry_id===null?(row.expected_amount_sen||0):0),0);
  const incomeReceivedTotal=visibleIncome.reduce((sum,row)=>sum+
    (row.ledger_entry_id!==null?(row.received_amount_sen||0):0),0);

  const accountName=(id?:string)=>data.accounts.find(a=>a.id===id)?.name||'Choose account';
  const monthlyBills=useMemo(()=>billsFor(data,month),[data,month]);
  const cash=totalCash(data);
  const reserved=totalReserved(data);
  const target=monthTarget(data,month);
  const paid=billStatusSum(data,month,'paid');
  const marked=billStatusSum(data,month,'reserved');
  const show=(text:string)=>setNotice(text);

  /** Commit a proposed financial change only if the account ledger stays valid. */
  function change(mutator:(next:FinanceData)=>void, strict=true):boolean {
    const next=structuredClone(data);
    mutator(next);
    const problem=strict?validateFinances(next):null;
    if(problem){show(problem+' Change not saved.');return false}
    setData(next);setNotice('');return true;
  }
  function confirmProtected(id:string,verb:string){
    const a=data.accounts.find(x=>x.id===id);
    return !(a?.protected)&&true || window.confirm(`${a?.name||'This account'} is a protected Tabung. ${verb} anyway?`);
  }
  function openEditor(b?:Commitment){
    setEditing(b?.id||'new');
    setDraft({name:b?.name||'',amount:fromCents(b?.amountCents||0),category:b?.category||'Bill',seq:String(b?.installmentNo||0),total:String(b?.installmentTotal||0),dueDate:b?.dueDate||'',scope:'one',repeat:false,endMonth:Math.min(21,month+5)});
  }
  function saveEditor(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const cents=toCents(draft.amount),seq=Number(draft.seq),max=Number(draft.total);
    if(!draft.name.trim()||!Number.isFinite(cents)||cents<0||seq<0||max<0||(!Number.isInteger(seq))||(!Number.isInteger(max))||(max>0&&seq>max)){show('Check the name, amount and instalment numbers.');return}
    change(next=>{
      if(editing==='new'){
        const series=draft.repeat?uid():undefined;
        const end=draft.repeat?Math.max(month,Math.min(21,draft.endMonth)):month;
        for(let m=month;m<=end;m++) next.commitments.push({id:uid(),month:m,name:draft.name.trim(),amountCents:cents,category:draft.category||'Bill',seriesId:series,installmentNo:max?seq+m-month:undefined,installmentTotal:max||undefined,dueDate:m===month?draft.dueDate||undefined:undefined,status:'unallocated'});
      }else{
        const item=next.commitments.find(x=>x.id===editing);
        if(!item)return;
        const series=item.seriesId;
        const apply=(x:Commitment,m:number)=>{
          x.name=draft.name.trim();x.category=draft.category||'Bill';x.amountCents=cents;
          x.installmentTotal=max||undefined;x.installmentNo=max?seq+m-month:undefined;
          if(m===month)x.dueDate=draft.dueDate||undefined;
        };
        apply(item,month);
        if(draft.scope==='future'&&series){
          next.commitments.filter(x=>x.seriesId===series&&x.month>month).forEach(x=>apply(x,x.month));
        }
      }
    });
    setEditing(null);
  }
  function changeBillStatus(id:string,newStatus:PaymentStatus){
    const b=data.commitments.find(x=>x.id===id);if(!b)return;
    if(newStatus!=='unallocated'&&!b.accountId){show('Choose the payment account first, then update the status.');return}
    if(newStatus!=='unallocated'&&b.accountId&&!confirmProtected(b.accountId,'Use money for this commitment'))return;
    change(next=>{const found=next.commitments.find(x=>x.id===id);if(found)found.status=newStatus});
  }
  function changeBillAccount(id:string,accountId:string){
    const bill=data.commitments.find(x=>x.id===id);if(!bill)return;
    if(accountId&&bill.status!=='unallocated'&&!confirmProtected(accountId,'Assign this payment to it'))return;
    change(next=>{const found=next.commitments.find(x=>x.id===id);if(found)found.accountId=accountId||undefined});
  }
  async function addAccount(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (savingAccount) return;
    const form = e.currentTarget;
    const fields = new FormData(form);
    const name = String(fields.get('name') || '').trim();
    const bank = String(fields.get('bank') || '').trim();
    const opening = toCents(String(fields.get('opening') || '0'));
    const type = fields.get('accountType') === 'tabung' ? 'tabung' : 'bank';
    const protectedSavings = fields.get('protected') === 'yes' ? 1 : 0;

    if (!name || !bank || !Number.isSafeInteger(opening) || opening < 0) {
      show('Enter a valid name, bank and balance (RM).');
      return;
    }

    setSavingAccount(true);
    try {
      await createD1Account({
        name,
        bank_name: bank,
        account_type: type,
        opening_balance_sen: opening,
        is_protected: protectedSavings,
      });
      // Refresh from D1 as the source of truth. Never independently create a
      // second browser-only version of this account.
      const rows = await getD1Accounts();
      setData(prev => mergeD1AccountDefinitions(prev, rows));
      setD1Refresh(prev => prev + 1);
      form.reset();
      show('Saved in local D1. This account now appears in Money Sources and payment account selectors.');
    } catch (err) {
      show('Account could not be synchronised: ' + (err instanceof Error ? err.message : 'Unknown error') + '. Check the D1 list before retrying to avoid duplicate creation.');
    } finally {
      setSavingAccount(false);
    }
  }

  async function transfer(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(savingTransfer)return;
    const form=e.currentTarget, f=new FormData(form);
    const fromId=String(f.get('from')||''),toId=String(f.get('to')||'');
    const value=toCents(String(f.get('amount')||''));
    const note=String(f.get('note')||'Transfer').trim();
    if(!fromId.startsWith('d1-')||!toId.startsWith('d1-')){
      show('For this step, transfers must be between two D1 accounts. Demo bank accounts are not connected yet.');return;
    }
    if(fromId===toId||!Number.isSafeInteger(value)||value<=0||note.length>200){
      show('Choose different D1 accounts, a positive amount and a note under 200 characters.');return;
    }
    const source=data.accounts.find(x=>x.id===fromId);
    if(!source){show('Source account not found.');return}
    if(value>freeBalance(data,fromId)){
      show('Not enough unallocated cash in that account for this transfer.');return;
    }
    if(!confirmProtected(fromId,'Transfer money out'))return;
    const fromNumber=Number(fromId.slice(3)),toNumber=Number(toId.slice(3));
    if(!Number.isSafeInteger(fromNumber)||!Number.isSafeInteger(toNumber)){
      show('Invalid D1 account identifier.');return;
    }
    const signature=JSON.stringify([fromNumber,toNumber,value,note]);
    if(!pendingTransfer.current||pendingTransfer.current.signature!==signature){
      pendingTransfer.current={signature,requestId:crypto.randomUUID()};
    }
    const requestId=pendingTransfer.current.requestId;
    setSavingTransfer(true);
    try {
      await createD1Transfer({
        from_account_id:fromNumber,to_account_id:toNumber,amount_sen:value,note,
        request_id:requestId,acknowledge_protected:source.protected,
      });
      // Re-fetch from D1. Crucially, DON'T also add this to browser-only transfers.
      const rows=await getD1Accounts();
      setData(prev=>mergeD1AccountDefinitions(prev,rows));
      setD1Refresh(prev=>prev+1);
      pendingTransfer.current=null;
      form.reset();
      show('Transfer saved to local D1. Both account balances were refreshed.');
    }catch(err){
      show('Transfer could not be confirmed: '+(err instanceof Error?err.message:'Unknown error')+
        '. Check the D1 balances before retrying; identical retry uses the same reference.');
    }finally{setSavingTransfer(false)}
  }

  async function confirmExpectedIncome(event:FormEvent<HTMLFormElement>, receipt:D1IncomeRecord) {
    event.preventDefault();
    if (confirmingIncome) return;
    if (receipt.ledger_entry_id !== null) {
      show('This income has already been received in D1.');
      return;
    }
    const form = event.currentTarget;
    const fields = new FormData(form);
    const accountString = String(fields.get('account') || '');
    const amountSen = toCents(String(fields.get('amount') || ''));
    if (!accountString.startsWith('d1-') || !Number.isSafeInteger(amountSen) || amountSen <= 0) {
      show('Choose a D1 account and a valid positive amount.');
      return;
    }
    const accountId = Number(accountString.slice(3));
    if (!Number.isSafeInteger(accountId) || accountId <= 0) {
      show('Invalid D1 account.'); return;
    }
    const recipient = data.accounts.find(a => a.id === accountString);
    if (!recipient) { show('D1 account is not available.'); return; }
    if (!window.confirm(
      `Mark “${receipt.source_name}” as actually received?\n\n` +
      `${amount(amountSen)} will be credited into ${recipient.name} in local D1.\n` +
      'This operation cannot be undone from the current interface.'
    )) return;

    setConfirmingIncome(receipt.income_key);
    try {
      const result = await confirmD1Income({
        income_key: receipt.income_key,
        account_id: accountId,
        amount_sen: amountSen,
      });
      // D1 is the only source of truth for these receipts.
      // Never add the same credit to data.income in the browser demo.
      const [newAccounts, newIncome] = await Promise.all([getD1Accounts(), getD1Income()]);
      setData(previous => mergeD1AccountDefinitions(previous, newAccounts));
      setD1Income(newIncome);
      setD1Refresh(prev => prev + 1);
      show(result.already_received
        ? 'Income was already recorded; no duplicate credit was created.'
        : `${amount(amountSen)} recorded once in local D1 for ${receipt.source_name}.`);
      form.reset();
    } catch (err) {
      show('Income confirmation could not be verified: ' +
        (err instanceof Error ? err.message : 'Unknown error') +
        '. Check /api/income and the account balance before retrying.');
      // If the server saved it but refreshing failed, the next refresh still
      // shows its received status, instead of making another browser credit.
      setIncomeRefresh(prev => prev + 1);
    } finally {
      setConfirmingIncome(null);
    }
  }
  async function saveExpectedIncome(event:FormEvent<HTMLFormElement>, receipt:D1IncomeRecord) {
    event.preventDefault();
    if (savingExpectedKey || confirmingIncome || receipt.ledger_entry_id!==null) return;
    const fields=new FormData(event.currentTarget);
    const amountSen=toCents(String(fields.get('expected_amount')||''));
    const dateString=String(fields.get('expected_date')||'').trim();
    if (!Number.isSafeInteger(amountSen) || amountSen<0) {
      show('Enter a valid forecast amount (RM0.00 or more).'); return;
    }
    if (dateString && !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      show('Enter a valid planned date.'); return;
    }
    setSavingExpectedKey(receipt.income_key);
    try {
      await updateD1IncomeEstimate({
        income_key:receipt.income_key,
        expected_amount_sen:amountSen,
        expected_date:dateString||null,
      });
      // Forecast updates never change D1 bank balances or the ledger.
      const rows=await getD1Income();
      setD1Income(rows);
      setEditingExpectedKey(null);
      show('Expected income updated in local D1. No bank balance was changed.');
    } catch(err) {
      show('Could not update expected income: ' +
        (err instanceof Error?err.message:'Unknown error'));
      setIncomeRefresh(v=>v+1);
    } finally {
      setSavingExpectedKey(null);
    }
  }

  async function addExpectedIncome(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingExpectedIncome) return;
    const form=event.currentTarget;
    const fields=new FormData(form);
    const source=String(fields.get('source')||'').trim();
    const incomeType=String(fields.get('income_type')||'other') as D1IncomeRecord['income_type'];
    const period=String(fields.get('period')||'').trim();
    const expectedRaw=String(fields.get('expected_amount')||'').trim();
    const expectedSen=expectedRaw===''?null:toCents(expectedRaw);
    const expectedDate=String(fields.get('expected_date')||'').trim()||null;
    if (!source || source.length>100 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
        (expectedSen!==null && (!Number.isSafeInteger(expectedSen)||expectedSen<0)) ||
        !['mara','refund','family','other'].includes(incomeType)) {
      show('Please enter a valid income source, month and estimated amount.');return;
    }
    const signature=JSON.stringify([source,incomeType,period,expectedSen,expectedDate]);
    if (!pendingExpectedCreation.current || pendingExpectedCreation.current.signature!==signature) {
      pendingExpectedCreation.current={signature,key:'manual:'+crypto.randomUUID()};
    }
    setCreatingExpectedIncome(true);
    try {
      const result=await createD1ExpectedIncome({
        income_key:pendingExpectedCreation.current.key,
        source_name:source,
        income_type:incomeType,
        period,
        expected_amount_sen:expectedSen,
        expected_date:expectedDate,
      });
      const records=await getD1Income();
      setD1Income(records);
      setIncomeMonthFilter(period);
      setIncomeStatusFilter('all');
      show(result.already_exists
        ? 'This forecast was already saved; no duplicate was created.'
        : 'Expected income added to local D1. No account was credited.');
      pendingExpectedCreation.current=null;
      form.reset();
    } catch(err) {
      show('Unable to verify expected income: '+
        (err instanceof Error?err.message:'Unknown error')+
        '. Check Income after refresh before creating another entry.');
      setIncomeRefresh(x=>x+1);
    } finally { setCreatingExpectedIncome(false); }
  }

  function exportDemo(){
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='pocketku-demo-backup.json';a.click();URL.revokeObjectURL(url);
    show('Demo backup exported. Keep exported financial data private.');
  }
  const selectAccount=(value:string,onChange:(id:string)=>void,placeholder='Choose account')=>(
    <select aria-label="Account" className="pk-input" value={value} onChange={e=>onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {data.accounts.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}
    </select>
  );
  const metric=(label:string,value:string,description:string,tone?:'green'|'red')=>(
    <div className="pk-metric" key={label}><div className="pk-muted">{label}</div><div className={'pk-num '+(tone?'pk-'+tone:'')}>{value}</div><div className="pk-muted">{description}</div></div>
  );
  const sectionHeading=(title:string,subtitle:string)=>(<div className="pk-section-head"><div><h1>{title}</h1><p>{subtitle}</p></div></div>);
  const pageOverview = ()=>(<>
    {sectionHeading('Your money, organised.','Current D1 cash, actual reservations and planned commitments in one reliable view.')}
    <D1FinancialOverview key={month} mode="overview" monthIndex={month}
      onOpenMonthly={()=>setTab('monthly')} onOpenAccounts={()=>setTab('accounts')}/>
    <details className="pk-card pk-f-legacy">
      <summary>What happened to the original browser-only dashboard?</summary>
      <p>The original example accounts and calculated totals are still in browser storage for the other unfinished demo sections. They are deliberately excluded from the D1 financial totals above to avoid double-counting.</p>
      <p>Shared payments, Mother's reminders and Settlements now use separate D1 modules. Only the Scenario simulator and older examples remain browser-only.</p>
    </details>
  </>);
  const pageMonthly=()=>(<>
    {sectionHeading('Monthly allocations','Each allocation month prepares money for the following payment cycle.')}
    <D1MonthlyPlanner key={month} monthIndex={month} />
    <details className="pk-card"><summary style={{cursor:'pointer',fontWeight:700}}>Show original browser-only demo commitments (not synced to D1)</summary><div style={{marginTop:16}}>
    <div className="pk-toolbar"><div className="pk-select-wrap"><label htmlFor="month-allocations">Allocation month</label><select id="month-allocations" className="pk-input" value={month} onChange={e=>{setMonth(+e.target.value);setEditing(null)}}>{monthNames.map((m,i)=><option key={m} value={i}>{m}</option>)}</select></div><button className="pk-btn pk-primary" onClick={()=>openEditor()}>+ Add commitment</button></div>
    <div className="pk-statgrid">{metric('Target',amount(target),`${monthlyBills.length} commitments`)}{metric('Reserved',amount(marked),'Item-level status')}{metric('Paid',amount(paid),'Recorded cash outflow')}{metric('To allocate',amount(Math.max(0,target-marked-paid)),'Unallocated item amounts')}</div>
    <div className="pk-receipt pk-full-receipt"><div className="pk-receipt-heading">✦ POCKETKU<br/><small>{monthNames[month].toUpperCase()} · ITEMISED RECEIPT</small></div>
      {monthlyBills.map(b=><div className="pk-bill" key={b.id}>
        <div className="pk-bill-main"><strong>{b.name}{b.installmentTotal?` (${b.installmentNo||0}/${b.installmentTotal})`:''}</strong><small>{b.category}{b.dueDate?' · Due '+b.dueDate:''}</small><button className="pk-mini-link" onClick={()=>openEditor(b)}>✎ Edit details</button></div>
        <div className="pk-bill-controls"><strong>{amount(b.amountCents)}</strong><select className="pk-receipt-select" aria-label={`Status for ${b.name}`} value={b.status} onChange={e=>changeBillStatus(b.id,e.target.value as PaymentStatus)}>
          <option value="unallocated">Not allocated</option><option value="reserved">Reserved</option><option value="paid">Paid</option>
        </select>{selectAccount(b.accountId||'',id=>changeBillAccount(b.id,id),'Payment account')}</div>
      </div>)}
      <div className="pk-rline pk-rbold"><span>MONTHLY TOTAL</span><strong>{amount(target)}</strong></div>
    </div>
    <p className="pk-small-note">Payment status and money source are separate: assigning monthly funding does not create income. An individual reservation draws from that month's funding envelope when applicable. Instalment counters in the demonstration data are illustrative—check your provider statements.</p></div></details>
  </>);
  const pageAccounts=()=>(<>
    {sectionHeading('My accounts & Tabung','Manage your D1 bank accounts, savings pots and transfers.')}
    <D1AccountsPreview refreshKey={d1Refresh} />
    <details className="pk-card pk-f-legacy">
      <summary>Show legacy browser-demo account cards (not reliable for D1 totals)</summary>
      <p>This older display merges browser sample accounts with D1 account snapshots. Its combined totals are not authoritative. Use the D1 account panel above or the unified Overview for accurate D1 cash, reserved and available balances.</p>
    <div className="pk-statgrid">{metric('Cash total',amount(cash),'All known accounts')}{metric('Reserved',amount(reserved),'After avoiding double-counting')}{metric('Free cash',amount(cash-reserved),'After reservations')}{metric('Money locations',String(data.accounts.length),'Accounts and savings pots')}</div>
    <p className="pk-small-note">The four original bank/Tabung cards are sample browser data. D1 account starting amounts in these cards are their current D1 ledger balances; D1 transfers and D1 income confirmations persist; the new D1 Monthly Planner now supports D1 reservations and paid expenses. Other demonstration views remain browser-only. Do not enter real accounts or payments until we finish migration and secure login.</p>
    <div className="pk-account-grid">{data.accounts.map(a=><div className="pk-bank" key={a.id} style={{background:a.color}}><div className="pk-row"><span>{a.bank}</span><span>{a.protected?'♧ Protected':'◈ Bank account'}</span></div><div><strong>{amount(cashBalance(data,a.id))}</strong><div>{a.name}</div><small>{a.id.startsWith('d1-') ? 'D1 reserved and available: see database account panel above' : `Demo reserved ${amount(reservedBalance(data,a.id))} · available ${amount(freeBalance(data,a.id))}`}</small></div></div>)}</div>
    </details>
    <div className="pk-cols"><section className="pk-card"><h2>Add an account or Tabung — local D1</h2><p className="pk-muted">Saved to D1 and immediately shared with Money Sources. Transfers and confirmed income are saved in D1; D1 monthly bills now reserve and pay from D1; other demo modules remain browser-only.</p><form onSubmit={addAccount} className="pk-form pk-two"><label>Name<input className="pk-input" name="name" placeholder="BIMB" required/></label><label>Bank<input className="pk-input" name="bank" placeholder="Bank Islam" required/></label><label>Starting cash (RM)<input className="pk-input" type="number" min="0" step=".01" name="opening" defaultValue="0" required/></label><label>Account type<select className="pk-input" name="accountType"><option value="bank">Bank</option><option value="tabung">Tabung / savings pot</option></select></label><label>Protection<select className="pk-input" name="protected"><option value="no">Normal</option><option value="yes">Protected savings</option></select></label><button className="pk-btn pk-primary" type="submit" disabled={savingAccount}>{savingAccount ? "Saving to D1…" : "+ Save to D1"}</button></form></section>
    <section className="pk-card"><h2>Transfer between D1 accounts</h2><p className="pk-muted">This form saves transfers to your local D1 ledger. Only accounts already created in D1 are shown.</p>
    <form onSubmit={transfer} className="pk-form pk-two">
      <label>From<select className="pk-input" name="from" required defaultValue={data.accounts.find(a=>a.id.startsWith('d1-'))?.id||''}>
        {data.accounts.filter(a=>a.id.startsWith('d1-')).map(a=><option key={a.id} value={a.id}>{a.name}{a.protected?' · Protected':''}</option>)}
      </select></label>
      <label>To<select className="pk-input" name="to" required defaultValue={data.accounts.filter(a=>a.id.startsWith('d1-'))[1]?.id||''}>
        {data.accounts.filter(a=>a.id.startsWith('d1-')).map(a=><option key={a.id} value={a.id}>{a.name}{a.protected?' · Protected':''}</option>)}
      </select></label>
      <label>Amount (RM)<input className="pk-input" name="amount" type="number" min=".01" step=".01" required/></label>
      <label>Optional note<input className="pk-input" name="note" maxLength={200} placeholder="D1 transfer test"/></label>
      <button className="pk-btn pk-primary" type="submit" disabled={savingTransfer || data.accounts.filter(a=>a.id.startsWith('d1-')).length<2}>{savingTransfer?'Saving transfer…':'Record transfer in D1'}</button>
    </form><p className="pk-muted">Transfers do not increase total cash. D1 reservations are protected by the backend; browser-only demonstration reservations are not synced. Use fictional test amounts.</p></section></div>
  </>);
  const pageFunding = ()=>(<>
    {sectionHeading('Money sources','See each bank contribution by month, without mixing in the old browser-only demo.')}
    <D1FinancialOverview key={month} mode="funding" monthIndex={month}
      onOpenMonthly={()=>setTab('monthly')} onOpenAccounts={()=>setTab('accounts')}/>
    <details className="pk-card pk-f-legacy">
      <summary>Show original browser-only funding records (read-only)</summary>
      <p>These old sample records are NOT D1 reservations or payments. They are kept for reference only; create new funding assignments from the Monthly Plan instead.</p>
      {data.funding.filter(f=>f.month===month).length===0 ? <p>No browser-only funding entries for this month.</p> :
        data.funding.filter(f=>f.month===month).map(f=><div className="pk-simple-row" key={f.id}>
          <span>{accountName(f.accountId)}</span><strong>{amount(f.amountCents)}</strong>
        </div>)}
    </details>
  </>);
  const pageIncome=()=>(<>
    {sectionHeading('Money coming in','Plan expected income by month, then confirm receipt to the correct D1 account.')}
    <p className="pk-small-note"><b>Expected income.</b> A forecast is not cash until you confirm receipt. Changing an estimate never credits a bank account.</p>
    <section className="pk-card">
      <h2>+ New expected income</h2>
      <p className="pk-muted">Add a forecast, family contribution or another incoming payment. It will not credit an account until you separately mark it Received.</p>
      <form className="pk-form pk-two" onSubmit={e=>void addExpectedIncome(e)}>
        <label>Income source<input name="source" className="pk-input" required maxLength={100} placeholder="e.g. Demo Part-time Income" /></label>
        <label>Type<select name="income_type" className="pk-input" defaultValue="other">
          <option value="other">Other income</option>
          <option value="family">Family contribution</option>
          <option value="refund">Refund</option>
          <option value="mara">Allowance</option>
        </select></label>
        <label>Planning month
          <select name="period" className="pk-input" required defaultValue="2026-11">
            {monthNames.map((label, index) => {
              const monthOffset = 9 + index; // October 2026 is index zero
              const year = 2026 + Math.floor(monthOffset / 12);
              const monthNumber = (monthOffset % 12) + 1;
              const value = `${year}-${String(monthNumber).padStart(2, '0')}`;
              return <option key={value} value={value}>{label}</option>;
            })}
          </select>
        </label>
        <label>Expected amount (RM)<input name="expected_amount" className="pk-input" type="number" step=".01" min="0" placeholder="Leave blank if unknown"/></label>
        <label>Estimated receipt date (optional)<input name="expected_date" className="pk-input" type="date"/></label>
        <div style={{display:'flex',alignItems:'end'}}><button className="pk-btn pk-primary" type="submit" disabled={creatingExpectedIncome||loadingIncome}>
          {creatingExpectedIncome?'Saving to D1…':'+ Save expected income'}
        </button></div>
      </form>
      <p className="pk-small-note">This creates only an expected-income record. Your actual and available balances are unchanged. Avoid entering the same expected payment twice.</p>
    </section>
    <section className="pk-card">
      <div className="pk-row"><h2>Income timeline</h2><button className="pk-btn" type="button" onClick={()=>{setLoadingIncome(true);setIncomeError('');setIncomeRefresh(v=>v+1)}} disabled={loadingIncome}>↻ Refresh</button></div>
      <div className="pk-toolbar" style={{gap:12,flexWrap:'wrap'}}>
        <div className="pk-select-wrap"><label htmlFor="pk-income-month">Month</label>
          <select id="pk-income-month" className="pk-input" value={incomeMonthFilter} onChange={e=>setIncomeMonthFilter(e.target.value)}>
            <option value="all">All months</option>
            {incomeMonthOptions.map(m=><option key={m} value={m}>{m==='unscheduled'?'Unscheduled':m}</option>)}
          </select>
        </div>
        <div className="pk-select-wrap"><label htmlFor="pk-income-status">Status</label>
          <select id="pk-income-status" className="pk-input" value={incomeStatusFilter} onChange={e=>setIncomeStatusFilter(e.target.value as 'all'|'expected'|'received')}>
            <option value="all">All statuses</option><option value="expected">Expected</option><option value="received">Received</option>
          </select>
        </div>
      </div>
      <div className="pk-statgrid" style={{marginTop:12}}>
        {metric('Still expected',amount(incomeExpectedTotal),'Forecast only')}
        {metric('Already received',amount(incomeReceivedTotal),'Credited to D1 accounts')}
        {metric('Matching entries',String(visibleIncome.length),'Current filters')}
      </div>
      {loadingIncome && <p className="pk-muted">Loading income from local D1…</p>}
      {incomeError && <p role="alert" className="pk-red">Cannot load D1 income: {incomeError}</p>}
      {!loadingIncome && !incomeError && visibleIncome.length===0 && <p className="pk-muted">No income matching these filters.</p>}
      {!incomeError && visibleIncome.map(receipt => {
        const received=receipt.ledger_entry_id!==null;
        const candidates=data.accounts.filter(a=>a.id.startsWith('d1-'));
        const editOpen=editingExpectedKey===receipt.income_key;
        return <div key={receipt.income_key} className="pk-income-row" style={{display:'block'}}>
          <div className="pk-row" style={{alignItems:'start',marginBottom:8}}>
            <div><b>{receipt.source_name}</b><small>{receipt.period||'Unscheduled'} · {receipt.expected_date||'No expected date'} · {receipt.income_key}</small></div>
            <span className={'pk-tag '+(received?'pk-done':'')}>{received?'✓ Received':'Expected'}</span>
          </div>
          {received ? <div className="pk-simple-row">
            <span><b className="pk-green">+{amount(receipt.received_amount_sen||0)}</b><small>Into: {receipt.receiving_account_name||`Account #${receipt.receiving_account_id}`}</small></span>
            <span className="pk-muted">Recorded in D1</span>
          </div> : <>
            <div className="pk-simple-row" style={{marginBottom:8}}>
              <span>Planned amount</span><b>{receipt.expected_amount_sen===null?'Not set':amount(receipt.expected_amount_sen)}</b>
            </div>
            <div className="pk-row" style={{justifyContent:'flex-start',marginBottom:10}}>
              <button type="button" className="pk-btn" onClick={()=>setEditingExpectedKey(editOpen?null:receipt.income_key)} disabled={savingExpectedKey!==null||confirmingIncome!==null}>
                {editOpen?'Cancel estimate edit':'✎ Edit estimate'}
              </button>
            </div>
            {editOpen ? <form className="pk-form pk-two" onSubmit={e=>void saveExpectedIncome(e,receipt)}>
              <label>Expected amount (RM)<input className="pk-input" type="number" name="expected_amount" min="0" step="0.01" required defaultValue={receipt.expected_amount_sen===null?'0.00':fromCents(receipt.expected_amount_sen)}/></label>
              <label>Expected date<input className="pk-input" type="date" name="expected_date" defaultValue={receipt.expected_date||''}/></label>
              <button type="submit" className="pk-btn pk-primary" disabled={savingExpectedKey!==null}>
                {savingExpectedKey===receipt.income_key?'Saving…':'Save expected amount and date'}
              </button>
              <p className="pk-muted">Only forecast details change. This does not add money to an account.</p>
            </form> : <form className="pk-form pk-two" onSubmit={e=>void confirmExpectedIncome(e,receipt)}>
              <label>Actual received amount (RM)<input className="pk-input" type="number" name="amount" min="0.01" step="0.01" required defaultValue={receipt.expected_amount_sen!==null?fromCents(receipt.expected_amount_sen):''}/></label>
              <label>Received into<select className="pk-input" name="account" required defaultValue={candidates[0]?.id||''}>
                {candidates.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </select></label>
              <button type="submit" className="pk-btn pk-primary" disabled={confirmingIncome!==null||savingExpectedKey!==null||candidates.length===0}>
                {confirmingIncome===receipt.income_key?'Confirming in D1…':'✓ Mark received in D1'}
              </button>
            </form>}
          </>}
        </div>;
      })}
    </section>
    <section className="pk-card">
      <h2>What these statuses mean</h2>
      <div className="pk-simple-row"><span>Expected</span><b>No bank change</b></div>
      <div className="pk-simple-row"><span>Edit estimate</span><b>Changes forecast only</b></div>
      <div className="pk-simple-row"><span>Received</span><b>Credits selected D1 bank once</b></div>
      <p className="pk-small-note">This application is still a local testing prototype. Old browser-only demonstration data remains separate from D1. Do not enter real financial information or deploy publicly before authentication.</p>
    </section>
    {data.income.length>0 && <section className="pk-card"><h2>Older browser-only demo receipts</h2>
      <p className="pk-muted">Separate test entries saved in your browser, not D1 income. Shown read-only.</p>
      {data.income.map(x=><div className="pk-simple-row" key={x.id}><span>{x.name}<small>{accountName(x.accountId)}</small></span><b>{amount(x.amountCents)}</b></div>)}
    </section>}
  </>);
  const pageSettlements=()=>(<>
    {sectionHeading('Settlements & debt tracking','Outstanding balances and repayments saved in local D1.')}
    <D1Debts />
    <details className="pk-card pk-f-legacy">
      <summary>Show original browser-only settlement estimates (not D1)</summary>
      <p>This older provisional list is separate from the debt tracker above. These figures are not automatically imported or linked to your real bank ledger. Do not treat demo Paid statuses as real payments.</p>
      {data.settlements.map(s=><div className="pk-simple-row" key={s.id}><span>{s.name}</span><strong>{amount(s.amountCents)}</strong></div>)}
      <p className="pk-small-note">Confirm your provider's final settlement quote before making any actual payment.</p>
    </details>
  </>);
  const pageShared=()=>(<>
    {sectionHeading('Shared payments','Subscription contributions from friends and family, saved separately in local D1.')}
    <D1SharedPayments monthIndex={month}/>
    <details className="pk-card pk-f-legacy"><summary>Old browser-only shared payment examples</summary>
      <p>These are separate examples, not imported into D1. Do not add them to collected totals.</p>
      {data.shared.map(s=><div key={s.id} className="pk-simple-row"><span>{s.name} · {s.month}</span><b>{s.members.length} members</b></div>)}
    </details>
  </>);
  const pageMother=()=>(<>
    {sectionHeading("Mother's reminders",'Monthly and yearly checklists, independent of your PocketKu bank accounts.')}
    <D1FamilyReminders key={month} monthIndex={month}/>
    <details className="pk-card pk-f-legacy"><summary>Old browser-only reminder examples</summary>
      <p>Separate demonstration records. They have not been copied to D1.</p>
      {data.reminders.map(r=><div className="pk-simple-row" key={r.id}><span>{r.name} · {r.date}</span><b>{amount(r.amountCents)}</b></div>)}
    </details>
  </>);
  const pageScenario=()=>(<>
    {sectionHeading('Scenarios','Planning simulations will use your private D1 records in a future update.')}
    <section className="pk-card"><h2>No public sample figures</h2>
      <p>Personal financial assumptions have been removed from the source code to keep the repository safe to publish.</p>
      <p>Your existing income, commitments and funding records remain in the local D1 database.</p>
    </section>
  </>);

  return <div id="pocketku-app" className={theme}>
    <div className="pk-layout"><aside className="pk-sidebar"><div className="pk-brand"><div className="pk-brand-icon">◈</div><div><b>Pocket<span>Ku.</span></b><small>Your money. Your plan.</small></div></div><div className="pk-nav-label">WORKSPACE</div>
      <nav aria-label="PocketKu navigation">{tabs.map(([id,label,icon])=><button className={'pk-nav-item '+(tab===id?'selected':'')} key={id} onClick={()=>{setTab(id);setEditing(null);setNotice('')}}><span className="pk-nav-icon">{icon}</span><span>{label}</span></button>)}</nav>
      <div className="pk-sidebar-footer"><span className="pk-demo-dot"/>Private workspace<br/><small>Login protected</small></div>
    </aside><div className="pk-body"><header className="pk-top"><div><span className="pk-top-small">POCKETKU / PERSONAL FINANCE</span><strong>{tabs.find(x=>x[0]===tab)?.[1]}</strong></div><div className="pk-top-actions"><span className="pk-top-tag">● Private session</span><button className="pk-btn" onClick={async()=>{try{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'})}finally{window.location.reload()}}}>Sign out</button><button className="pk-btn" onClick={()=>setTheme(theme==='light'?'dark':'light')}>{theme==='light'?'☾ Dark mode':'☀ Light mode'}</button></div></header>
      <main className="pk-main"><div className="pk-warning"><b>Private PocketKu workspace.</b> Your financial records are stored in D1; older browser-only examples are not included in D1 totals. Login is enabled, but security testing and deployment preparation are still required before handling real financial records.</div>
        {notice&&<div className="pk-notice" role="status"><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Dismiss notification">×</button></div>}
        {(tab==='overview'||tab==='monthly'||tab==='funding'||tab==='shared'||tab==='mother')&&<div className="pk-f-monthpicker">
          <label htmlFor="pk-d1-main-month">{tab==='shared'||tab==='mother'?'View month':'Allocation month'}
            <select id="pk-d1-main-month" className="pk-input" value={month}
              onChange={e=>{setMonth(Number(e.target.value));setEditing(null)}}>
              {monthNames.map((label,i)=><option value={i} key={label}>{label}</option>)}
            </select>
          </label>
          <span>{tab==='shared'?'New collections use this month. You can also select any previously saved collection.':tab==='mother'?'Show reminders due in this month. Each recurring due date has its own Paid status.':'Choose a month to see its commitments and funding. Cash and reserved balances always reflect all months.'}</span>
        </div>}
        {tab==='overview'&&pageOverview()}{tab==='monthly'&&pageMonthly()}{tab==='accounts'&&pageAccounts()}{tab==='funding'&&pageFunding()}{tab==='income'&&pageIncome()}{tab==='settlements'&&pageSettlements()}{tab==='shared'&&pageShared()}{tab==='mother'&&pageMother()}{tab==='scenario'&&pageScenario()}{tab==='safety'&&<D1DataSafety/>}
        <footer className="pk-footer"><span>POCKETKU · A DEKALATHON PROJECT</span><div><button className="pk-link" onClick={exportDemo}>Export browser demo JSON (not D1)</button><button className="pk-link" onClick={()=>{if(window.confirm('Reset PocketKu to its original demo data? This clears all demo edits saved in this browser.')){setData(createDemoData());setNotice('Demo reset.')}}}>Reset demo</button></div></footer>
      </main></div></div>
    {editing!==null&&<div className="pk-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditing(null)}}><div className="pk-modal" role="dialog" aria-modal="true" aria-label={editing==='new'?'Add commitment':'Edit commitment'}><div className="pk-row"><h2>{editing==='new'?'New commitment':'Edit allocation details'}</h2><button className="pk-btn" onClick={()=>setEditing(null)} aria-label="Close editor">×</button></div>
      <form className="pk-form" onSubmit={saveEditor}><div className="pk-two"><label>Name<input className="pk-input" required value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label>Amount (RM)<input className="pk-input" required type="number" min="0" step=".01" value={draft.amount} onChange={e=>setDraft({...draft,amount:e.target.value})}/></label><label>Category<select className="pk-input" value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value})}>{['Bill','Subscription','Financing','Personal repayment','SPayLater','Mobile','Other'].map(x=><option key={x}>{x}</option>)}</select></label><label>Actual due date (optional)<input className="pk-input" type="date" value={draft.dueDate} onChange={e=>setDraft({...draft,dueDate:e.target.value})}/></label><label>Current instalment<input className="pk-input" type="number" min="0" value={draft.seq} onChange={e=>setDraft({...draft,seq:e.target.value})}/></label><label>Total instalments<input className="pk-input" type="number" min="0" value={draft.total} onChange={e=>setDraft({...draft,total:e.target.value})}/></label></div>
      {editing==='new'?<><label className="pk-check"><input type="checkbox" checked={draft.repeat} onChange={e=>setDraft({...draft,repeat:e.target.checked})}/>Repeat each allocation month</label>{draft.repeat&&<label>Repeat until<select className="pk-input" value={draft.endMonth} onChange={e=>setDraft({...draft,endMonth:Number(e.target.value)})}>{monthNames.slice(month).map((m,i)=><option key={m} value={i+month}>{m}</option>)}</select></label>}</>:<label>Apply changes to<select className="pk-input" value={draft.scope} onChange={e=>setDraft({...draft,scope:e.target.value})}><option value="one">Only this month (safer)</option><option value="future">This and later instalments in same series</option></select></label>}
      <div className="pk-modal-actions"><button type="button" className="pk-btn" onClick={()=>setEditing(null)}>Cancel</button><button type="submit" className="pk-btn pk-primary">Save changes</button></div></form>
    </div></div>}
  </div>;
}


export default function App() {
  return <PocketKuAuthGate><PocketKuDashboard /></PocketKuAuthGate>;
}
