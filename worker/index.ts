import { subscriptionRoute } from './subscriptions.js';
import { communityRoute } from './community.js';
import { safetyRoute } from './safety.js';
import { authRoute, hasPocketKuSession, mutationAllowed, unauthorized, missingAuthConfig, isPocketKuConfigured, csrfDenied } from './auth.js';
/** PocketKu Worker. All /api/* endpoints require single-user session authorization. */
interface Env { DB: D1Database; PK_LOGIN_ID?: string; PK_PASSWORD_HASH?: string }


const replyError = (message: string, status: number) =>
  Response.json({success:false,error:message},{status});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return new Response(null,{status:404});
    }

    // Fail CLOSED. Secrets missing => no access, including local development.
    if (!isPocketKuConfigured(env)) return missingAuthConfig();
    const authResponse = await authRoute(request, env, url);
    if (authResponse) return authResponse;
    try {
      if (!await hasPocketKuSession(request, env)) return unauthorized();
    } catch {
      return replyError('Session verification unavailable. Check migration 0010.',503);
    }
    if (!mutationAllowed(request)) return csrfDenied();

    // Step 7.22: local-only, read-only financial integrity checks.
    const safety=await safetyRoute(request,env,url);
    if(safety)return safety;

    // Step 7.21: D1 shared payments + independent family reminders.
    const community=await communityRoute(request,env,url);
    if(community)return community;

    // Personal subscriptions/trials, authenticated checklist only. No bank ledger writes.
    const subscriptions=await subscriptionRoute(request,env,url);
    if(subscriptions)return subscriptions;

    // Step 7.20.2: one-time financing setup. Uses the existing debts,
    // commitments and auto-debt-link tables; NO schema migration required.
    // D1 batch runs the creation and connection atomically. A new series is
    // never generated when the user selects an imported existing series.
    if (url.pathname === '/api/financing/setup-options' && request.method === 'GET') {
      const month=url.searchParams.get('month');
      if(!month||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month))
        return replyError('Choose a valid planning month.',400);
      try {
        const [series,debts]=await Promise.all([
          env.DB.prepare(`
            SELECT c.series_key,MIN(c.name) AS name,
              MIN(c.allocation_month) AS first_month,
              COUNT(*) AS unpaid_count,MIN(c.amount_sen) AS minimum_sen,
              MAX(c.amount_sen) AS maximum_sen,SUM(c.amount_sen) AS future_total_sen,
              MIN(c.installment_no) AS first_installment,MAX(c.installment_total) AS installment_total
            FROM monthly_commitments c
            WHERE c.series_key IS NOT NULL AND c.status<>'paid'
              AND c.allocation_month>=?
              AND NOT EXISTS (SELECT 1 FROM commitment_debt_links l
                WHERE l.series_key=c.series_key)
              AND NOT EXISTS (SELECT 1 FROM monthly_commitments c2
                JOIN commitment_debt_links l ON l.commitment_id=c2.id
                WHERE c2.series_key=c.series_key AND c2.status<>'paid'
                  AND c2.allocation_month>=?)
            GROUP BY c.series_key ORDER BY first_month,name LIMIT 100
          `).bind(month,month).all(),
          env.DB.prepare(`SELECT d.id,d.name,d.creditor,
            d.starting_balance_sen-COALESCE((SELECT SUM(p.amount_sen)
              FROM debt_payments p WHERE p.debt_id=d.id),0) AS remaining_sen
            FROM debts d ORDER BY d.name`).all()
        ]);
        return Response.json({success:true,series:series.results,debts:debts.results});
      }catch(error){console.error('Financing options load failed',error);
        return replyError('Could not load financing options. Apply migrations through 0008.',500)}
    }
    if (url.pathname === '/api/financing/setup' && request.method === 'POST') {
      let payload:unknown;
      try{payload=await request.json()}catch{return replyError('Invalid JSON.',400)}
      if(!payload||typeof payload!=='object'||Array.isArray(payload))return replyError('Invalid financing setup.',400);
      const x=payload as Record<string,unknown>;
      const setupId=x.setup_id;
      if(typeof setupId!=='string'||!/^[a-f0-9-]{36}$/i.test(setupId))return replyError('Invalid setup request ID.',400);
      const mode=x.mode, debtMode=x.debt_mode;
      if((mode!=='existing'&&mode!=='new')||(debtMode!=='existing'&&debtMode!=='new'))
        return replyError('Choose a financing setup and debt balance option.',400);
      const monthPattern=/^[0-9]{4}-(0[1-9]|1[0-2])$/;
      const datePattern=/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
      const startMonth=x.start_month;
      if(typeof startMonth!=='string'||!monthPattern.test(startMonth)||startMonth<'2026-10'||startMonth>'2028-07')
        return replyError('Choose a planning month from Oct 2026 to Jul 2028.',400);
      let debtId:number|null=null;
      let debtName:string,balance:number;
      let creditor='',asOf='',note='';
      const debtKey='financing:'+setupId;
      try {
        if(debtMode==='existing'){
          if(!Number.isSafeInteger(x.debt_id)||Number(x.debt_id)<1)
            return replyError('Select the existing debt to connect.',400);
          debtId=Number(x.debt_id);
          const found=await env.DB.prepare(`SELECT d.id,d.name,
            d.starting_balance_sen-COALESCE((SELECT SUM(p.amount_sen) FROM debt_payments p WHERE p.debt_id=d.id),0) AS remaining
            FROM debts d WHERE d.id=?`).bind(debtId).first<{id:number;name:string;remaining:number}>();
          if(!found||found.remaining<=0)return replyError('Select an outstanding debt with a positive balance.',409);
          balance=found.remaining;debtName=found.name;
        }else{
          debtName=typeof x.debt_name==='string'?x.debt_name.trim():'';
          creditor=typeof x.creditor==='string'?x.creditor.trim():'';
          balance=Number(x.outstanding_sen);
          asOf=typeof x.as_of_date==='string'?x.as_of_date:'';
          note=typeof x.note==='string'?x.note.trim():'';
          if(!debtName||debtName.length>120||creditor.length>120||note.length>500||
            !Number.isSafeInteger(balance)||balance<=0||balance>100000000000||
            !datePattern.test(asOf)||Number.isNaN(Date.parse(asOf)))
            return replyError('Enter a debt name, valid date, and positive remaining balance.',400);
        }
        const principal=x.principal_sen===null?null:Number(x.principal_sen);
        if(principal!==null&&(!Number.isSafeInteger(principal)||principal<=0||principal>100000000000))
          return replyError('Principal reduction must be a positive amount.',400);
        let seriesKey:string, fromMonth:string, itemName:string, amounts:number[];const entries:{month:string;no:number;due:string}[]=[];
        if(mode==='existing'){
          if(typeof x.series_key!=='string'||x.series_key.length<1||x.series_key.length>250)
            return replyError('Select an existing recurring commitment.',400);
          seriesKey=x.series_key;
          const existing=await env.DB.prepare(`SELECT allocation_month,amount_sen,name,installment_no,status
            FROM monthly_commitments WHERE series_key=? AND allocation_month>=? ORDER BY allocation_month`)
            .bind(seriesKey,startMonth).all<{allocation_month:string;amount_sen:number;name:string;installment_no:number|null;status:string}>();
          const pending=existing.results.filter(c=>c.status!=='paid');
          if(!pending.length)return replyError('No unpaid instalments in this series from the selected month.',409);
          const overlap=await env.DB.prepare(`SELECT 1 AS found FROM commitment_debt_links l
            WHERE l.series_key=? OR (l.commitment_id IN (SELECT c.id FROM monthly_commitments c
              WHERE c.series_key=? AND c.allocation_month>=? AND c.status<>'paid')) LIMIT 1`)
            .bind(seriesKey,seriesKey,startMonth).first();
          if(overlap)return replyError('These instalments are already connected to a debt. No duplicate was created.',409);
          fromMonth=pending[0].allocation_month;itemName=pending[0].name;
          amounts=pending.map(c=>c.amount_sen);
        }else{
          itemName=typeof x.name==='string'?x.name.trim():'';
          const payment=Number(x.monthly_amount_sen),current=Number(x.current_installment),total=Number(x.installment_total);
          const dueDay=Number(x.due_day);
          if(!itemName||itemName.length>120||!Number.isSafeInteger(payment)||payment<=0||payment>100000000000||
            !Number.isSafeInteger(current)||!Number.isSafeInteger(total)||current<1||total<current||total>600||
            !Number.isSafeInteger(dueDay)||dueDay<1||dueDay>28)
            return replyError('Enter a name, positive monthly amount, instalment number/total and due day (1–28).',400);
          const months=total-current+1;
          if(months>36)return replyError('Create at most 36 upcoming instalments at a time.',400);
          const year=Number(startMonth.slice(0,4)),month=Number(startMonth.slice(5,7));
          for(let index=0;index<months;index++){
            const alloc=new Date(Date.UTC(year,month-1+index,1));
            const next=new Date(Date.UTC(year,month+index,1));
            const ym=alloc.toISOString().slice(0,7);
            const due=next.toISOString().slice(0,7)+'-'+String(dueDay).padStart(2,'0');
            if(ym>'2028-07')return replyError('This schedule extends beyond Jul 2028. Use an earlier start month or add future months later.',400);
            entries.push({month:ym,no:current+index,due});
          }
          const matching=await env.DB.prepare(`SELECT COUNT(*) AS n FROM monthly_commitments
            WHERE lower(name)=lower(?) AND allocation_month>=? AND status<>'paid'`)
            .bind(itemName,startMonth).first<{n:number}>();
          // Prevent accidental duplicates of plans already imported manually.
          if((matching?.n??0)>0)return replyError('A commitment with this name already exists. Choose “Use existing instalments” instead.',409);
          fromMonth=startMonth;seriesKey='financing:'+setupId;
          amounts=entries.map(()=>payment);
        }
        const totalProjected=amounts.reduce((sum,v)=>sum+(principal??v),0);
        if(principal!==null && amounts.some(v=>principal>v))
          return replyError('Debt reduction cannot exceed the monthly payment.',400);
        if(totalProjected>balance)return replyError(
          'Upcoming debt reductions would exceed the outstanding balance. Check the balance or enter a smaller principal reduction per instalment.',409);
        const stmts:D1PreparedStatement[]=[];
        if(debtMode==='new')stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO debts
          (creation_key,name,creditor,starting_balance_sen,as_of_date,note)
          VALUES(?,?,?,?,?,?)`).bind(debtKey,debtName,creditor,balance,asOf,note));
        if(mode==='new')for(const entry of entries){
          stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO monthly_commitments
            (creation_key,series_key,allocation_month,name,category,amount_sen,
             due_date,installment_no,installment_total)
            VALUES(?,?,?,?,?,?,?,?,?)`).bind(
            'financing:'+setupId+':'+entry.month,seriesKey,entry.month,itemName,'Financing',amounts[0],
            entry.due,entry.no,Number(x.installment_total)));
        }
        const linkSql=debtMode==='existing'
          ? `INSERT INTO commitment_debt_links (debt_id,series_key,from_month,principal_sen) SELECT ?,?,?,?`
          : `INSERT INTO commitment_debt_links (debt_id,series_key,from_month,principal_sen)
             SELECT id,?,?,? FROM debts WHERE creation_key=?`;
        stmts.push(env.DB.prepare(linkSql).bind(
          ...(debtMode==='existing'?[debtId,seriesKey,fromMonth,principal]:[seriesKey,fromMonth,principal,debtKey])));
        await env.DB.batch(stmts);
        return Response.json({success:true,name:itemName,month:fromMonth,series_key:seriesKey,created_count:entries.length},{status:201});
      }catch(error){console.error('Financing setup rejected',error);
        return replyError('Financing setup not saved. Check for a duplicate series, missing migrations or conflicting debt connection. No partial setup should be retained.',409)}
    }

    // Step 7.20.1: connect an unpaid bill (or future recurring series) to a
    // debt once; marking the bill Paid creates one bank debit and one debt
    // reduction atomically using D1 triggers from migration 0008.
    if (url.pathname === '/api/commitment-debt-links' && request.method === 'GET') {
      const month=url.searchParams.get('month');
      if(!month||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return replyError('Valid month required.',400);
      try {
        const [links,debts]=await Promise.all([
          env.DB.prepare(`
            SELECT c.id AS commitment_id, COALESCE(one.debt_id,series.debt_id) AS debt_id,
              COALESCE(one.principal_sen,series.principal_sen) AS principal_sen,
              CASE WHEN one.id IS NOT NULL THEN 'one' ELSE 'future' END AS scope,
              d.name AS debt_name
            FROM monthly_commitments c
            LEFT JOIN commitment_debt_links one ON one.commitment_id=c.id
            LEFT JOIN commitment_debt_links series ON series.series_key=c.series_key
              AND c.allocation_month>=series.from_month
            LEFT JOIN debts d ON d.id=COALESCE(one.debt_id,series.debt_id)
            WHERE c.allocation_month=? AND d.id IS NOT NULL
            ORDER BY c.id
          `).bind(month).all(),
          env.DB.prepare(`
            SELECT d.id,d.name,d.creditor,
              d.starting_balance_sen-COALESCE((SELECT SUM(p.amount_sen)
                FROM debt_payments p WHERE p.debt_id=d.id),0) AS remaining_sen
            FROM debts d ORDER BY d.name
          `).all()
        ]);
        return Response.json({success:true,links:links.results,debts:debts.results});
      } catch(error){console.error('Debt links read failed',error);
        return replyError('Could not read debt connections. Apply migration 0008 locally.',500)}
    }
    if (url.pathname === '/api/commitment-debt-links' && request.method === 'POST') {
      let payload:unknown;
      try{payload=await request.json()}catch{return replyError('Invalid JSON.',400)}
      if(!payload||typeof payload!=='object'||Array.isArray(payload))return replyError('Invalid link.',400);
      const d=payload as Record<string,unknown>;
      const cid=d.commitment_id, debtId=d.debt_id,scope=d.scope,principal=d.principal_sen;
      if(!Number.isSafeInteger(cid)||Number(cid)<1 || !Number.isSafeInteger(debtId)||Number(debtId)<1||
         (scope!=='one'&&scope!=='future')||
         !(principal===null||(Number.isSafeInteger(principal)&&Number(principal)>0&&Number(principal)<=100000000000)))
        return replyError('Check commitment, debt, scope and principal amount.',400);
      try {
        const target=await env.DB.prepare(`SELECT id,series_key,allocation_month,status,amount_sen
          FROM monthly_commitments WHERE id=?`).bind(cid).first<{
          id:number;series_key:string|null;allocation_month:string;status:string;amount_sen:number
        }>();
        if(!target)return replyError('Commitment not found.',404);
        if(target.status==='paid')return replyError('Already-paid bills must be linked from Settlements instead.',409);
        if(scope==='future'&&!target.series_key)return replyError('This bill is not part of a recurring series.',409);
        if(principal!==null && Number(principal)>target.amount_sen)
          return replyError('Principal reduction must not exceed this bill amount.',400);
        // Explain a projected balance mismatch BEFORE the SQLite trigger gives
        // an opaque conflict. Payment itself remains guarded atomically in DB.
        const debt=await env.DB.prepare(`SELECT d.starting_balance_sen-
          COALESCE((SELECT SUM(p.amount_sen) FROM debt_payments p WHERE p.debt_id=d.id),0) AS remaining
          FROM debts d WHERE d.id=?`).bind(debtId).first<{remaining:number}>();
        if(!debt||debt.remaining<=0)return replyError('Debt not found or fully settled.',409);
        if(scope==='future'){
          const schedule=await env.DB.prepare(`SELECT COUNT(*) AS count,
            COALESCE(SUM(COALESCE(?,amount_sen)),0) AS total
            FROM monthly_commitments WHERE series_key=? AND allocation_month>=? AND status<>'paid'`)
            .bind(principal,target.series_key,target.allocation_month).first<{count:number;total:number}>();
          const expected=schedule?.total??0;
          if(expected>debt.remaining){
            const money=(n:number)=>'RM '+(n/100).toFixed(2);
            return replyError(`Cannot connect all future instalments: ${schedule?.count??0} scheduled repayments total ${money(expected)}, but the debt has ${money(debt.remaining)} remaining (difference ${money(expected-debt.remaining)}). Review which instalments are already paid, or link only this one.`,409);
          }
        }else if(Number(principal??target.amount_sen)>debt.remaining){
          return replyError('The instalment debt reduction exceeds the outstanding debt balance.',409);
        }
        await env.DB.prepare(`INSERT INTO commitment_debt_links
          (debt_id,commitment_id,series_key,from_month,principal_sen)
          VALUES (?,?,?,?,?)`).bind(debtId,scope==='one'?cid:null,
            scope==='future'?target.series_key:null,scope==='future'?target.allocation_month:null,principal).run();
        return Response.json({success:true},{status:201});
      }catch(error){console.error('Debt connection rejected',error);
        return replyError('Could not connect debt. It may already be linked, settled, or have incompatible future instalment amounts.',409)}
    }
    const debtLinkRemove=url.pathname.match(/^\/api\/commitment-debt-links\/(\d+)$/);
    if(debtLinkRemove){
      if(request.method!=='DELETE')return replyError('Method not allowed.',405);
      const cid=Number(debtLinkRemove[1]);
      if(!Number.isSafeInteger(cid)||cid<1)return replyError('Invalid commitment.',400);
      try{
        const result=await env.DB.prepare(`DELETE FROM commitment_debt_links WHERE id IN (
          SELECT l.id FROM monthly_commitments c JOIN commitment_debt_links l
            ON l.commitment_id=c.id OR (l.series_key=c.series_key AND c.allocation_month>=l.from_month)
          WHERE c.id=? AND c.status<>'paid'
        )`).bind(cid).run();
        if(result.meta.changes!==1)return replyError('Connection not found or no longer editable.',409);
        return Response.json({success:true});
      }catch(error){console.error('Remove debt connection rejected',error);
        return replyError('Unable to remove connection. Check the selected commitment.',409)}
    }

    // Step 7.20: one D1 source of truth for debt balances and repayments.
    // Debt balances do not count as cash. Direct repayments debit cash exactly once;
    // a link to an already-paid commitment does not debit it a second time.
    if (url.pathname === '/api/debts' && request.method === 'GET') {
      try {
        const [debts, payments] = await Promise.all([
          env.DB.prepare(`
            SELECT d.id,d.creation_key,d.name,d.creditor,d.starting_balance_sen,
              d.as_of_date,d.note,d.created_at,
              COALESCE((SELECT SUM(p.amount_sen) FROM debt_payments p WHERE p.debt_id=d.id),0) AS repaid_sen,
              d.starting_balance_sen - COALESCE((SELECT SUM(p.amount_sen) FROM debt_payments p WHERE p.debt_id=d.id),0) AS remaining_sen
            FROM debts d ORDER BY d.id DESC
          `).all(),
          env.DB.prepare(`
            SELECT p.id,p.payment_key,p.debt_id,p.mode,p.amount_sen,p.account_id,
              a.name AS account_name,p.commitment_id,c.name AS commitment_name,
              p.ledger_entry_id,p.paid_on,p.note,p.created_at
            FROM debt_payments p
            LEFT JOIN accounts a ON a.id=p.account_id
            LEFT JOIN monthly_commitments c ON c.id=p.commitment_id
            ORDER BY p.id DESC
          `).all(),
        ]);
        return Response.json({success:true,debts:debts.results,payments:payments.results});
      } catch(error) {
        console.error('Debts read failed',error);
        return replyError('Could not load debt records. Apply migration 0007 locally.',500);
      }
    }
    if (url.pathname === '/api/debts/paid-commitments' && request.method === 'GET') {
      try {
        const rows=await env.DB.prepare(`
          SELECT c.id,c.name,c.allocation_month,c.amount_sen,
            COALESCE((SELECT SUM(l.amount_sen)
              FROM commitment_payments cp JOIN account_ledger l ON l.id=cp.ledger_entry_id
              WHERE cp.commitment_id=c.id AND l.entry_type='expense'),0) AS paid_sen
          FROM monthly_commitments c
          WHERE c.status='paid' AND NOT EXISTS
            (SELECT 1 FROM debt_payments dp WHERE dp.commitment_id=c.id)
          ORDER BY c.allocation_month DESC,c.id DESC LIMIT 300
        `).all();
        return Response.json({success:true,commitments:rows.results.filter(r=>Number(r.paid_sen)>0)});
      } catch(error) {
        console.error('Eligible commitments read failed',error);
        return replyError('Could not read paid monthly commitments.',500);
      }
    }
    if (url.pathname === '/api/debts' && request.method === 'POST') {
      let raw:unknown;
      try{raw=await request.json()}catch{return replyError('Invalid JSON.',400)}
      if(!raw||typeof raw!=='object'||Array.isArray(raw))return replyError('Invalid debt.',400);
      const d=raw as Record<string,unknown>;
      const key=typeof d.creation_key==='string'?d.creation_key:'';
      const name=typeof d.name==='string'?d.name.trim():'';
      const creditor=typeof d.creditor==='string'?d.creditor.trim():'';
      const value=d.starting_balance_sen;
      const date=typeof d.as_of_date==='string'?d.as_of_date:'';
      const note=typeof d.note==='string'?d.note.trim():'';
      if(!/^debt:[0-9a-f-]{36}$/i.test(key)||name.length<1||name.length>120||
         creditor.length>120||note.length>500||
         !Number.isSafeInteger(value)||Number(value)<=0||Number(value)>100000000000||
         !/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||
         new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)
         return replyError('Check debt name, outstanding amount and starting date.',400);
      try {
        await env.DB.prepare(`INSERT OR IGNORE INTO debts
          (creation_key,name,creditor,starting_balance_sen,as_of_date,note)
          VALUES (?,?,?,?,?,?)`).bind(key,name,creditor,value,date,note).run();
        const found=await env.DB.prepare(`SELECT id,name,creditor,starting_balance_sen,as_of_date,note
          FROM debts WHERE creation_key=?`).bind(key).first<{
            id:number;name:string;creditor:string;starting_balance_sen:number;as_of_date:string;note:string;
          }>();
        if(!found||found.name!==name||found.creditor!==creditor||found.starting_balance_sen!==value||
           found.as_of_date!==date||found.note!==note)
          return replyError('Debt reference already exists with different values.',409);
        return Response.json({success:true,id:found.id});
      }catch(error){console.error('Debt creation failed',error);return replyError('Could not create debt.',409)}
    }
    const debtById=url.pathname.match(/^\/api\/debts\/(\d+)$/);
    if(debtById){
      if(request.method!=='PATCH')return replyError('Method not allowed.',405);
      const id=Number(debtById[1]);
      let raw:unknown;
      try{raw=await request.json()}catch{return replyError('Invalid JSON.',400)}
      if(!raw||typeof raw!=='object'||Array.isArray(raw))return replyError('Invalid edit.',400);
      const d=raw as Record<string,unknown>;
      const name=typeof d.name==='string'?d.name.trim():'';
      const creditor=typeof d.creditor==='string'?d.creditor.trim():'';
      const value=d.starting_balance_sen;
      const note=typeof d.note==='string'?d.note.trim():'';
      if(!Number.isSafeInteger(id)||id<1||name.length<1||name.length>120||creditor.length>120||
         note.length>500||!Number.isSafeInteger(value)||Number(value)<=0||Number(value)>100000000000)
        return replyError('Invalid debt details.',400);
      try {
        const saved=await env.DB.prepare(`UPDATE debts
          SET name=?,creditor=?,starting_balance_sen=?,note=?,updated_at=CURRENT_TIMESTAMP
          WHERE id=?`).bind(name,creditor,value,note,id).run();
        if(saved.meta.changes!==1)return replyError('Debt not found.',404);
        return Response.json({success:true});
      }catch(error){console.error('Debt edit rejected',error);return replyError('Debt edit rejected: starting amount cannot be below repayments already recorded.',409)}
    }
    const debtPay=url.pathname.match(/^\/api\/debts\/(\d+)\/payments$/);
    if(debtPay){
      if(request.method!=='POST')return replyError('Method not allowed.',405);
      const id=Number(debtPay[1]);
      let raw:unknown;
      try{raw=await request.json()}catch{return replyError('Invalid JSON.',400)}
      if(!raw||typeof raw!=='object'||Array.isArray(raw))return replyError('Invalid repayment.',400);
      const d=raw as Record<string,unknown>;
      const key=typeof d.payment_key==='string'?d.payment_key:'';
      const mode=d.mode;
      const value=d.amount_sen;
      const accountId=mode==='direct'?d.account_id:null;
      const commitmentId=mode==='commitment'?d.commitment_id:null;
      const paidOn=typeof d.paid_on==='string'?d.paid_on:'';
      const note=typeof d.note==='string'?d.note.trim():'';
      const protectedFlag=d.acknowledge_protected===true?1:0;
      if(!Number.isSafeInteger(id)||id<1||!/^pay:[0-9a-f-]{36}$/i.test(key)||
         (mode!=='direct'&&mode!=='commitment')||
         !Number.isSafeInteger(value)||Number(value)<=0||Number(value)>100000000000||
         (mode==='direct'&&(!Number.isSafeInteger(accountId)||Number(accountId)<1))||
         (mode==='commitment'&&(!Number.isSafeInteger(commitmentId)||Number(commitmentId)<1))||
         note.length>300||!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)||
         !Number.isFinite(Date.parse(paidOn))||
         new Date(paidOn+'T00:00:00Z').toISOString().slice(0,10)!==paidOn)
        return replyError('Check amount, payment source and payment date.',400);
      try {
        // Fast path for retries; the UNIQUE payment_key is enforced by D1.
        const prior=await env.DB.prepare(`SELECT id,debt_id,mode,amount_sen,account_id,
            commitment_id,paid_on,note,acknowledge_protected FROM debt_payments WHERE payment_key=?`)
          .bind(key).first<{
            id:number;debt_id:number;mode:string;amount_sen:number;account_id:number|null;
            commitment_id:number|null;paid_on:string;note:string;acknowledge_protected:number;
          }>();
        const matches=(p:typeof prior)=>Boolean(p&&p.debt_id===id&&p.mode===mode&&
          p.amount_sen===value&&p.account_id===accountId&&p.commitment_id===commitmentId&&
          p.paid_on===paidOn&&p.note===note&&p.acknowledge_protected===protectedFlag);
        if(prior) return matches(prior)
          ? Response.json({success:true,id:prior.id,already_recorded:true})
          : replyError('Payment reference was used with different values.',409);
        // The database BEFORE/AFTER triggers check outstanding amount and free cash,
        // then atomically post a debit for mode=direct. Linked payments never debit.
        await env.DB.prepare(`INSERT INTO debt_payments
          (payment_key,debt_id,mode,amount_sen,account_id,commitment_id,
           acknowledge_protected,paid_on,note)
          VALUES (?,?,?,?,?,?,?,?,?)`).bind(key,id,mode,value,accountId,commitmentId,protectedFlag,paidOn,note).run();
        const saved=await env.DB.prepare(`SELECT id,debt_id,mode,amount_sen,account_id,
            commitment_id,paid_on,note,acknowledge_protected FROM debt_payments WHERE payment_key=?`)
          .bind(key).first<{
            id:number;debt_id:number;mode:string;amount_sen:number;account_id:number|null;
            commitment_id:number|null;paid_on:string;note:string;acknowledge_protected:number;
          }>();
        if(!matches(saved))return replyError('Payment not confirmed. Refresh records before retrying.',409);
        return Response.json({success:true,id:saved!.id,already_recorded:false},{status:201});
      } catch(error) {
        // A retry may have succeeded immediately before another request.
        const previous=await env.DB.prepare(`SELECT id,debt_id,mode,amount_sen,account_id,
          commitment_id,paid_on,note,acknowledge_protected FROM debt_payments WHERE payment_key=?`)
          .bind(key).first<{
            id:number;debt_id:number;mode:string;amount_sen:number;account_id:number|null;
            commitment_id:number|null;paid_on:string;note:string;acknowledge_protected:number;
          }>().catch(()=>null);
        if(previous&&previous.debt_id===id&&previous.mode===mode&&previous.amount_sen===value&&
          previous.account_id===accountId&&previous.commitment_id===commitmentId&&
          previous.paid_on===paidOn&&previous.note===note&&previous.acknowledge_protected===protectedFlag)
          return Response.json({success:true,id:previous.id,already_recorded:true});
        console.error('Debt payment failed',error);
        return replyError('Payment not posted. Check remaining debt, available bank cash, protected savings and whether the instalment was already linked.',409);
      }
    }

    // Read-only full commitment schedule: computed from saved D1 records.
    // A timeline stops at the last stored commitment; no assumed infinite recurring bills.
    if(url.pathname==='/api/commitments/timeline'&&request.method==='GET'){
      try{const result=await env.DB.prepare(`SELECT allocation_month AS period,COUNT(*) AS count,
         COALESCE(SUM(amount_sen),0) AS planned_sen,
         COALESCE(SUM(CASE WHEN status='reserved' THEN amount_sen ELSE 0 END),0) AS reserved_sen,
         COALESCE(SUM(CASE WHEN status='paid' THEN amount_sen ELSE 0 END),0) AS paid_sen,
         COALESCE(SUM(CASE WHEN status='unallocated' THEN amount_sen ELSE 0 END),0) AS unallocated_sen
         FROM monthly_commitments GROUP BY allocation_month ORDER BY allocation_month`).all();
        return Response.json({success:true,months:result.results});
      }catch(error){console.error('Commitment timeline unavailable',error);return replyError('Could not load commitment timeline.',500)}
    }
    if (url.pathname === '/api/accounts') {
      if (request.method === 'GET') {
        try {
          const result = await env.DB.prepare(`
            WITH movements AS (
              SELECT account_id,
                CASE WHEN entry_type IN ('income','adjustment')
                  THEN amount_sen ELSE -amount_sen END AS change_sen
              FROM account_ledger
              UNION ALL
              SELECT destination_account_id AS account_id, amount_sen AS change_sen
              FROM account_ledger WHERE entry_type = 'transfer'
            )
            SELECT a.id, a.name, a.bank_name, a.account_type,
              a.opening_balance_sen,
              a.opening_balance_sen + COALESCE(SUM(m.change_sen),0)
                AS current_balance_sen,
              COALESCE((SELECT SUM(cf.amount_sen)
                FROM commitment_funding cf JOIN monthly_commitments c
                  ON c.id=cf.commitment_id
                WHERE cf.account_id=a.id AND c.status='reserved'),0)
                AS reserved_balance_sen,
              a.is_protected, a.is_active
            FROM accounts a
            LEFT JOIN movements m ON m.account_id=a.id
            WHERE a.is_active=1
            GROUP BY a.id,a.name,a.bank_name,a.account_type,
              a.opening_balance_sen,a.is_protected,a.is_active
            ORDER BY a.id ASC
          `).all();
          return Response.json({success:true,accounts:result.results});
        } catch(error) {
          console.error('PocketKu accounts GET failed',error);
          return replyError('Database error while reading accounts.',500);
        }
      }
      if (request.method === 'POST') {
        if (!request.headers.get('content-type')?.includes('application/json'))
          return replyError('JSON content required.',415);
        let input:unknown;
        try { input=await request.json(); }
        catch {return replyError('Invalid JSON.',400)}
        if (!input || typeof input !== 'object' || Array.isArray(input))
          return replyError('Invalid account data.',400);
        const d=input as Record<string,unknown>;
        const name=typeof d.name==='string'?d.name.trim():'';
        const bank=typeof d.bank_name==='string'?d.bank_name.trim():'';
        if (!name || !bank || name.length>100 || bank.length>100 ||
          (d.account_type!=='bank' && d.account_type!=='tabung') ||
          typeof d.opening_balance_sen!=='number' ||
          !Number.isSafeInteger(d.opening_balance_sen) || d.opening_balance_sen<0 ||
          (d.is_protected!==0 && d.is_protected!==1))
          return replyError('Invalid account fields.',400);
        try {
          const result=await env.DB.prepare(`
            INSERT INTO accounts(name,bank_name,account_type,opening_balance_sen,is_protected)
            VALUES (?,?,?,?,?)
          `).bind(name,bank,d.account_type,d.opening_balance_sen,d.is_protected).run();
          return Response.json({success:true,message:'Account created successfully',
            id:result.meta.last_row_id},{status:201});
        } catch(error) {
          console.error('PocketKu accounts POST failed',error);
          return replyError('Database error while saving account.',500);
        }
      }
      return replyError('Method not allowed.',405);
    }

    // Edit account metadata only; balances always come from the ledger.
    const accountDetail=url.pathname.match(/^\/api\/accounts\/(\d+)$/);
    if(accountDetail){
      const id=Number(accountDetail[1]);
      if(!Number.isSafeInteger(id)||id<1)return replyError('Invalid account.',400);
      if(request.method==='PATCH'){
        let d:Record<string,unknown>;
        try{const raw:unknown=await request.json();if(!raw||typeof raw!=='object'||Array.isArray(raw))return replyError('Invalid account data.',400);d=raw as Record<string,unknown>}
        catch{return replyError('Invalid JSON.',400)}
        const name=typeof d.name==='string'?d.name.trim():'';
        const bank=typeof d.bank_name==='string'?d.bank_name.trim():'';
        if(!name||name.length>100||!bank||bank.length>100||
          (d.account_type!=='bank'&&d.account_type!=='tabung')||
          (d.is_protected!==0&&d.is_protected!==1))return replyError('Enter valid account details.',400);
        try{
          const result=await env.DB.prepare(`UPDATE accounts SET name=?,bank_name=?,account_type=?,is_protected=?,updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND is_active=1`).bind(name,bank,d.account_type,d.is_protected,id).run();
          if(!result.meta.changes)return replyError('Account not found.',404);
          return Response.json({success:true});
        }catch(error){console.error('Account edit rejected',error);return replyError('Could not update account details.',409)}
      }
      if(request.method==='DELETE'){
        // Archiving is allowed only for a completely empty, unused account.
        // Keep historical accounts visible to preserve accurate ledger reporting.
        try{
          const result=await env.DB.prepare(`UPDATE accounts SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND is_active=1
            AND opening_balance_sen=0
            AND NOT EXISTS(SELECT 1 FROM account_ledger WHERE account_id=? OR destination_account_id=?)
            AND NOT EXISTS(SELECT 1 FROM commitment_funding WHERE account_id=?)`).bind(id,id,id,id).run();
          if(!result.meta.changes)return replyError('Only empty, unused accounts can be archived. Keep historical or funded accounts visible.',409);
          return Response.json({success:true});
        }catch(error){console.error('Account archive rejected',error);return replyError('Could not archive account.',409)}
      }
      return replyError('Method not allowed.',405);
    }

    if (url.pathname === '/api/transfers') {
      if (request.method !== 'POST') return replyError('Method not allowed.',405);
      if (!request.headers.get('content-type')?.includes('application/json'))
        return replyError('JSON content required.',415);
      let input:unknown;
      try { input=await request.json(); }
      catch { return replyError('Invalid JSON.',400); }
      if (!input || typeof input!=='object' || Array.isArray(input))
        return replyError('Invalid transfer data.',400);
      const d=input as Record<string,unknown>;
      const from=typeof d.from_account_id==='number'?d.from_account_id:NaN;
      const to=typeof d.to_account_id==='number'?d.to_account_id:NaN;
      const amount=typeof d.amount_sen==='number'?d.amount_sen:NaN;
      const note=typeof d.note==='string'?d.note.trim():'';
      const requestId=typeof d.request_id==='string'?d.request_id:'';
      const protectedAcknowledged=d.acknowledge_protected===true?1:0;
      if (!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from===to||
          !Number.isSafeInteger(amount)||amount<=0||amount>100000000000||
          note.length>200||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        return replyError('Invalid transfer fields.',400);
      }
      try {
        // Unique client-generated request ID lets a network retry reuse the same
        // transfer without inserting a second movement.
        const previous=await env.DB.prepare(`
          SELECT id,account_id,destination_account_id,amount_sen,note
          FROM account_ledger WHERE request_id=?
        `).bind(requestId).first<{
          id:number;account_id:number;destination_account_id:number;
          amount_sen:number;note:string|null
        }>();
        if(previous) {
          if(previous.account_id!==from||previous.destination_account_id!==to||
            previous.amount_sen!==amount|| (previous.note||'')!==note)
            return replyError('This transfer reference was already used for different values.',409);
          return Response.json({success:true,id:previous.id,already_recorded:true});
        }
        // Atomic single-statement conditional insert. This checks the D1 cash
        // balance at insert time rather than relying on a stale UI balance.
        // D1 reservations are subtracted so transfers cannot spend earmarked cash.
        const result=await env.DB.prepare(`
          INSERT OR IGNORE INTO account_ledger
            (entry_type,account_id,destination_account_id,amount_sen,note,request_id)
          SELECT 'transfer',src.id,dst.id,?,?,?
          FROM accounts AS src JOIN accounts AS dst ON dst.id=?
          WHERE src.id=? AND src.is_active=1 AND dst.is_active=1
            AND src.id<>dst.id
            AND (src.is_protected=0 OR ?=1)
            AND (
              src.opening_balance_sen + COALESCE((
                SELECT SUM(CASE
                  WHEN l.account_id=src.id AND l.entry_type IN ('income','adjustment')
                    THEN l.amount_sen
                  WHEN l.account_id=src.id AND l.entry_type IN ('expense','transfer')
                    THEN -l.amount_sen
                  WHEN l.destination_account_id=src.id AND l.entry_type='transfer'
                    THEN l.amount_sen
                  ELSE 0 END)
                FROM account_ledger l
                WHERE l.account_id=src.id OR l.destination_account_id=src.id
              ),0) - COALESCE((
                SELECT SUM(cf.amount_sen) FROM commitment_funding cf
                JOIN monthly_commitments c ON c.id=cf.commitment_id
                WHERE cf.account_id=src.id AND c.status='reserved'
              ),0)
            ) >= ?
        `).bind(amount,note,requestId,to,from,protectedAcknowledged,amount).run();
        if(result.meta.changes!==1){
          const previousAgain=await env.DB.prepare(`SELECT id,account_id,destination_account_id,amount_sen,note FROM account_ledger WHERE request_id=?`).bind(requestId).first<{id:number;account_id:number;destination_account_id:number;amount_sen:number;note:string|null}>();
          if(previousAgain && previousAgain.account_id===from&&previousAgain.destination_account_id===to&&previousAgain.amount_sen===amount&&(previousAgain.note||'')===note)
            return Response.json({success:true,id:previousAgain.id,already_recorded:true});
          return replyError('Transfer not recorded. Check accounts, protected savings confirmation and sufficient cash.',409);
        }
        return Response.json({success:true,id:result.meta.last_row_id,already_recorded:false},{status:201});
      } catch(error){
        console.error('PocketKu transfer failed',error);
        return replyError('Database error while recording transfer.',500);
      }
    }
    // Expected income and confirmed receipts are tracked separately from cash.
    if (url.pathname === '/api/income' && request.method === 'GET') {
      try {
        const result = await env.DB.prepare(`
          SELECT i.id, i.income_key, i.source_name, i.income_type,
            i.period, i.expected_amount_sen, i.expected_date,
            i.ledger_entry_id, i.received_at,
            l.account_id AS receiving_account_id,
            l.amount_sen AS received_amount_sen,
            a.name AS receiving_account_name
          FROM income_receipts AS i
          LEFT JOIN account_ledger AS l ON l.id = i.ledger_entry_id
          LEFT JOIN accounts AS a ON a.id = l.account_id
          ORDER BY i.expected_date, i.id
        `).all();
        return Response.json({success:true, income:result.results});
      } catch(error) {
        console.error('PocketKu income GET failed',error);
        return replyError('Database error while reading income receipts.',500);
      }
    }


    // Create a new forecast. This endpoint NEVER creates a ledger entry.
    // An idempotency key ensures a retry does not duplicate the forecast.
    if (url.pathname === '/api/income' && request.method === 'POST') {
      if (!request.headers.get('content-type')?.includes('application/json'))
        return replyError('JSON content required.',415);
      let input:unknown;
      try { input=await request.json(); }
      catch { return replyError('Invalid JSON.',400); }
      if (!input || typeof input!=='object' || Array.isArray(input))
        return replyError('Invalid expected income data.',400);
      const d=input as Record<string,unknown>;
      const key=typeof d.income_key==='string'?d.income_key.trim():'';
      const source=typeof d.source_name==='string'?d.source_name.trim():'';
      const type=d.income_type;
      const period=d.period;
      const estimate=d.expected_amount_sen;
      const date=d.expected_date;
      let validDate=date===null;
      if (typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const parsed=new Date(date+'T00:00:00Z');
        validDate=!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10)===date;
      }
      if (!/^manual:[0-9a-f-]{36}$/i.test(key) || key.length>100 ||
          source.length<1 || source.length>100 ||
          !['mara','refund','family','other'].includes(String(type)) ||
          typeof period!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
          (estimate!==null && (typeof estimate!=='number' ||
            !Number.isSafeInteger(estimate) || estimate<0 || estimate>100000000000)) ||
          !validDate) {
        return replyError('Invalid forecast source, type, month, amount or date.',400);
      }
      // Forecast month is a grouping key, not necessarily the bank deposit date.
      try {
        const created=await env.DB.prepare(`
          INSERT OR IGNORE INTO income_receipts
            (income_key,source_name,income_type,period,expected_amount_sen,expected_date)
          VALUES (?,?,?,?,?,?)
        `).bind(key,source,type,period,estimate,date).run();
        if (created.meta.changes===1) {
          return Response.json({success:true,created:true,income_key:key},{status:201});
        }
        const existing=await env.DB.prepare(`
          SELECT income_key,source_name,income_type,period,
                 expected_amount_sen,expected_date
          FROM income_receipts WHERE income_key=?
        `).bind(key).first<{
          income_key:string;source_name:string;income_type:string;period:string;
          expected_amount_sen:number|null;expected_date:string|null
        }>();
        if (existing && existing.source_name===source && existing.income_type===type &&
            existing.period===period && existing.expected_amount_sen===estimate &&
            existing.expected_date===date) {
          return Response.json({success:true,created:false,already_exists:true,income_key:key});
        }
        return replyError('Income request reference conflicts with an existing record.',409);
      } catch(error) {
        console.error('PocketKu create expected income failed',error);
        return replyError('Database error while creating expected income.',500);
      }
    }

    // Editing the expected amount/date does NOT credit any bank. Received
    // income becomes immutable through this endpoint to preserve the ledger.
    if (url.pathname === '/api/income/estimate') {
      if (request.method !== 'PATCH') return replyError('Method not allowed.',405);
      if (!request.headers.get('content-type')?.includes('application/json'))
        return replyError('JSON content required.',415);
      let input:unknown;
      try { input=await request.json(); }
      catch { return replyError('Invalid JSON.',400); }
      if (!input || typeof input !== 'object' || Array.isArray(input))
        return replyError('Invalid expected-income data.',400);
      const d=input as Record<string,unknown>;
      const key=typeof d.income_key==='string'?d.income_key.trim():'';
      const amountSen=d.expected_amount_sen;
      const date=d.expected_date;
      // Reject malformed or out-of-range dates, including invalid calendar days.
      let validDate=date===null;
      if (typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const parsed=new Date(date+'T00:00:00Z');
        validDate=!Number.isNaN(parsed.getTime()) &&
          parsed.toISOString().slice(0,10)===date;
      }
      if (!/^[A-Za-z0-9:_-]{1,100}$/.test(key) ||
          typeof amountSen!=='number' || !Number.isSafeInteger(amountSen) ||
          amountSen<0 || amountSen>100000000000 || !validDate) {
        return replyError('Invalid income key, expected amount or date.',400);
      }
      try {
        // Conditional update ensures a concurrent confirmation cannot be
        // followed by a late edit to its forecast amount/date.
        const result=await env.DB.prepare(`
          UPDATE income_receipts
          SET expected_amount_sen=?, expected_date=?,
              updated_at=CURRENT_TIMESTAMP
          WHERE income_key=? AND ledger_entry_id IS NULL
        `).bind(amountSen,date,key).run();
        if (result.meta.changes===1) {
          return Response.json({success:true,income_key:key,
            expected_amount_sen:amountSen,expected_date:date});
        }
        const existing=await env.DB.prepare(`
          SELECT ledger_entry_id FROM income_receipts WHERE income_key=?
        `).bind(key).first<{ledger_entry_id:number|null}>();
        if (!existing) return replyError('Expected income record not found.',404);
        return replyError('Cannot edit income that is already received.',409);
      } catch(error) {
        console.error('PocketKu income estimate PATCH failed',error);
        return replyError('Database error while updating expected income.',500);
      }
    }

    if (url.pathname === '/api/income/confirm') {
      if (request.method !== 'POST') return replyError('Method not allowed.',405);
      if (!request.headers.get('content-type')?.includes('application/json'))
        return replyError('JSON content required.',415);
      let input:unknown;
      try { input=await request.json(); }
      catch { return replyError('Invalid JSON.',400); }
      if (!input || typeof input !== 'object' || Array.isArray(input))
        return replyError('Invalid receipt data.',400);
      const d=input as Record<string,unknown>;
      const incomeKey=typeof d.income_key==='string'?d.income_key.trim():'';
      const accountId=d.account_id;
      const amountSen=d.amount_sen;
      if (!/^[A-Za-z0-9:_-]{1,100}$/.test(incomeKey) ||
          typeof accountId!=='number' || !Number.isSafeInteger(accountId) || accountId<=0 ||
          typeof amountSen!=='number' || !Number.isSafeInteger(amountSen) ||
          amountSen<=0 || amountSen>100000000000) {
        return replyError('Invalid income key, account or amount.',400);
      }
      const ledgerReference=`income:${incomeKey}`;
      type ReceiptState={
        id:number;ledger_entry_id:number|null;
        account_id:number|null;amount_sen:number|null;
        entry_type:string|null;
      };
      try {
        const existing=await env.DB.prepare(`
          SELECT i.id,i.ledger_entry_id,l.account_id,l.amount_sen,l.entry_type
          FROM income_receipts i
          LEFT JOIN account_ledger l ON l.id=i.ledger_entry_id
          WHERE i.income_key=?
        `).bind(incomeKey).first<ReceiptState>();
        if (!existing) return replyError('Expected income record not found.',404);
        // Returning the previous result is safe only for an identical retry.
        if (existing.ledger_entry_id!==null) {
          if (existing.account_id!==accountId || existing.amount_sen!==amountSen ||
              existing.entry_type!=='income') {
            return replyError('This income is already received with different values.',409);
          }
          return Response.json({success:true,already_received:true,
            ledger_entry_id:existing.ledger_entry_id,
            account_id:accountId,amount_sen:amountSen});
        }

        // D1 batch() executes these statements together in a transaction.
        // A unique ledger request_id prevents duplicate money creation, while
        // income_receipts.ledger_entry_id is unique for each received payment.
        await env.DB.batch([
          env.DB.prepare(`
            INSERT OR IGNORE INTO account_ledger
              (entry_type,account_id,destination_account_id,amount_sen,note,request_id)
            SELECT 'income',a.id,NULL,?, 'Income receipt: ' || i.source_name,?
            FROM income_receipts AS i
            JOIN accounts AS a ON a.id=? AND a.is_active=1
            WHERE i.income_key=? AND i.ledger_entry_id IS NULL
          `).bind(amountSen,ledgerReference,accountId,incomeKey),
          env.DB.prepare(`
            UPDATE income_receipts
            SET ledger_entry_id=(
              SELECT l.id FROM account_ledger l
              WHERE l.request_id=? AND l.entry_type='income'
                AND l.account_id=? AND l.amount_sen=?
            ),
            received_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP
            WHERE income_key=? AND ledger_entry_id IS NULL
              AND EXISTS (
                SELECT 1 FROM account_ledger l
                WHERE l.request_id=? AND l.entry_type='income'
                  AND l.account_id=? AND l.amount_sen=?
              )
          `).bind(ledgerReference,accountId,amountSen,incomeKey,
                  ledgerReference,accountId,amountSen)
        ]);

        const saved=await env.DB.prepare(`
          SELECT i.ledger_entry_id,l.account_id,l.amount_sen,l.entry_type
          FROM income_receipts i
          LEFT JOIN account_ledger l ON l.id=i.ledger_entry_id
          WHERE i.income_key=?
        `).bind(incomeKey).first<ReceiptState>();
        if (!saved || saved.ledger_entry_id===null) {
          return replyError('Income not recorded. Check the account and income status.',409);
        }
        if (saved.account_id!==accountId || saved.amount_sen!==amountSen ||
            saved.entry_type!=='income') {
          return replyError('Income was already recorded with different values.',409);
        }
        return Response.json({success:true,already_received:false,
          ledger_entry_id:saved.ledger_entry_id,account_id:accountId,
          amount_sen:amountSen},{status:201});
      } catch(error) {
        console.error('PocketKu income confirmation failed',error);
        return replyError('Database error while confirming income.',500);
      }
    }


    // Persistent funding splits for D1 commitments, distinct from demo envelopes.
    if (url.pathname === '/api/commitments/funding' && request.method === 'GET') {
      const period=url.searchParams.get('month');
      if(!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
        return replyError('Valid month required.',400);
      try {
        const result=await env.DB.prepare(`
          SELECT cf.commitment_id,cf.account_id,cf.amount_sen,a.name AS account_name,
                 a.is_protected
          FROM commitment_funding cf
          JOIN monthly_commitments c ON c.id=cf.commitment_id
          JOIN accounts a ON a.id=cf.account_id
          WHERE c.allocation_month=? ORDER BY cf.commitment_id,cf.account_id
        `).bind(period).all();
        return Response.json({success:true,funding:result.results});
      } catch(error) {
        console.error('Funding GET failed',error);
        return replyError('Could not load commitment funding.',500);
      }
    }

    const fundingRoute=url.pathname.match(/^\/api\/commitments\/(\d+)\/funding(?:\/(\d+))?$/);
    if(fundingRoute){
      const id=Number(fundingRoute[1]);
      const removeAccount=fundingRoute[2]?Number(fundingRoute[2]):null;
      if(!Number.isSafeInteger(id)||id<1)return replyError('Invalid commitment ID.',400);
      if(request.method==='DELETE' && removeAccount!==null){
        if(!Number.isSafeInteger(removeAccount)||removeAccount<1)
          return replyError('Invalid account.',400);
        try {
          const result=await env.DB.prepare(`
            DELETE FROM commitment_funding
            WHERE commitment_id=? AND account_id=?
              AND EXISTS (SELECT 1 FROM monthly_commitments
                          WHERE id=? AND status='unallocated')
          `).bind(id,removeAccount,id).run();
          if(result.meta.changes!==1)return replyError('Funding not found or commitment already reserved.',409);
          return Response.json({success:true});
        }catch(error){console.error('Funding delete failed',error);return replyError('Funding cannot be removed.',409)}
      }
      if(request.method==='PUT' && removeAccount===null){
        let input:unknown;
        try{input=await request.json()}catch{return replyError('Invalid JSON.',400)}
        if(!input||typeof input!=='object'||Array.isArray(input))
          return replyError('Invalid funding.',400);
        const d=input as Record<string,unknown>;
        const accountId=d.account_id, cents=d.amount_sen;
        if(!Number.isSafeInteger(accountId)||Number(accountId)<1||
           !Number.isSafeInteger(cents)||Number(cents)<=0||Number(cents)>100000000000)
          return replyError('Invalid account or amount.',400);
        try{
          // Assigned funding alone does not reserve cash. Triggers enforce
          // <= target amount and prevent edits after a reservation.
          const result=await env.DB.prepare(`
            INSERT INTO commitment_funding(commitment_id,account_id,amount_sen)
            SELECT c.id,a.id,?
            FROM monthly_commitments c JOIN accounts a ON a.id=?
            WHERE c.id=? AND c.status='unallocated' AND a.is_active=1
            ON CONFLICT(commitment_id,account_id)
              DO UPDATE SET amount_sen=excluded.amount_sen
          `).bind(cents,accountId,id).run();
          if(result.meta.changes<1)return replyError('Account or editable commitment not found.',409);
          return Response.json({success:true});
        }catch(error){
          console.error('Funding upsert failed',error);
          return replyError('Funding must not exceed the commitment amount; check account and status.',409);
        }
      }
      return replyError('Method not allowed.',405);
    }

    const statusRoute=url.pathname.match(/^\/api\/commitments\/(\d+)\/status$/);
    if(statusRoute){
      if(request.method!=='POST')return replyError('Method not allowed.',405);
      const id=Number(statusRoute[1]);
      let input:unknown;
      try{input=await request.json()}catch{return replyError('Invalid JSON.',400)}
      if(!input||typeof input!=='object'||Array.isArray(input))
        return replyError('Invalid status request.',400);
      const d=input as Record<string,unknown>;
      if(!Number.isSafeInteger(id)||id<1 ||
         (d.status!=='unallocated'&&d.status!=='reserved'&&d.status!=='paid'))
        return replyError('Invalid status or commitment.',400);
      const next=d.status;
      try {
        const before=await env.DB.prepare(`SELECT status FROM monthly_commitments WHERE id=?`)
          .bind(id).first<{status:string}>();
        if(!before)return replyError('Commitment not found.',404);
        if(before.status===next)return Response.json({success:true,status:next,already_set:true});
        if(!(before.status==='unallocated'&&next==='reserved' ||
             before.status==='reserved'&&(next==='unallocated'||next==='paid')))
          return replyError('Invalid status transition. Paid records cannot be reverted.',409);
        if(next==='reserved'&&d.acknowledge_protected!==true){
          const protectedAccount=await env.DB.prepare(`
            SELECT 1 AS protected FROM commitment_funding cf JOIN accounts a ON a.id=cf.account_id
            WHERE cf.commitment_id=? AND a.is_protected=1 LIMIT 1
          `).bind(id).first();
          if(protectedAccount) return replyError('Confirm use of protected savings before reserving.',409);
        }
        // SQLite triggers check exact funding, unreserved balances, and
        // atomically debit each source account when Reserved -> Paid.
        const result=await env.DB.prepare(`
          UPDATE monthly_commitments SET status=?,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status=?
        `).bind(next,id,before.status).run();
        if(result.meta.changes!==1)return replyError('Status changed concurrently; refresh first.',409);
        return Response.json({success:true,status:next,already_set:false});
      }catch(error){
        console.error('D1 commitment status update rejected',error);
        const detail=String(error);
        if(detail.includes('Payment exceeds debt outstanding balance'))
          return replyError('Payment not recorded: the linked debt has less outstanding than this instalment would reduce. Adjust the connection’s principal amount first.',409);
        if(detail.includes('Insufficient unreserved account balance'))
          return replyError('Payment not recorded: not enough available cash after reservations.',409);
        return replyError('Cannot change status: check full funding, available cash and any linked debt principal.',409);
      }
    }

    // Persistent D1 monthly planning endpoints.
    // Reserved and Paid are deliberately NOT exposed until D1 bank-reservation
    // invariants and atomic expense posting are implemented.
    if (url.pathname === '/api/commitments' && request.method === 'GET') {
      const period=url.searchParams.get('month');
      if (period!==null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
        return replyError('Invalid allocation month.',400);
      try {
        const stmt=period
          ? env.DB.prepare(`SELECT * FROM monthly_commitments WHERE allocation_month=? ORDER BY id`).bind(period)
          : env.DB.prepare(`SELECT * FROM monthly_commitments ORDER BY allocation_month,id LIMIT 500`);
        const result=await stmt.all();
        return Response.json({success:true,commitments:result.results});
      } catch(error) {
        console.error('Commitments GET failed',error);
        return replyError('Unable to load monthly commitments. Has migration 0005 been applied locally?',500);
      }
    }

    if (url.pathname === '/api/commitments' && request.method === 'POST') {
      if (!request.headers.get('content-type')?.includes('application/json'))
        return replyError('JSON required.',415);
      let incoming:unknown;
      try { incoming=await request.json(); } catch { return replyError('Invalid JSON.',400); }
      if (!incoming || typeof incoming!=='object' || Array.isArray(incoming))
        return replyError('Invalid commitment.',400);
      const input=incoming as Record<string,unknown>;
      const requestId=input.request_id;
      const first=input.start_month, last=input.end_month;
      const name=typeof input.name==='string'?input.name.trim():'';
      const category=typeof input.category==='string'?input.category.trim():'';
      const cents=input.amount_sen;
      const date=input.due_date;
      const startNo=input.installment_no, totalNo=input.installment_total;
      const validMonth=(x:unknown):x is string=>typeof x==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
      const validDate=(x:unknown):x is string|null=>x===null ||
        (typeof x==='string' && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
         !Number.isNaN(Date.parse(x+'T00:00:00Z')) &&
         new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x);
      if (typeof requestId!=='string' || !/^[0-9a-f-]{36}$/i.test(requestId) ||
          !validMonth(first)||!validMonth(last)||
          !name||name.length>120||!category||category.length>60||
          typeof cents!=='number'||!Number.isSafeInteger(cents)||cents<0||cents>100000000000||
          !validDate(date)||
          !(startNo===null&&totalNo===null ||
            typeof startNo==='number'&&typeof totalNo==='number'&&
            Number.isInteger(startNo)&&Number.isInteger(totalNo)&&
            startNo>=1&&totalNo>=1&&totalNo<=600&&startNo<=totalNo)) {
        return replyError('Invalid monthly commitment fields.',400);
      }
      const index=(m:string)=>Number(m.slice(0,4))*12+Number(m.slice(5,7))-1;
      const length=index(last)-index(first)+1;
      if (length<1 || length>36 || (startNo!==null && Number(startNo)+length-1>Number(totalNo)))
        return replyError('Invalid recurring range or installment count.',400);
      const periods:string[]=[];
      for (let i=0;i<length;i++) {
        const n=index(first)+i;
        periods.push(String(Math.floor(n/12)).padStart(4,'0')+'-'+String(n%12+1).padStart(2,'0'));
      }
      const series=length>1?'manual:'+requestId:null;
      try {
        const statements=periods.map((month,i)=>env.DB.prepare(`
          INSERT INTO monthly_commitments
            (creation_key,series_key,allocation_month,name,category,amount_sen,due_date,installment_no,installment_total)
          VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT(creation_key) DO NOTHING
        `).bind('manual:'+requestId+':'+month,series,month,name,category,cents,i===0?date:null,
                 startNo===null?null:Number(startNo)+i,totalNo));
        await env.DB.batch(statements);
        const saved=await env.DB.prepare(`SELECT * FROM monthly_commitments WHERE creation_key LIKE ? ORDER BY allocation_month`)
          .bind('manual:'+requestId+':%').all();
        // Identical retries are harmless; a different request with the same ID is rejected.
        const rows=saved.results as Array<Record<string,unknown>>;
        const matched=rows.length===periods.length && rows.every((row,i)=>
          row.creation_key==='manual:'+requestId+':'+periods[i] &&
          row.name===name && row.category===category && row.amount_sen===cents &&
          row.installment_no===(startNo===null?null:Number(startNo)+i) &&
          row.installment_total===totalNo && row.due_date===(i===0?date:null));
        if(!matched) return replyError('The creation request ID conflicts with an existing plan.',409);
        return Response.json({success:true,created:rows.length,already_exists:false});
      } catch(error) {
        console.error('Commitments POST failed',error);
        return replyError('Unable to create D1 commitments.',500);
      }
    }

    if (url.pathname === '/api/commitments/import-demo' && request.method === 'POST') {
      if (!request.headers.get('content-type')?.includes('application/json'))
        return replyError('JSON required.',415);
      let input:unknown;
      try { input=await request.json(); } catch {return replyError('Invalid JSON.',400)}
      if (!Array.isArray(input)||input.length<1||input.length>300)
        return replyError('Import must contain 1–300 commitments.',400);
      type SeedItem={creation_key:string;series_key:string|null;allocation_month:string;
        name:string;category:string;amount_sen:number;due_date:string|null;
        installment_no:number|null;installment_total:number|null};
      const rows=input as SeedItem[];
      const valid=rows.every(x=>x && typeof x==='object' &&
        /^demo:v1:\d{4}-(0[1-9]|1[0-2]):\d{1,3}$/.test(x.creation_key) &&
        (x.series_key===null || typeof x.series_key==='string' && /^demo:[A-Za-z0-9_-]{1,60}$/.test(x.series_key)) &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(x.allocation_month) &&
        typeof x.name==='string' && x.name.trim().length>0 && x.name.length<=120 &&
        typeof x.category==='string' && x.category.length>0 && x.category.length<=60 &&
        Number.isSafeInteger(x.amount_sen) && x.amount_sen>=0 && x.amount_sen<=100000000000 &&
        (x.due_date===null || typeof x.due_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x.due_date)) &&
        (x.installment_no===null&&x.installment_total===null ||
          Number.isInteger(x.installment_no)&&Number.isInteger(x.installment_total)&&
          Number(x.installment_no)>0&&Number(x.installment_total)>=Number(x.installment_no)));
      if (!valid || new Set(rows.map(x=>x.creation_key)).size!==rows.length)
        return replyError('Invalid demonstration plan import.',400);
      try {
        const statements=rows.map(x=>env.DB.prepare(`
          INSERT INTO monthly_commitments
            (creation_key,series_key,allocation_month,name,category,amount_sen,due_date,installment_no,installment_total)
          VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(creation_key) DO NOTHING
        `).bind(x.creation_key,x.series_key,x.allocation_month,x.name.trim(),x.category,
          x.amount_sen,x.due_date,x.installment_no,x.installment_total));
        const results=await env.DB.batch(statements);
        const added=results.reduce((n,x)=>n+(x.meta.changes||0),0);
        return Response.json({success:true,inserted:added,skipped:rows.length-added});
      }catch(error){
        console.error('Commitments import failed',error);
        return replyError('Unable to import demonstration allocations.',500);
      }
    }

    const commitmentRoute=url.pathname.match(/^\/api\/commitments\/(\d+)$/);
    if (commitmentRoute) {
      const id=Number(commitmentRoute[1]);
      if(!Number.isSafeInteger(id)||id<=0)return replyError('Invalid commitment ID.',400);
      if(request.method!=='PATCH' && request.method!=='DELETE')return replyError('Method not allowed.',405);
      let input:unknown={};
      if(request.method==='PATCH'){
        try {input=await request.json()}catch{return replyError('Invalid JSON.',400)}
      }else if(request.headers.get('content-type')?.includes('application/json')){
        try {input=await request.json()}catch{return replyError('Invalid JSON.',400)}
      }
      if(!input||typeof input!=='object'||Array.isArray(input))return replyError('Invalid commitment update.',400);
      const d=input as Record<string,unknown>;
      const scope=d.scope==='future'?'future':'one';
      try {
        const found=await env.DB.prepare('SELECT * FROM monthly_commitments WHERE id=?').bind(id)
          .first<{id:number;name:string;series_key:string|null;allocation_month:string;status:string}>();
        if(!found)return replyError('Commitment not found.',404);
        const candidates=scope==='future'&&found.series_key
          ? (await env.DB.prepare(`SELECT id,allocation_month,status FROM monthly_commitments WHERE series_key=? AND allocation_month>=? ORDER BY allocation_month`)
               .bind(found.series_key,found.allocation_month).all()).results as Array<{id:number;allocation_month:string;status:string}>
          : [{id,allocation_month:found.allocation_month,status:found.status}];
        if(candidates.some(x=>x.status!=='unallocated'))
          return replyError('Reserved or paid commitments cannot be changed.',409);
        const now=Number(found.allocation_month.slice(0,4))*12+Number(found.allocation_month.slice(5,7));
        if (request.method==='DELETE') {
          await env.DB.batch(candidates.flatMap(x=>[
            env.DB.prepare(`DELETE FROM commitment_funding WHERE commitment_id=? AND EXISTS
                (SELECT 1 FROM monthly_commitments WHERE id=? AND status='unallocated')`).bind(x.id,x.id),
            env.DB.prepare(`DELETE FROM monthly_commitments WHERE id=? AND status='unallocated'`).bind(x.id),
          ]));
          return Response.json({success:true,deleted:candidates.length});
        }
        const name=typeof d.name==='string'?d.name.trim():'';
        const category=typeof d.category==='string'?d.category.trim():'';
        const cents=d.amount_sen;const due=d.due_date;
        const inst=d.installment_no,tot=d.installment_total;
        const validDate=due===null || typeof due==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(due)&&
          !Number.isNaN(Date.parse(due+'T00:00:00Z'))&&new Date(due+'T00:00:00Z').toISOString().slice(0,10)===due;
        if(!name||name.length>120||!category||category.length>60||
          typeof cents!=='number'||!Number.isSafeInteger(cents)||cents<0||cents>100000000000||
          !validDate||!(inst===null&&tot===null ||
            Number.isInteger(inst)&&Number.isInteger(tot)&&Number(inst)>=1&&Number(tot)>=Number(inst)&&Number(tot)<=600))
          return replyError('Invalid commitment changes.',400);
        const updates=candidates.map(x=>{
          const other=Number(x.allocation_month.slice(0,4))*12+Number(x.allocation_month.slice(5,7));
          const installment=inst===null?null:Number(inst)+other-now;
          if(installment!==null && installment>Number(tot))return null;
          return env.DB.prepare(`UPDATE monthly_commitments SET name=?,category=?,amount_sen=?,
            due_date=CASE WHEN id=? THEN ? ELSE due_date END,
            installment_no=?,installment_total=?,updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND status='unallocated'`).bind(name,category,cents,id,due,installment,tot,x.id);
        });
        if(updates.some(x=>x===null))return replyError('Recurring sequence exceeds total installment count.',400);
        await env.DB.batch(updates.filter((x):x is D1PreparedStatement=>x!==null));
        return Response.json({success:true,updated:candidates.length});
      }catch(error){
        console.error('Commitments update/delete failed',error);
        return replyError('Unable to update commitments.',500);
      }
    }

    return replyError('API endpoint not found.',404);
  },
} satisfies ExportedHandler<Env>;
