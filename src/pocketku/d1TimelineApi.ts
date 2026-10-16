export type TimelineMonth={period:string;count:number;planned_sen:number;reserved_sen:number;paid_sen:number;unallocated_sen:number};
export async function getCommitmentTimeline():Promise<TimelineMonth[]>{
 const response=await fetch('/api/commitments/timeline',{cache:'no-store'});
 const json=await response.json() as {success?:boolean;months?:TimelineMonth[];error?:string};
 if(!response.ok||json.success!==true||!Array.isArray(json.months))throw new Error(json.error||'Could not load commitments.');
 return json.months;
}
