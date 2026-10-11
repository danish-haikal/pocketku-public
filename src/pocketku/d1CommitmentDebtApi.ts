/** Read and configure automatic debt connections for D1 monthly instalments. */
export interface DebtOption { id:number;name:string;creditor:string;remaining_sen:number }
export interface CommitmentDebtLink {
  commitment_id:number;debt_id:number;debt_name:string;
  principal_sen:number|null;scope:'one'|'future';
}
async function request(url:string,init?:RequestInit):Promise<Record<string,unknown>>{
  const response=await fetch(url,{cache:'no-store',...init});
  let data:Record<string,unknown>;
  try{data=await response.json() as Record<string,unknown>}
  catch{throw new Error('Debt connection API unavailable. Ensure local Worker and migration 0008 are ready.')}
  if(!response.ok||data.success!==true)
    throw new Error(typeof data.error==='string'?data.error:'Unable to save debt connection.');
  return data;
}
export async function getD1DebtConnections(month:string):Promise<{links:CommitmentDebtLink[];debts:DebtOption[]}>{
  const data=await request('/api/commitment-debt-links?month='+encodeURIComponent(month));
  if(!Array.isArray(data.links)||!Array.isArray(data.debts))throw new Error('Unexpected debt connection data.');
  return {links:data.links as CommitmentDebtLink[],debts:data.debts as DebtOption[]};
}
export async function connectD1Debt(commitmentId:number,debtId:number,scope:'one'|'future',principalSen:number|null){
  await request('/api/commitment-debt-links',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({commitment_id:commitmentId,debt_id:debtId,scope,principal_sen:principalSen})
  });
}
export async function disconnectD1Debt(commitmentId:number){
  await request('/api/commitment-debt-links/'+commitmentId,{method:'DELETE'});
}
