/** One-time financing setup. No bank balance is changed here. */
export type FinancingSeries={
  series_key:string;name:string;first_month:string;unpaid_count:number;
  minimum_sen:number;maximum_sen:number;future_total_sen:number;
  first_installment:number|null;installment_total:number|null;
};
export type FinancingDebt={id:number;name:string;creditor:string;remaining_sen:number};
export type FinancingInput={
  setup_id:string;mode:'existing'|'new';debt_mode:'existing'|'new';start_month:string;
  debt_id?:number;debt_name?:string;creditor?:string;outstanding_sen?:number;
  as_of_date?:string;note?:string;principal_sen:number|null;
  series_key?:string;name?:string;monthly_amount_sen?:number;
  current_installment?:number;installment_total?:number;due_day?:number;
};
export type FinancingResult={name:string;month:string;series_key:string;created_count:number};
async function jsonApi(url:string,init?:RequestInit):Promise<Record<string,unknown>>{
  const response=await fetch(url,{cache:'no-store',...init});
  let data:Record<string,unknown>;
  try{data=await response.json() as Record<string,unknown>}
  catch{throw new Error('Financing API unavailable. Check the local Worker.');}
  if(!response.ok||data.success!==true)throw new Error(typeof data.error==='string'?data.error:'Financing setup failed.');
  return data;
}
export async function readFinancingOptions(month:string){
  const data=await jsonApi('/api/financing/setup-options?month='+encodeURIComponent(month));
  if(!Array.isArray(data.series)||!Array.isArray(data.debts))throw new Error('Unexpected financing options.');
  return {series:data.series as FinancingSeries[],debts:data.debts as FinancingDebt[]};
}
export async function setupFinancing(input:FinancingInput):Promise<FinancingResult>{
  const data=await jsonApi('/api/financing/setup',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  return {name:String(data.name),month:String(data.month),series_key:String(data.series_key),
    created_count:Number(data.created_count)};
}
