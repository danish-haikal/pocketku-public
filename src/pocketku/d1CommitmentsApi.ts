/** PocketKu D1 monthly planner, funding splits, reservations and paid expenses. */
export interface D1Commitment {
  id:number;
  creation_key:string;
  series_key:string|null;
  allocation_month:string;
  name:string;
  category:string;
  amount_sen:number;
  due_date:string|null;
  installment_no:number|null;
  installment_total:number|null;
  status:'unallocated'|'reserved'|'paid';
}
export interface CommitmentDraft {
  name:string;category:string;amount_sen:number;due_date:string|null;
  installment_no:number|null;installment_total:number|null;
}
export interface CreateCommitmentInput extends CommitmentDraft {
  request_id:string;start_month:string;end_month:string;
}
export interface SeedCommitmentInput extends CommitmentDraft {
  creation_key:string;series_key:string|null;allocation_month:string;
}
async function jsonApi(url:string,init?:RequestInit):Promise<Record<string,unknown>>{
  const response=await fetch(url,{cache:'no-store',...init});
  let data:Record<string,unknown>;
  try {data=await response.json() as Record<string,unknown>}
  catch {throw new Error('Monthly D1 API did not return JSON. Check the local Worker.');}
  if(!response.ok||data.success!==true){
    throw new Error(typeof data.error==='string'?data.error:'Monthly D1 request failed.');
  }
  return data;
}
const body=(payload:unknown):RequestInit=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
export async function getD1Commitments(month:string):Promise<D1Commitment[]> {
  const res=await jsonApi('/api/commitments?month='+encodeURIComponent(month));
  if(!Array.isArray(res.commitments))throw new Error('Unexpected monthly commitments response.');
  return res.commitments as D1Commitment[];
}
export async function createD1Commitment(input:CreateCommitmentInput):Promise<void>{
  await jsonApi('/api/commitments',{method:'POST',...body(input)});
}
export async function updateD1Commitment(id:number,draft:CommitmentDraft,scope:'one'|'future'):Promise<void>{
  await jsonApi('/api/commitments/'+id,{method:'PATCH',...body({...draft,scope})});
}
export async function deleteD1Commitment(id:number,scope:'one'|'future'):Promise<void>{
  await jsonApi('/api/commitments/'+id,{method:'DELETE',...body({scope})});
}
export async function importD1DemoCommitments(records:SeedCommitmentInput[]):Promise<{inserted:number;skipped:number}>{
  const result=await jsonApi('/api/commitments/import-demo',{method:'POST',...body(records)});
  return {inserted:Number(result.inserted||0),skipped:Number(result.skipped||0)};
}

export interface D1FundingSplit {
  commitment_id:number;
  account_id:number;
  amount_sen:number;
  account_name:string;
  is_protected:0|1;
}
export async function getD1Funding(month:string):Promise<D1FundingSplit[]> {
  const data=await jsonApi('/api/commitments/funding?month='+encodeURIComponent(month));
  if(!Array.isArray(data.funding))throw new Error('Unexpected funding response.');
  return data.funding as D1FundingSplit[];
}
export async function assignD1Funding(commitmentId:number,accountId:number,amountSen:number):Promise<void>{
  await jsonApi(`/api/commitments/${commitmentId}/funding`,{method:'PUT',...body({account_id:accountId,amount_sen:amountSen})});
}
export async function removeD1Funding(commitmentId:number,accountId:number):Promise<void>{
  await jsonApi(`/api/commitments/${commitmentId}/funding/${accountId}`,{method:'DELETE'});
}
export async function changeD1CommitmentStatus(
  commitmentId:number,status:'unallocated'|'reserved'|'paid',acknowledgeProtected=false,
):Promise<{already_set:boolean}>{
  const data=await jsonApi(`/api/commitments/${commitmentId}/status`,{
    method:'POST',...body({status,acknowledge_protected:acknowledgeProtected}),
  });
  return {already_set:data.already_set===true};
}
