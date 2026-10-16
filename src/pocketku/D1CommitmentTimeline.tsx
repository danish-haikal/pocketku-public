import {useEffect,useState} from 'react';
import {getCommitmentTimeline,type TimelineMonth} from './d1TimelineApi';
import './d1Timeline.css';
const money=(sen:number)=>'RM '+(sen/100).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
const label=(s:string)=>new Date(s+'-01T00:00:00Z').toLocaleDateString('en-MY',{month:'long',year:'numeric',timeZone:'UTC'});
export default function D1CommitmentTimeline({onOpenMonth}:{onOpenMonth:(period:string)=>void}){
 const [rows,setRows]=useState<TimelineMonth[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{let live=true;void getCommitmentTimeline().then(data=>{if(live){setRows(data);setError('')}}).catch(e=>{if(live)setError(String(e))}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[refresh]);
 const max=Math.max(0,...rows.map(r=>r.planned_sen));
 return <section className="pk-timeline">
  <div className="pk-timeline-head"><div><h2>Commitment Timeline</h2><p>All saved allocation months, through your last scheduled commitment.</p></div><button type="button" className="pk-btn" onClick={()=>{setLoading(true);setRefresh(n=>n+1)}}>↻ Refresh</button></div>
  {error&&<p role="alert" className="pk-red">{error}</p>}
  {loading?<p>Loading monthly totals…</p>:rows.length===0?<p>No commitments yet. Create your first commitment in Monthly Plan.</p>:<>
    <div className="pk-timeline-overview"><div><small>Scheduled months</small><strong>{rows.length}</strong></div><div><small>Total planned</small><strong>{money(rows.reduce((v,r)=>v+r.planned_sen,0))}</strong></div><div><small>Last scheduled month</small><strong>{label(rows[rows.length-1].period)}</strong></div></div>
    <div className="pk-timeline-list">{rows.map(r=><button key={r.period} type="button" className="pk-timeline-item" onClick={()=>onOpenMonth(r.period)}>
      <div className="pk-timeline-main"><strong>{label(r.period)}</strong><small>{r.count} commitment{r.count===1?'':'s'} · Paid {money(r.paid_sen)} · Reserved {money(r.reserved_sen)}</small></div>
      <div className="pk-timeline-right"><strong>{money(r.planned_sen)}</strong><span aria-hidden="true">→</span></div>
      <div className="pk-timeline-bar"><div style={{width:`${max?100*r.planned_sen/max:0}%`}}/></div>
    </button>)}</div>
    <p className="pk-muted">Only saved commitments are included. Open-ended recurring bills need future occurrences added to appear beyond their current schedule.</p>
  </>}
 </section>;
}
