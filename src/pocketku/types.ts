export type PaymentStatus = 'unallocated' | 'reserved' | 'paid';
export type Account = {
  id: string;
  name: string;
  bank: string;
  openingCents: number;
  protected: boolean;
  color: string;
};
export type Commitment = {
  id: string;
  month: number;
  name: string;
  amountCents: number;
  category: string;
  seriesId?: string;
  installmentNo?: number;
  installmentTotal?: number;
  dueDate?: string;
  status: PaymentStatus;
  accountId?: string;
};
export type Funding = { id: string; month: number; accountId: string; amountCents: number };
export type Income = { id: string; name: string; amountCents: number; accountId: string; type: 'mara'|'refund'|'other'; month?: number };
export type Transfer = { id: string; fromId: string; toId: string; amountCents: number; note: string };
export type Settlement = { id: string; name: string; amountCents: number; financingSeries?: string; status: PaymentStatus; accountId?: string };
export type SharedMember = { id: string; name: string; amountCents: number; received: boolean; self?: boolean };
export type SharedCollection = { id: string; name: string; month: string; members: SharedMember[] };
export type Reminder = { id: string; name: string; amountCents: number; date: string; frequency: 'Monthly'|'Yearly'|'One-time'; paid: boolean };
export type FinanceData = {
  version: 1;
  accounts: Account[];
  commitments: Commitment[];
  funding: Funding[];
  income: Income[];
  transfers: Transfer[];
  settlements: Settlement[];
  shared: SharedCollection[];
  reminders: Reminder[];
};
// Allow navigation through future commitment schedules without changing the DB.
// Timeline independently shows *all* recorded months, even beyond this UI range.
export const monthNames: string[] = Array.from({length:120},(_,i)=>
  new Date(Date.UTC(2026,9+i,1)).toLocaleDateString('en-MY',{month:'short',year:'numeric',timeZone:'UTC'}));
export const amount = (cents: number) => 'RM ' + (cents / 100).toLocaleString('en-MY', {minimumFractionDigits:2,maximumFractionDigits:2});
export const toCents = (numberValue: number|string) => Math.round(Number(numberValue) * 100);
export const fromCents = (cents: number) => (cents / 100).toFixed(2);
export const uid = () => 'pk_'+Math.random().toString(36).slice(2,11)+'_'+Date.now().toString(36);
