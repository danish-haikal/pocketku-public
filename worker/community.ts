/** Shared collections + family bill reminders. Planning/checklists only; no account_ledger writes. */
interface Env { DB:D1Database }
const bad=(message:string,status=400)=>Response.json({success:false,error:message},{status});
const good=(value:Record<string,unknown>={})=>Response.json({success:true,...value});
const err=(e:unknown)=>e instanceof Error?e.message:String(e);
const money=(n:unknown,allowZero=false):n is number => typeof n==='number'&&Number.isSafeInteger(n)&&
  n>=(allowZero?0:1)&&n<=100000000000;
const nameOk=(x:unknown,max=120):x is string=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=max;
const keyOk=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9:_-]{8,100}$/.test(x);
const periodOk=(x:unknown):x is string=>typeof x==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(x)&&x>='2000-01'&&x<='2100-12';
const dateOk=(x:unknown):x is string=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&
  !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const parseJson=async(request:Request):Promise<Record<string,unknown>|null>=>{
  try { const x:unknown=await request.json();return x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:null;}
  catch{return null;}
};
const limitedError=(error:unknown,context:string)=>{console.error('PocketKu community: '+context,error);const s=err(error);
  if(s.includes('UNIQUE constraint'))return bad('This record already exists. Refresh the page.',409);
  if(s.includes('FOREIGN KEY constraint'))return bad('This record no longer exists. Refresh.',409);
  return bad('Unable to '+context+'. Please refresh and try again.',500);
};
export function occurrence(first:string,freq:string,month:string):string|null {
  const firstMonth=first.slice(0,7);
  if(month<firstMonth)return null;
  if(freq==='one-time')return month===firstMonth?first:null;
  if(freq==='yearly'&&month.slice(5,7)!==first.slice(5,7))return null;
  const [year,mon]=month.split('-').map(Number);
  const lastDay=new Date(Date.UTC(year,mon,0)).getUTCDate();
  const day=Math.min(Number(first.slice(8,10)),lastDay);
  return month+'-'+String(day).padStart(2,'0');
}
export async function communityRoute(request:Request,env:Env,url:URL):Promise<Response|null>{
  const path=url.pathname;
  if(!path.startsWith('/api/shared-collections')&&!path.startsWith('/api/family-reminders'))return null;
  if(path==='/api/shared-collections'&&request.method==='GET'){
    try{
      const collections=await env.DB.prepare('SELECT id,name,period,created_at FROM shared_collections ORDER BY period DESC,id DESC LIMIT 200').all();
      const members=await env.DB.prepare('SELECT id,collection_id,member_name,share_sen,is_self,received,received_at FROM shared_members ORDER BY id LIMIT 10000').all();
      return good({collections:collections.results,members:members.results});
    }catch(e){return limitedError(e,'load shared collections')}
  }
  if(path==='/api/shared-collections'&&request.method==='POST'){
    const d=await parseJson(request);if(!d||!keyOk(d.creation_key)||!nameOk(d.name)||!periodOk(d.period))return bad('Enter a collection name and valid month.');
    try{
      const existing=await env.DB.prepare('SELECT id FROM shared_collections WHERE creation_key=?').bind(d.creation_key).first<{id:number}>();
      if(existing)return good({id:existing.id,already_created:true});
      await env.DB.prepare('INSERT INTO shared_collections(creation_key,name,period) VALUES(?,?,?)').bind(d.creation_key,d.name.trim(),d.period).run();
      return good();
    }catch(e){return limitedError(e,'create collection')}
  }
  const carry=path.match(/^\/api\/shared-collections\/(\d+)\/carry$/);
  if(carry&&request.method==='POST'){
    const id=Number(carry[1]),d=await parseJson(request);
    if(!d||!keyOk(d.creation_key)||!periodOk(d.period))return bad('Choose a valid target month.');
    try{
      const origin=await env.DB.prepare('SELECT id,name,period FROM shared_collections WHERE id=?').bind(id).first<{id:number;name:string;period:string}>();
      if(!origin)return bad('Collection not found.',404);
      if(d.period<=origin.period)return bad('Carry forward to a later month only.');
      const already=await env.DB.prepare('SELECT id,creation_key FROM shared_collections WHERE name=? COLLATE NOCASE AND period=?').bind(origin.name,d.period).first<{id:number;creation_key:string}>();
      if(already){if(already.creation_key===d.creation_key)return good({id:already.id,already_carried:true});
        return bad('That collection already exists in this month.',409);
      }
      const rows=await env.DB.prepare('SELECT member_name,share_sen,is_self FROM shared_members WHERE collection_id=? ORDER BY id').bind(id).all<{member_name:string;share_sen:number;is_self:number}>();
      const statements:D1PreparedStatement[]=[env.DB.prepare('INSERT INTO shared_collections(creation_key,name,period) VALUES(?,?,?)').bind(d.creation_key,origin.name,d.period)];
      // The preceding insert's ID is resolved safely within the same SQLite transaction.
      for(const m of rows.results)statements.push(env.DB.prepare(`INSERT INTO shared_members(collection_id,member_name,share_sen,is_self)
        SELECT id,?,?,? FROM shared_collections WHERE creation_key=?`).bind(m.member_name,m.share_sen,m.is_self,d.creation_key));
      await env.DB.batch(statements);
      return good({carried:rows.results.length});
    }catch(e){return limitedError(e,'carry forward collection')}
  }
  const memberCreate=path.match(/^\/api\/shared-collections\/(\d+)\/members$/);
  if(memberCreate&&request.method==='POST'){
    const d=await parseJson(request),id=Number(memberCreate[1]);
    if(!d||!nameOk(d.member_name,100)||!money(d.share_sen,true)||typeof d.is_self!=='boolean')return bad('Enter a member name and a valid amount.');
    try {
      await env.DB.prepare('INSERT INTO shared_members(collection_id,member_name,share_sen,is_self) VALUES(?,?,?,?)')
        .bind(id,d.member_name.trim(),d.share_sen,d.is_self?1:0).run();
      return good();
    }catch(e){return limitedError(e,'add collection member')}
  }
  const member=path.match(/^\/api\/shared-collections\/members\/(\d+)$/);
  if(member&&request.method==='PATCH'){
    const d=await parseJson(request),id=Number(member[1]);
    if(!d)return bad('Invalid change.');
    try{
      const old=await env.DB.prepare('SELECT * FROM shared_members WHERE id=?').bind(id)
        .first<{id:number;member_name:string;share_sen:number;is_self:number;received:number}>();
      if(!old)return bad('Member not found.',404);
      const label=d.member_name===undefined?old.member_name:d.member_name;
      const value=d.share_sen===undefined?old.share_sen:d.share_sen;
      const received=d.received===undefined?Boolean(old.received):d.received;
      if(!nameOk(label,100)||!money(value,true)||typeof received!=='boolean'||(old.is_self===1&&received))
        return bad('Invalid member changes. Your own share cannot be marked collected.');
      const paidAt=received?(old.received===1?undefined:'CURRENT_TIMESTAMP'):null;
      if(paidAt===undefined){
        await env.DB.prepare('UPDATE shared_members SET member_name=?,share_sen=?,received=? WHERE id=?')
          .bind(label.trim(),value,received?1:0,id).run();
      }else if(received){
        await env.DB.prepare('UPDATE shared_members SET member_name=?,share_sen=?,received=1,received_at=CURRENT_TIMESTAMP WHERE id=?')
          .bind(label.trim(),value,id).run();
      }else{
        await env.DB.prepare('UPDATE shared_members SET member_name=?,share_sen=?,received=0,received_at=NULL WHERE id=?')
          .bind(label.trim(),value,id).run();
      }
      return good();
    }catch(e){return limitedError(e,'update collection member')}
  }
  if(member&&request.method==='DELETE'){
    const id=Number(member[1]);
    try{const result=await env.DB.prepare('DELETE FROM shared_members WHERE id=? AND received=0').bind(id).run();
      if(!result.meta.changes)return bad('Only unpaid members can be removed.',409);
      return good();
    }catch(e){return limitedError(e,'remove collection member')}
  }

  if(path==='/api/family-reminders'&&request.method==='GET'){
    const month=url.searchParams.get('month');if(!periodOk(month))return bad('Select a valid reminder month.');
    try{
      const reminders=await env.DB.prepare('SELECT id,name,amount_sen,first_due_date,frequency,note,is_active FROM family_reminders ORDER BY first_due_date,id').all();
      const checks=await env.DB.prepare('SELECT reminder_id,due_date,is_paid,amount_sen FROM family_reminder_checks WHERE due_date BETWEEN ? AND ?')
        .bind(month+'-01',month+'-31').all<{reminder_id:number;due_date:string;is_paid:number;amount_sen:number}>();
      const checked=new Map(checks.results.map(x=>[x.reminder_id+'|'+x.due_date,x]));
      const occurrences=[] as Array<Record<string,unknown>>;
      for(const r of reminders.results as Array<{id:number;name:string;amount_sen:number;first_due_date:string;frequency:string;note:string;is_active:number}>){
        if(r.is_active!==1)continue;
        const due=occurrence(r.first_due_date,r.frequency,month);
        if(due){const check=checked.get(r.id+'|'+due);
          occurrences.push({...r,due_date:due,amount_sen:check?.amount_sen??r.amount_sen,paid:check?.is_paid??0});
        }
      }
      occurrences.sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date)));
      return good({reminders:reminders.results,occurrences});
    }catch(e){return limitedError(e,'load family reminders')}
  }
  if(path==='/api/family-reminders'&&request.method==='POST'){
    const d=await parseJson(request);
    if(!d||!keyOk(d.creation_key)||!nameOk(d.name)||!money(d.amount_sen)||!dateOk(d.first_due_date)||
       !['one-time','monthly','yearly'].includes(String(d.frequency))||typeof d.note!=='string'||d.note.length>500)
      return bad('Enter a name, amount, valid first due date and frequency.');
    try{
      const old=await env.DB.prepare('SELECT id FROM family_reminders WHERE creation_key=?').bind(d.creation_key).first<{id:number}>();
      if(old)return good({id:old.id,already_created:true});
      await env.DB.prepare('INSERT INTO family_reminders(creation_key,name,amount_sen,first_due_date,frequency,note) VALUES(?,?,?,?,?,?)')
        .bind(d.creation_key,d.name.trim(),d.amount_sen,d.first_due_date,d.frequency,d.note).run();
      return good();
    }catch(e){return limitedError(e,'create family reminder')}
  }
  const checklist=path.match(/^\/api\/family-reminders\/(\d+)\/check$/);
  if(checklist&&request.method==='POST'){
    const id=Number(checklist[1]),d=await parseJson(request);
    if(!d||!dateOk(d.due_date)||typeof d.paid!=='boolean')return bad('Invalid reminder payment.');
    try{
      const r=await env.DB.prepare('SELECT id,first_due_date,frequency,amount_sen,is_active FROM family_reminders WHERE id=?')
        .bind(id).first<{id:number;first_due_date:string;frequency:string;amount_sen:number;is_active:number}>();
      if(!r||r.is_active!==1)return bad('Reminder not found or archived.',404);
      if(occurrence(r.first_due_date,r.frequency,d.due_date.slice(0,7))!==d.due_date)return bad('This date is not a scheduled occurrence.',400);
      const old=await env.DB.prepare('SELECT amount_sen FROM family_reminder_checks WHERE reminder_id=? AND due_date=?')
        .bind(id,d.due_date).first<{amount_sen:number}>();
      await env.DB.prepare(`INSERT INTO family_reminder_checks(reminder_id,due_date,is_paid,paid_at,amount_sen)
        VALUES(?,?,?,CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END,?)
        ON CONFLICT(reminder_id,due_date) DO UPDATE SET
        is_paid=excluded.is_paid,paid_at=excluded.paid_at,amount_sen=family_reminder_checks.amount_sen`)
        .bind(id,d.due_date,d.paid?1:0,d.paid?1:0,old?.amount_sen??r.amount_sen).run();
      return good();
    }catch(e){return limitedError(e,'update reminder checklist')}
  }
  const reminder=path.match(/^\/api\/family-reminders\/(\d+)$/);
  if(reminder&&request.method==='PATCH'){
    const id=Number(reminder[1]),d=await parseJson(request);
    if(!d||!nameOk(d.name)||!money(d.amount_sen)||typeof d.note!=='string'||d.note.length>500)return bad('Invalid name, amount or notes.');
    try{
      const res=await env.DB.prepare('UPDATE family_reminders SET name=?,amount_sen=?,note=? WHERE id=? AND is_active=1')
        .bind(d.name.trim(),d.amount_sen,d.note,id).run();
      if(!res.meta.changes)return bad('Reminder not found.',404);
      return good();
    }catch(e){return limitedError(e,'edit reminder')}
  }
  if(reminder&&request.method==='DELETE'){
    const id=Number(reminder[1]);
    try{const res=await env.DB.prepare('UPDATE family_reminders SET is_active=0 WHERE id=? AND is_active=1').bind(id).run();
      if(!res.meta.changes)return bad('Reminder not found.',404);
      return good();
    }catch(e){return limitedError(e,'archive reminder')}
  }
  return bad('Unsupported method for this endpoint.',405);
}
