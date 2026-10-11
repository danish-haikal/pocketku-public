/** Persistent PocketKu debts. Direct repayments debit once; linked instalments don't. */
export interface D1Debt {
  id:number;creation_key:string;name:string;creditor:string;
  starting_balance_sen:number;as_of_date:string;note:string;
  repaid_sen:number;remaining_sen:number;created_at:string;
}
export interface D1DebtPayment {
  id:number;payment_key:string;debt_id:number;mode:'direct'|'commitment';
  amount_sen:number;account_id:number|null;account_name:string|null;
  commitment_id:number|null;commitment_name:string|null;
  ledger_entry_id:number|null;paid_on:string;note:string;
}
export interface PaidCommitment {
  id:number;name:string;allocation_month:string;amount_sen:number;paid_sen:number;
}
export interface CreateDebt {
  creation_key:string;name:string;creditor:string;
  starting_balance_sen:number;as_of_date:string;note:string;
}
export type DebtPaymentDraft={
  payment_key:string;mode:'direct'|'commitment';amount_sen:number;
  account_id:number|null;commitment_id:number|null;
  paid_on:string;note:string;acknowledge_protected:boolean;
};
async function api(url:string, init?:RequestInit):Promise<Record<string,unknown>> {
  const response=await fetch(url,{cache:'no-store',...init});
  let data:Record<string,unknown>;
  try {data=await response.json() as Record<string,unknown>}
  catch {throw new Error('D1 debt API did not return JSON. Check that the Worker is running.');}
  if(!response.ok || data.success!==true)
    throw new Error(typeof data.error==='string'?data.error:'Debt request failed.');
  return data;
}
const json=(value:unknown)=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
export async function readD1Debts():Promise<{debts:D1Debt[];payments:D1DebtPayment[]}>{
  const data=await api('/api/debts');
  if(!Array.isArray(data.debts)||!Array.isArray(data.payments))throw new Error('Unexpected debt response.');
  return {debts:data.debts as D1Debt[],payments:data.payments as D1DebtPayment[]};
}
export async function readEligibleDebtCommitments():Promise<PaidCommitment[]>{
  const data=await api('/api/debts/paid-commitments');
  if(!Array.isArray(data.commitments))throw new Error('Unexpected paid commitments response.');
  return data.commitments as PaidCommitment[];
}
export async function createD1Debt(body:CreateDebt):Promise<void>{
  await api('/api/debts',{method:'POST',...json(body)});
}
export async function editD1Debt(id:number,body:Pick<CreateDebt,'name'|'creditor'|'note'|'starting_balance_sen'>):Promise<void>{
  await api(`/api/debts/${id}`,{method:'PATCH',...json(body)});
}
export async function postD1DebtPayment(id:number,body:DebtPaymentDraft):Promise<void>{
  await api(`/api/debts/${id}/payments`,{method:'POST',...json(body)});
}
