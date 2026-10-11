import type {FinanceData, Commitment, PaymentStatus} from './types';

/** A financing that has been fully settled after the November 2026 allocation
 * no longer creates December 2026 or later monthly bills. */
export function isVisible(bill: Commitment, data: FinanceData): boolean {
  if (bill.month < 2 || !bill.seriesId) return true;
  return !data.settlements.some(s => s.financingSeries === bill.seriesId && s.status === 'paid');
}
export const billsFor = (d: FinanceData, month: number) => d.commitments.filter(b=>b.month===month && isVisible(b,d));
export const monthTarget = (d: FinanceData, m: number) => billsFor(d,m).reduce((sum,b)=>sum+b.amountCents,0);
export function cashBalance(d: FinanceData, accountId: string): number {
  const account = d.accounts.find(a=>a.id===accountId);
  if(!account)return 0;
  const incoming = d.income.filter(i=>i.accountId===accountId).reduce((s,i)=>s+i.amountCents,0);
  const sent = d.transfers.filter(t=>t.fromId===accountId).reduce((s,t)=>s+t.amountCents,0);
  const transfersIn = d.transfers.filter(t=>t.toId===accountId).reduce((s,t)=>s+t.amountCents,0);
  const billPayments = d.commitments.filter(b=>b.accountId===accountId && b.status==='paid').reduce((s,b)=>s+b.amountCents,0);
  const loanPayments = d.settlements.filter(x=>x.accountId===accountId && x.status==='paid').reduce((s,x)=>s+x.amountCents,0);
  return account.openingCents+incoming+transfersIn-sent-billPayments-loanPayments;
}
/**
 * Monthly money-source funding is a reserved envelope, not a second charge.
 * Individual bill reservations are contained inside that envelope when possible.
 * The max() per account + month avoids counting the same earmarked money twice.
 */
export function reservedBalance(d: FinanceData, accountId: string): number {
  let total = 0;
  const months = new Set<number>([
    ...d.funding.filter(x=>x.accountId===accountId).map(x=>x.month),
    ...d.commitments.filter(x=>x.accountId===accountId && x.status==='reserved').map(x=>x.month),
  ]);
  for(const month of months){
    const funding = d.funding.filter(f=>f.accountId===accountId && f.month===month).reduce((s,f)=>s+f.amountCents,0);
    const paid = d.commitments.filter(b=>b.accountId===accountId && b.month===month && b.status==='paid').reduce((s,b)=>s+b.amountCents,0);
    const reserved = d.commitments.filter(b=>b.accountId===accountId && b.month===month && b.status==='reserved').reduce((s,b)=>s+b.amountCents,0);
    total += Math.max(0, funding-paid, reserved);
  }
  total += d.settlements.filter(s=>s.accountId===accountId&&s.status==='reserved').reduce((sum,s)=>sum+s.amountCents,0);
  return total;
}
export const freeBalance = (d: FinanceData, id: string) => cashBalance(d,id)-reservedBalance(d,id);
export const totalCash = (d: FinanceData) => d.accounts.reduce((sum,a)=>sum+cashBalance(d,a.id),0);
export const totalReserved = (d: FinanceData) => d.accounts.reduce((sum,a)=>sum+reservedBalance(d,a.id),0);
export function billStatusSum(d: FinanceData,m:number,status:PaymentStatus){return billsFor(d,m).filter(b=>b.status===status).reduce((s,b)=>s+b.amountCents,0)}
export function allocatedFunding(d:FinanceData,m:number){return d.funding.filter(f=>f.month===m).reduce((s,f)=>s+f.amountCents,0)}
export function validateFinances(d: FinanceData): string | null {
  for(const account of d.accounts){
    if(cashBalance(d,account.id)<0)return `${account.name} would have a negative cash balance.`;
    if(freeBalance(d,account.id)<0)return `${account.name} would have more reserved money than it contains.`;
  }
  return null;
}
