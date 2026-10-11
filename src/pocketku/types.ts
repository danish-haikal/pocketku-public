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
export const monthNames = [
  'Oct 2026','Nov 2026','Dec 2026','Jan 2027','Feb 2027','Mar 2027',
  'Apr 2027','May 2027','Jun 2027','Jul 2027','Aug 2027','Sep 2027',
  'Oct 2027','Nov 2027','Dec 2027','Jan 2028','Feb 2028','Mar 2028',
  'Apr 2028','May 2028','Jun 2028','Jul 2028'
] as const;
export const amount = (cents: number) => 'RM ' + (cents / 100).toLocaleString('en-MY', {minimumFractionDigits:2,maximumFractionDigits:2});
export const toCents = (numberValue: number|string) => Math.round(Number(numberValue) * 100);
export const fromCents = (cents: number) => (cents / 100).toFixed(2);
export const uid = () => 'pk_'+Math.random().toString(36).slice(2,11)+'_'+Date.now().toString(36);
