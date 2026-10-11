import {useEffect,useState} from 'react';
import './d1DataSafety.css';

type SafetyReport={success:boolean;counts:Record<string,number>;checks:{id:string;title:string;detail:string;issues:number}[];checkedAt:string};
const metrics:[string,string][]=[
  ['accounts','Bank / Tabung accounts'],['ledgerEntries','Bank ledger entries'],
  ['incomeRecords','Income records'],['commitments','Monthly commitments'],
  ['debts','Debts'],['sharedCollections','Shared collections'],['familyReminders','Family reminders']
];

export default function D1DataSafety(){
  const [report,setReport]=useState<SafetyReport|null>(null);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let alive=true;
    void fetch('/api/safety/checks',{cache:'no-store'}).then(async response=>{
      const result:SafetyReport&{error?:string}=await response.json();
      if(!response.ok||!result.success)throw new Error(result.error||'Data checks are unavailable.');
      return result;
    }).then(result=>{if(alive){setReport(result);setError('')}}).catch(err=>{
      if(alive){setError(err instanceof Error?err.message:String(err));setReport(null)}
    }).finally(()=>{if(alive)setBusy(false)});
    return()=>{alive=false};
  },[refresh]);
  const issues=report?.checks.reduce((sum,c)=>sum+c.issues,0)??0;
  return <div className="pk-safe">
    <header className="pk-safe-head"><div><h1>Data & safety</h1>
      <p>Review local D1 records, check for common inconsistencies, and back up your test database.</p></div>
      <button className="pk-btn" disabled={busy} onClick={()=>{setBusy(true);setError('');setRefresh(x=>x+1)}}>↻ Run checks</button></header>
    <section className="pk-safe-card">
      <div className="pk-safe-section"><h2>1. Financial consistency checks</h2>
        <p>Read-only checks. They never edit or move money.</p></div>
      {busy&&<p role="status">Checking local D1…</p>}
      {error&&<p className="pk-safe-error" role="alert">{error}</p>}
      {report&&!busy&&<>
        <div className={'pk-safe-banner '+(issues?'pk-safe-warn':'pk-safe-ok')}>
          <b>{issues===0?'✓ No issues found in these checks':`⚠ ${issues} potential issue${issues===1?'':'s'} found`}</b>
          <span>{issues===0?'These checks passed. This is not a complete financial audit.':'Review the affected items before trusting the balances.'}</span>
        </div>
        <div className="pk-safe-checks">{report.checks.map(check=><div key={check.id} className="pk-safe-check">
          <div><strong>{check.title}</strong><p>{check.detail}</p></div>
          <span className={check.issues?'pk-safe-bad':'pk-safe-good'}>{check.issues?`${check.issues} issue(s)`:'✓ Pass'}</span>
        </div>)}</div>
        <small>Last checked: {new Date(report.checkedAt).toLocaleString()}</small>
      </>}
    </section>
    <section className="pk-safe-card"><h2>2. Local D1 record counts</h2>
      <p>These counts include fictional test records and are not your actual financial balances.</p>
      {report?<div className="pk-safe-metrics">{metrics.map(([key,title])=><div key={key}><span>{title}</span><b>{(report.counts[key]??0).toLocaleString()}</b></div>)}</div>:<p>Run checks to see the counts.</p>}
    </section>
    <section className="pk-safe-card"><h2>3. Back up your D1 database</h2>
      <p>In your <strong>PocketKu VS Code terminal</strong>, run the included PowerShell script:</p>
      <pre className="pk-safe-command"><code>powershell -ExecutionPolicy Bypass -File .\tools\backup-local.ps1</code></pre>
      <p>It saves a dated <strong>.sql backup</strong> into a separate <code>PocketKu-Backups</code> folder beside your project. This includes your local D1 schema and data.</p>
      <p className="pk-safe-caution"><b>Keep backup files private.</b> They contain account names and financial records. Do not commit them to GitHub, and do not use <em>Export browser demo JSON</em> as your D1 backup.</p>
    </section>
    <section className="pk-safe-card"><h2>4. Before public deployment</h2>
      <ul><li>Secure sign-in and per-user access controls.</li>
        <li>Restore procedure tested with a separate copy of the database.</li>
        <li>End-to-end tests for transfers, reservations, repayments and recurring bills.</li>
        <li>Remove or fully isolate browser-only sample sections.</li>
        <li>Confirm Shared Payments and Family Reminders tests from Step 7.21.</li></ul>
      <p className="pk-safe-caution"><b>Prototype only:</b> Do not deploy the current Worker publicly or enter real financial records yet.</p>
    </section>
  </div>;
}
