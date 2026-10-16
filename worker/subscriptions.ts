/** Personal subscription reminders; never changes the cash ledger. Called only after auth+CSRF checks. */
interface SubscriptionsEnv { DB: D1Database }
const ok=(data:Record<string,unknown>={})=>Response.json({success:true,...data},{headers:{'Cache-Control':'no-store'}});
const err=(message:string,status=400)=>Response.json({success:false,error:message},{status,headers:{'Cache-Control':'no-store'}});
const validDate=(value:unknown):value is string=>{
  if(typeof value!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value))return false;
  const parsed=new Date(value+'T00:00:00Z');
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
};
async function bodyOf(request:Request):Promise<Record<string,unknown>|null>{
  if(!request.headers.get('content-type')?.includes('application/json'))return null;
  const size=Number(request.headers.get('content-length')||'0');
  if(size>4096)return null;
  try {
    const value:unknown=await request.json();
    return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
  }catch{return null}
}
function validated(input:Record<string,unknown>):{value:Record<string,unknown>}|{error:string}{
  const name=typeof input.name==='string'?input.name.trim():'';
  const provider=typeof input.provider==='string'?input.provider.trim():'';
  const note=typeof input.note==='string'?input.note.trim():'';
  const status=input.status;
  const billingCycle=input.billing_cycle;
  const next=input.next_charge_date;
  const cancel=input.cancel_by_date===null||input.cancel_by_date===''?null:input.cancel_by_date;
  const sen=input.renewal_amount_sen;
  if(!name||name.length>120||provider.length>120||note.length>1000)return {error:'Check the subscription name, provider and notes.'};
  if(status!=='trial'&&status!=='active'&&status!=='cancelled')return {error:'Choose a valid subscription status.'};
  if(!['monthly','quarterly','half_yearly','yearly','one_time'].includes(String(billingCycle)))return {error:'Choose a billing frequency.'};
  if(!Number.isSafeInteger(sen)||Number(sen)<0||Number(sen)>100000000000)return {error:'Enter a valid renewal price.'};
  if(!validDate(next)||cancel!==null&&!validDate(cancel))return {error:'Choose valid dates.'};
  if(cancel!==null&&cancel>next)return {error:'The cancellation deadline cannot be after the planned charge date.'};
  return {value:{name,provider,note,status,billing_cycle:billingCycle,renewal_amount_sen:sen,next_charge_date:next,cancel_by_date:cancel}};
}
export async function subscriptionRoute(request:Request,env:SubscriptionsEnv,url:URL):Promise<Response|null>{
  const base='/api/personal-subscriptions';
  if(url.pathname!==base&&!/^\/api\/personal-subscriptions\/\d+$/.test(url.pathname))return null;
  try{
    if(url.pathname===base&&request.method==='GET'){
      const result=await env.DB.prepare(`SELECT id,create_key,name,provider,status,renewal_amount_sen,
        next_charge_date,cancel_by_date,billing_cycle,note,created_at,updated_at
        FROM personal_subscriptions WHERE is_active=1
        ORDER BY CASE WHEN status='cancelled' THEN 1 ELSE 0 END,
        next_charge_date ASC,id DESC LIMIT 500`).all();
      return ok({subscriptions:result.results});
    }
    if(url.pathname===base&&request.method==='POST'){
      const body=await bodyOf(request);if(!body)return err('Invalid subscription data.');
      const requestKey=body.create_key;
      if(typeof requestKey!=='string'||!(/^[0-9a-f-]{36}$/i.test(requestKey)))return err('Invalid creation request ID.');
      const check=validated(body);
      if('error'in check)return err(check.error);
      const x=check.value;
      const existing=await env.DB.prepare('SELECT id FROM personal_subscriptions WHERE create_key=?').bind(requestKey).first<{id:number}>();
      if(existing)return ok({id:existing.id,already_saved:true});
      const result=await env.DB.prepare(`INSERT INTO personal_subscriptions
        (create_key,name,provider,status,renewal_amount_sen,next_charge_date,cancel_by_date,billing_cycle,note)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(create_key) DO NOTHING`)
        .bind(requestKey,x.name,x.provider,x.status,x.renewal_amount_sen,x.next_charge_date,x.cancel_by_date,x.billing_cycle,x.note).run();
      if(!result.success)return err('Could not save subscription.',500);
      const row=await env.DB.prepare('SELECT id FROM personal_subscriptions WHERE create_key=?').bind(requestKey).first<{id:number}>();
      return ok({id:row?.id});
    }
    const match=url.pathname.match(/\/personal-subscriptions\/(\d+)$/);
    if(!match)return err('Not found.',404);
    const id=Number(match[1]);if(!Number.isSafeInteger(id)||id<1)return err('Invalid subscription.',400);
    const existing=await env.DB.prepare('SELECT id,status FROM personal_subscriptions WHERE id=? AND is_active=1').bind(id).first();
    if(!existing)return err('Subscription not found.',404);
    if(request.method==='PATCH'){
      const body=await bodyOf(request);if(!body)return err('Invalid subscription data.');
      const check=validated(body);if('error'in check)return err(check.error);
      const x=check.value;
      await env.DB.prepare(`UPDATE personal_subscriptions SET name=?,provider=?,status=?,renewal_amount_sen=?,
        next_charge_date=?,cancel_by_date=?,billing_cycle=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(x.name,x.provider,x.status,x.renewal_amount_sen,x.next_charge_date,x.cancel_by_date,x.billing_cycle,x.note,id).run();
      return ok();
    }
    if(request.method==='DELETE'){
      await env.DB.prepare('UPDATE personal_subscriptions SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run();
      return ok();
    }
    return err('Method not allowed.',405);
  }catch(error){console.error('Personal subscriptions request failed',error instanceof Error?error.name:'unknown');return err('Subscriptions unavailable. Check migration 0012.',503)}
}
