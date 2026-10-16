import {useEffect,useState} from 'react';
import {dayDifference,getPersonalSubscriptions,type PersonalSubscription,rm} from './d1PersonalSubscriptionsApi';
import './d1PersonalSubscriptions.css';
/** A passive in-app notice; not a notification service or a banking transaction. */
export default function SubscriptionDueBanner({onOpen}:{onOpen:()=>void}){
  const [upcoming,setUpcoming]=useState<PersonalSubscription[]>([]);
  useEffect(()=>{let active=true;void getPersonalSubscriptions().then(rows=>{
    if(active)setUpcoming(rows.filter(x=>x.status!=='cancelled'&&dayDifference(x.cancel_by_date||x.next_charge_date)<=14)
      .sort((a,b)=>(a.cancel_by_date||a.next_charge_date).localeCompare(b.cancel_by_date||b.next_charge_date)));
  }).catch(()=>{/* Overview remains usable when reminders are unavailable. */});return()=>{active=false}},[]);
  if(!upcoming.length)return null;
  return <section className="pk-sub-alert pk-sub-warning" aria-label="Upcoming subscription deadlines" style={{marginBottom:14}}>
    <h3>Upcoming subscription deadlines</h3>
    {upcoming.slice(0,3).map(item=><div key={item.id}><b>{item.name}</b> — {dayDifference(item.cancel_by_date||item.next_charge_date)<=0?'Check now':`${dayDifference(item.cancel_by_date||item.next_charge_date)} days left`} · {rm(item.renewal_amount_sen)} possible charge</div>)}
    <button className="pk-btn" style={{marginTop:8}} onClick={onOpen}>Review My Subscriptions →</button>
  </section>;
}
