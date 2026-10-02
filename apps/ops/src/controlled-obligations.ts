export type ObligationItem={caseId:string;evidenceConflict:boolean;obligation:null|{amountCents:number;confirmedCents:number;remainingCents:number;state:'AWAITING_EXECUTION'|'EXECUTION_RECORDED'|'CONFIRMED'}};
export type ObligationPage={items:ObligationItem[];nextCursor:string|null};
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('应退记录格式错误');return v as Record<string,unknown>;}
function id(v:unknown):v is string{return typeof v==='string'&&v.length>0&&v.length<=160;}
export function parseObligations(value:unknown):ObligationPage{
 const data=obj(value);if(data.version!=='v11-controlled-obligations-1'||data.scope!=='BOUND_RECORDED_OBLIGATIONS_ONLY'||data.coverage!=='RECORDED_ONLY'||data.releaseAuthorized!==false||!Array.isArray(data.items)||data.items.length>50||(data.nextCursor!==null&&!id(data.nextCursor)))throw Error('应退记录接口不兼容');
 const items=data.items.map((raw):ObligationItem=>{const row=obj(raw);if(!id(row.caseId)||typeof row.evidenceConflict!=='boolean'||row.dispatchAuthorized!==false)throw Error('应退记录格式错误');
  if(row.evidenceConflict){if(row.obligation!==null)throw Error('应退证据冲突');return {caseId:row.caseId,evidenceConflict:true,obligation:null};}
  const due=obj(row.obligation);const amounts=[due.amountCents,due.confirmedCents,due.remainingCents];if(amounts.some(x=>!Number.isSafeInteger(x)||(x as number)<0)||(due.amountCents as number)<=0||(due.confirmedCents as number)+(due.remainingCents as number)!==due.amountCents||!['AWAITING_EXECUTION','EXECUTION_RECORDED','CONFIRMED'].includes(String(due.state))||((due.state==='CONFIRMED')!==(due.remainingCents===0)))throw Error('应退金额或阶段冲突');
  return {caseId:row.caseId,evidenceConflict:false,obligation:{amountCents:due.amountCents as number,confirmedCents:due.confirmedCents as number,remainingCents:due.remainingCents as number,state:due.state as NonNullable<ObligationItem['obligation']>['state']}};
 });if(new Set(items.map(x=>x.caseId)).size!==items.length)throw Error('应退核对项重复');return {items,nextCursor:data.nextCursor as string|null};
}
