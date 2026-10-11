/** PocketKu Step 7.22 — READ-ONLY D1 health checks.
 * Routes are protected by the parent Worker's local-host development guard.
 * These checks detect common accounting inconsistencies; they are NOT a full audit.
 * Never expose this endpoint publicly without actual authentication.
 */
interface SafetyEnv { DB: D1Database }

type Check = { id: string; title: string; detail: string; issues: number };

const checks: { id: string; title: string; detail: string; sql: string }[] = [
  {
    id:'negative_available',
    title:'Bank cash and available balances',
    detail:'No account should have negative cash or more reserved than it actually holds.',
    sql:`WITH debits AS (
      SELECT account_id, SUM(CASE WHEN entry_type IN ('income','adjustment')
        THEN amount_sen ELSE -amount_sen END) AS movement
      FROM account_ledger GROUP BY account_id
    ), incoming AS (
      SELECT destination_account_id AS account_id, SUM(amount_sen) AS amount
      FROM account_ledger WHERE entry_type='transfer' GROUP BY destination_account_id
    ), held AS (
      SELECT f.account_id, SUM(f.amount_sen) AS amount
      FROM commitment_funding f JOIN monthly_commitments c ON c.id=f.commitment_id
      WHERE c.status='reserved' GROUP BY f.account_id
    )
    SELECT COUNT(*) AS n FROM accounts a
      LEFT JOIN debits d ON d.account_id=a.id
      LEFT JOIN incoming i ON i.account_id=a.id
      LEFT JOIN held h ON h.account_id=a.id
    WHERE a.opening_balance_sen+COALESCE(d.movement,0)+COALESCE(i.amount,0)<0
       OR a.opening_balance_sen+COALESCE(d.movement,0)+COALESCE(i.amount,0)-COALESCE(h.amount,0)<0`
  },
  {
    id:'funding_complete',
    title:'Reserved and paid bills are fully funded',
    detail:'Reserved or paid commitments must have funding equal to the bill amount.',
    sql:`SELECT COUNT(*) AS n FROM monthly_commitments c
      WHERE c.status IN ('reserved','paid') AND
      (c.amount_sen<=0 OR COALESCE((SELECT SUM(f.amount_sen)
        FROM commitment_funding f WHERE f.commitment_id=c.id),0)<>c.amount_sen)`
  },
  {
    id:'paid_entries',
    title:'Paid bills match their bank deductions',
    detail:'Every paid commitment must have actual linked bank expenses totalling its amount.',
    sql:`SELECT COUNT(*) AS n FROM monthly_commitments c WHERE c.status='paid'
      AND COALESCE((SELECT SUM(l.amount_sen)
        FROM commitment_payments p JOIN account_ledger l ON l.id=p.ledger_entry_id
        WHERE p.commitment_id=c.id AND l.entry_type='expense'),0)<>c.amount_sen`
  },
  {
    id:'payment_sources',
    title:'Paid bank deductions match funding sources',
    detail:'Individual paid entries must match the funded bank account and its assigned amount.',
    sql:`SELECT COUNT(*) AS n FROM commitment_payments cp
       LEFT JOIN commitment_funding f ON f.commitment_id=cp.commitment_id
         AND f.account_id=cp.account_id
       LEFT JOIN account_ledger l ON l.id=cp.ledger_entry_id
       WHERE f.id IS NULL OR l.id IS NULL OR l.entry_type<>'expense'
         OR l.account_id<>cp.account_id OR l.amount_sen<>f.amount_sen`
  },
  {
    id:'debt_balances',
    title:'Debt repayments do not exceed debt balances',
    detail:'Total repayments should never be more than the debt balance entered.',
    sql:`SELECT COUNT(*) AS n FROM debts d WHERE COALESCE(
      (SELECT SUM(p.amount_sen) FROM debt_payments p WHERE p.debt_id=d.id),0)
      > d.starting_balance_sen`
  },
  {
    id:'linked_debts',
    title:'Paid connected instalments have debt entries',
    detail:'Paid financing instalments linked to a debt should reduce that debt exactly once.',
    sql:`SELECT COUNT(*) AS n FROM monthly_commitments c
      WHERE c.status='paid'
       AND (EXISTS(SELECT 1 FROM commitment_debt_links l WHERE l.commitment_id=c.id)
          OR EXISTS(SELECT 1 FROM commitment_debt_links l WHERE l.series_key=c.series_key
            AND c.allocation_month>=l.from_month))
       AND NOT EXISTS(SELECT 1 FROM debt_payments p WHERE p.commitment_id=c.id)`
  },
  {
    id:'income_entries',
    title:'Confirmed income has a matching ledger receipt',
    detail:'An income record marked Received must refer to an actual bank credit.',
    sql:`SELECT COUNT(*) AS n FROM income_receipts r
      LEFT JOIN account_ledger l ON l.id=r.ledger_entry_id
      WHERE r.ledger_entry_id IS NOT NULL
        AND (l.id IS NULL OR l.entry_type<>'income')`
  },
  {
    id:'shared_checks',
    title:'Shared payment statuses stay separate',
    detail:'Your own share must not be counted as money collected from others.',
    sql:`SELECT COUNT(*) AS n FROM shared_members WHERE is_self=1 AND received=1`
  }
];

const countTables = [
  {key:'accounts',table:'accounts'},
  {key:'ledgerEntries',table:'account_ledger'},
  {key:'incomeRecords',table:'income_receipts'},
  {key:'commitments',table:'monthly_commitments'},
  {key:'debts',table:'debts'},
  {key:'sharedCollections',table:'shared_collections'},
  {key:'familyReminders',table:'family_reminders'}
] as const;

export async function safetyRoute(request: Request, env: SafetyEnv, url: URL): Promise<Response|null> {
  if (url.pathname!=='/api/safety/checks') return null;
  if (request.method!=='GET') return Response.json({success:false,error:'Method not allowed.'},{status:405});
  try {
    const counts:Record<string,number>={};
    for(const spec of countTables){
      const record=await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${spec.table}`).first<{n:number}>();
      counts[spec.key]=record?.n??0;
    }
    const results:Check[]=[];
    for(const check of checks){
      const found=await env.DB.prepare(check.sql).first<{n:number}>();
      results.push({id:check.id,title:check.title,detail:check.detail,issues:found?.n??0});
    }
    return Response.json({success:true,counts,checks:results,checkedAt:new Date().toISOString()},
      {headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    console.error('D1 integrity checks failed',error);
    return Response.json({success:false,error:'Unable to run checks. Confirm local D1 migrations through 0009 are applied.'},
      {status:500,headers:{'Cache-Control':'no-store'}});
  }
}
