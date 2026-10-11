/** PocketKu local D1 Accounts API — development-only integration. */
export interface D1AccountRecord {
  id: number;
  name: string;
  bank_name: string;
  account_type: 'bank' | 'tabung';
  opening_balance_sen: number;
  current_balance_sen: number; // Calculated from the D1 account_ledger table.
  reserved_balance_sen: number; // Held by reserved D1 commitments, not cash deductions.
  is_protected: 0 | 1;
  is_active: 0 | 1;
}
export interface NewD1Account {
  name: string;
  bank_name: string;
  account_type: 'bank' | 'tabung';
  opening_balance_sen: number;
  is_protected: 0 | 1;
}

export async function getD1Accounts(): Promise<D1AccountRecord[]> {
  const response = await fetch('/api/accounts', { cache: 'no-store' });
  const json: unknown = await response.json();
  if (!response.ok || !json || typeof json !== 'object') {
    throw new Error('Could not load accounts from local D1.');
  }
  const body = json as Record<string, unknown>;
  if (body.success !== true || !Array.isArray(body.accounts)) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Unexpected Accounts API response.');
  }
  // Never silently fall back to the opening balance: that would hide
  // actual transfers and show stale account amounts in the dashboard.
  for (const row of body.accounts) {
    if (
      !row || typeof row !== 'object' ||
      !Number.isSafeInteger(row.current_balance_sen) ||
      !Number.isSafeInteger(row.opening_balance_sen)
    ) {
      throw new Error('Accounts API is missing ledger-calculated balances. Check GET /api/accounts.');
    }
  }
  return body.accounts as D1AccountRecord[];
}

export async function createD1Account(account: NewD1Account): Promise<number> {
  const response = await fetch('/api/accounts', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(account),
  });
  const json: unknown = await response.json();
  if (!json || typeof json !== 'object') throw new Error('Invalid response from Accounts API.');
  const body = json as Record<string, unknown>;
  if (!response.ok || body.success !== true || typeof body.id !== 'number') {
    throw new Error(typeof body.error === 'string' ? body.error : 'Account could not be saved to D1.');
  }
  return body.id;
}

/** Record an internal transfer between TWO actual D1 accounts. */
export interface NewD1Transfer {
  from_account_id: number;
  to_account_id: number;
  amount_sen: number;
  note: string;
  request_id: string;
  acknowledge_protected: boolean;
}
export async function createD1Transfer(transfer: NewD1Transfer): Promise<number> {
  const response=await fetch('/api/transfers',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(transfer),
  });
  let body:Record<string,unknown>;
  try { body=(await response.json()) as Record<string,unknown>; }
  catch { throw new Error('Transfer API did not return valid JSON. Check the local Worker.'); }
  if (!response.ok || body.success!==true || typeof body.id!=='number') {
    throw new Error(typeof body.error==='string'?body.error:'Transfer was not saved.');
  }
  return body.id;
}
