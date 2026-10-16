/** Income API. All incoming cash is persisted server-side. */
export interface D1IncomeRecord {
  id: number;
  income_key: string;
  source_name: string;
  income_type: 'mara' | 'refund' | 'family' | 'other';
  period: string | null;
  expected_amount_sen: number | null;
  expected_date: string | null;
  ledger_entry_id: number | null;
  received_at: string | null;
  receiving_account_id: number | null;
  receiving_account_name: string | null;
  received_amount_sen: number | null;
}

function objectResponse(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Income API returned an invalid response.');
  }
  return value as Record<string, unknown>;
}

export async function getD1Income(): Promise<D1IncomeRecord[]> {
  const response = await fetch('/api/income', { cache: 'no-store' });
  let body: Record<string, unknown>;
  try { body = objectResponse(await response.json()); }
  catch { throw new Error('Income API did not return valid JSON. Is the Worker running?'); }
  if (!response.ok || body.success !== true || !Array.isArray(body.income)) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Could not load income records.');
  }
  const records = body.income as unknown[];
  for (const item of records) {
    const row = item as Partial<D1IncomeRecord> | null;
    if (!row || typeof row.income_key !== 'string' ||
        typeof row.source_name !== 'string' ||
        (row.ledger_entry_id !== null && !Number.isSafeInteger(row.ledger_entry_id))) {
      throw new Error('Income API returned a record in an unexpected format.');
    }
  }
  return records as D1IncomeRecord[];
}

export interface ConfirmIncomeInput {
  income_key: string;
  account_id: number;
  amount_sen: number;
}
export interface ConfirmIncomeResult {
  already_received: boolean;
  ledger_entry_id: number;
  account_id: number;
  amount_sen: number;
}
export async function confirmD1Income(input: ConfirmIncomeInput): Promise<ConfirmIncomeResult> {
  const response = await fetch('/api/income/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  let body: Record<string, unknown>;
  try { body = objectResponse(await response.json()); }
  catch { throw new Error('Income confirmation API did not return valid JSON.'); }
  if (!response.ok || body.success !== true ||
      typeof body.ledger_entry_id !== 'number') {
    throw new Error(typeof body.error === 'string' ? body.error : 'Income confirmation failed.');
  }
  return {
    already_received: body.already_received === true,
    ledger_entry_id: body.ledger_entry_id,
    account_id: Number(body.account_id),
    amount_sen: Number(body.amount_sen),
  };
}


export interface UpdateIncomeEstimateInput {
  income_key: string;
  expected_amount_sen: number;
  expected_date: string | null;
}

/** Update only the planned amount/date of an as-yet-unreceived income item. */
export async function updateD1IncomeEstimate(input: UpdateIncomeEstimateInput): Promise<void> {
  const response = await fetch('/api/income/estimate', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  let body: Record<string, unknown>;
  try { body = objectResponse(await response.json()); }
  catch { throw new Error('Income estimate API did not return valid JSON.'); }
  if (!response.ok || body.success !== true) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Could not update expected income.');
  }
}


/** An additional future income plan. Does NOT record cash or bank movements. */
export interface CreateExpectedIncomeInput {
  income_key: string;
  source_name: string;
  income_type: D1IncomeRecord['income_type'];
  period: string;
  expected_amount_sen: number | null;
  expected_date: string | null;
}

export async function createD1ExpectedIncome(input: CreateExpectedIncomeInput): Promise<{already_exists:boolean}> {
  const response=await fetch('/api/income', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(input),
  });
  let body:Record<string,unknown>;
  try { body=objectResponse(await response.json()); }
  catch { throw new Error('Create expected income API did not return valid JSON.'); }
  if (!response.ok || body.success!==true) {
    throw new Error(typeof body.error==='string'?body.error:'Unable to create expected income.');
  }
  return {already_exists:body.already_exists===true};
}
