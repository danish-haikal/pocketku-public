export interface PersonalSubscription {
  id:number;create_key:string;name:string;provider:string;
  status:'trial'|'active'|'cancelled';renewal_amount_sen:number;
  next_charge_date:string;cancel_by_date:string|null;
  billing_cycle:'monthly'|'quarterly'|'half_yearly'|'yearly'|'one_time';
  note:string;created_at:string;updated_at:string;
}
export type PersonalSubscriptionDraft=Pick<PersonalSubscription,'name'|'provider'|'status'|'renewal_amount_sen'|'next_charge_date'|'cancel_by_date'|'billing_cycle'|'note'>;
async function api(path:string,init?:RequestInit):Promise<Record<string,unknown>>{
  const response=await fetch(path,{cache:'no-store',...init});
  let data:Record<string,unknown>;
  try{data=await response.json() as Record<string,unknown>}catch{throw new Error('Could not read subscription data.');}
  if(!response.ok||data.success!==true)throw new Error(typeof data.error==='string'?data.error:'Subscription request failed.');
  return data;
}
const json=(body:unknown)=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export async function getPersonalSubscriptions():Promise<PersonalSubscription[]>{
  const data=await api('/api/personal-subscriptions');
  if(!Array.isArray(data.subscriptions))throw new Error('Unexpected subscription response.');
  return data.subscriptions as PersonalSubscription[];
}
export async function createPersonalSubscription(draft:PersonalSubscriptionDraft,key:string):Promise<void>{
  await api('/api/personal-subscriptions',{method:'POST',...json({...draft,create_key:key})});
}
export async function updatePersonalSubscription(id:number,draft:PersonalSubscriptionDraft):Promise<void>{
  await api(`/api/personal-subscriptions/${id}`,{method:'PATCH',...json(draft)});
}
export async function archivePersonalSubscription(id:number):Promise<void>{
  await api(`/api/personal-subscriptions/${id}`,{method:'DELETE'});
}
export const rm=(sen:number)=>'RM '+(sen/100).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
export function dayDifference(date:string,reference=new Date()):number{
  const today=new Date(reference.getFullYear(),reference.getMonth(),reference.getDate());
  const [y,m,d]=date.split('-').map(Number);
  return Math.round((Date.UTC(y,m-1,d)-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/86400000);
}
/** Calendar reminders work independently of PocketKu when an imported calendar supports VALARM. */
export function downloadTrialCalendar(item:PersonalSubscription):void{
  const date=item.cancel_by_date||item.next_charge_date;
  const scheduled=new Date(`${date}T12:00:00`);
  const stamp=(d:Date)=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const escape=(str:string)=>str.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const summary=escape(`Review / cancel ${item.name} before renewal`);
  const body=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//PocketKu//Subscription Reminder//EN','BEGIN:VEVENT',
    `UID:pocketku-subscription-${item.id}-${date}@pocketku.local`,`DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(scheduled)}`,`DTEND:${stamp(new Date(scheduled.getTime()+3600000))}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${escape(`Check your ${item.name} subscription at the provider. PocketKu cannot cancel it for you.`)}`,
    ...[7,3,1].flatMap(days=>['BEGIN:VALARM',`TRIGGER:-P${days}D`,'ACTION:DISPLAY',`DESCRIPTION:${summary}`,'END:VALARM']),
    'END:VEVENT','END:VCALENDAR'].join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([body],{type:'text/calendar;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`pocketku-reminder-${item.id}.ics`;
  document.body.appendChild(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
