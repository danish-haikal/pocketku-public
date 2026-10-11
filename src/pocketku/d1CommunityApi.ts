/** No bank or account-ledger writes: these are independent personal checklists. */
export type D1SharedCollection={id:number;name:string;period:string;created_at:string};
export type D1SharedMember={id:number;collection_id:number;member_name:string;share_sen:number;is_self:number;received:number;received_at:string|null};
export type FamilyReminder={id:number;name:string;amount_sen:number;first_due_date:string;frequency:'one-time'|'monthly'|'yearly';note:string;is_active:number};
export type FamilyOccurrence=FamilyReminder&{due_date:string;paid:number};
const stringify=(data:unknown)=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
async function call<T>(url:string,opts?:RequestInit):Promise<T>{
  const res=await fetch(url,{cache:'no-store',...opts});
  let j:Record<string,unknown>;
  try{j=await res.json() as Record<string,unknown>}catch{throw new Error('PocketKu API is unavailable. Check npm run dev.');}
  if(!res.ok||j.success!==true)throw new Error(typeof j.error==='string'?j.error:'Unable to save this change.');
  return j as T;
}
export const communityKey=()=>crypto.randomUUID();
export const moneySen=(x:string)=>{const value=x.trim();if(!/^\d{1,11}(\.\d{1,2})?$/.test(value))return null;const [whole,cents='']=value.split('.');const n=Number(whole)*100+Number(cents.padEnd(2,'0'));return Number.isSafeInteger(n)?n:null;};
export const ringgit=(sen:number)=>'RM '+(sen/100).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
export const monthFromIndex=(index:number)=>{const d=new Date(Date.UTC(2026,9+index,1));return d.toISOString().slice(0,7);};
export const nextMonth=(period:string)=>{const d=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),1));return d.toISOString().slice(0,7);};
export const prettyMonth=(period:string)=>{const [y,m]=period.split('-').map(Number);return new Date(Date.UTC(y,m-1,1)).toLocaleDateString('en-MY',{month:'short',year:'numeric',timeZone:'UTC'});};
export function getCollections(){return call<{collections:D1SharedCollection[];members:D1SharedMember[]}>('/api/shared-collections');}
export function newCollection(creation_key:string,name:string,period:string){return call('/api/shared-collections',{method:'POST',...stringify({creation_key,name,period})});}
export function nextCollection(id:number,creation_key:string,period:string){return call('/api/shared-collections/'+id+'/carry',{method:'POST',...stringify({creation_key,period})});}
export function addMember(id:number,member_name:string,share_sen:number,is_self:boolean){return call('/api/shared-collections/'+id+'/members',{method:'POST',...stringify({member_name,share_sen,is_self})});}
export function patchMember(id:number,body:{member_name?:string;share_sen?:number;received?:boolean}){return call('/api/shared-collections/members/'+id,{method:'PATCH',...stringify(body)});}
export function deleteMember(id:number){return call('/api/shared-collections/members/'+id,{method:'DELETE'});}
export function getFamilyMonth(period:string){return call<{reminders:FamilyReminder[];occurrences:FamilyOccurrence[]}>('/api/family-reminders?month='+encodeURIComponent(period));}
export function newFamily(body:{creation_key:string;name:string;amount_sen:number;first_due_date:string;frequency:string;note:string}){return call('/api/family-reminders',{method:'POST',...stringify(body)});}
export function setFamilyCheck(id:number,due_date:string,paid:boolean){return call('/api/family-reminders/'+id+'/check',{method:'POST',...stringify({due_date,paid})});}
export function patchFamily(id:number,body:{name:string;amount_sen:number;note:string}){return call('/api/family-reminders/'+id,{method:'PATCH',...stringify(body)});}
export function archiveFamily(id:number){return call('/api/family-reminders/'+id,{method:'DELETE'});}
