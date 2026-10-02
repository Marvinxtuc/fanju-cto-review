import {createHash} from 'node:crypto';
import type {Prisma} from '../generated/prisma/client.js';
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))??'null').digest('hex');
// Validate the committed v4 audit envelope for range/recovery consumers.
// Only the finalizer may create this envelope after validating all page evidence.
export function validBillPageFinalEvidence(value:unknown){
 const row=object(value),identity=object(row.identity),result=object(row.result),coverage=object(row.pageCoverage),lengths=object(coverage.lengths);
 if(identity.comparisonVersion!=='v11-bill-snapshot-4'||coverage.version!=='v11-bill-pages-1'||coverage.pageSize!==500||typeof coverage.snapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(coverage.snapshotHash)||typeof coverage.manifestHash!=='string'||!/^[a-f0-9]{64}$/.test(coverage.manifestHash))return false;
 const phases=['FORWARD','REVERSE_RECEIPTS','REVERSE_REFUNDS'];
 if(Object.keys(lengths).length!==3||phases.some(key=>!Number.isSafeInteger(lengths[key])||Number(lengths[key])<0||Number(lengths[key])>100000)||coverage.pageCount!==phases.reduce((n,key)=>n+Math.ceil(Number(lengths[key])/500),0))return false;
 for(const key of ['totalBillRows','outsideApplicationRows','applicationPaymentRows','applicationRefundRows','legacyRows','differences','paymentQueriesQueued','refundQueriesQueued','recordedPaymentRowsInPeriod','confirmedRefundsWithoutTrustedPeriod','confirmedRefundsInPeriod','refundTimeConflicts'])if(!Number.isSafeInteger(result[key])||Number(result[key])<0||Number(result[key])>1000000)return false;
 if(result.totalBillRows!==lengths.FORWARD||Number(result.applicationPaymentRows)+Number(result.applicationRefundRows)+Number(result.outsideApplicationRows)!==result.totalBillRows||Number(result.recordedPaymentRowsInPeriod)>Number(lengths.REVERSE_RECEIPTS)||Number(result.confirmedRefundsInPeriod)>Number(lengths.REVERSE_REFUNDS)||Number(result.legacyRows)>Number(result.applicationPaymentRows)+Number(result.applicationRefundRows)||Number(result.refundTimeConflicts)>Number(result.confirmedRefundsWithoutTrustedPeriod)||!['OBSERVED','UNRESOLVED'].includes(String(result.refundPeriodCoverage))||result.refundPeriodCoverage!==(result.confirmedRefundsWithoutTrustedPeriod===0?'OBSERVED':'UNRESOLVED'))return false;
 for(const key of ['caseIds','paymentQueryRefs','refundQueryRefs']){const refs=row[key];if(!Array.isArray(refs)||refs.length>1000000||new Set(refs).size!==refs.length||refs.some(x=>typeof x!=='string'||!x||x.length>160))return false;}
 if((row.caseIds as unknown[]).length>Number(result.differences)||(row.paymentQueryRefs as unknown[]).length!==result.paymentQueriesQueued||(row.refundQueryRefs as unknown[]).length!==result.refundQueriesQueued)return false;
 const keys=['identity','result','caseIds','paymentQueryRefs','refundQueryRefs','pageCoverage'];
 return row.finalHash===hash(Object.fromEntries(keys.map(key=>[key,row[key]])));
}

export async function verifyBillPageFinalStorage(tx:Prisma.TransactionClient,runId:string,value:unknown){
 if(!validBillPageFinalEvidence(value))throw Error('Bill final storage envelope invalid');
 const row=object(value),identity=object(row.identity),binding=object(identity.binding),coverage=object(row.pageCoverage),result=object(row.result);
 const snapshot=await tx.v11BillComparisonSnapshot.findUnique({where:{id:runId}});
 if(!snapshot||snapshot.snapshotHash!==coverage.snapshotHash||hash(snapshot.snapshot)!==snapshot.snapshotHash||snapshot.sourceSha256!==identity.sourceSha256||snapshot.billDate!==identity.billDate||snapshot.owner!==identity.owner||snapshot.releaseVersion!==identity.releaseVersion||snapshot.merchantScope!==binding.merchantScope||snapshot.providerConfigId!==binding.providerConfigId||result.runId!==runId)throw Error('Bill final storage snapshot conflict');
 const pages=await tx.v11BillComparisonPage.findMany({where:{snapshotId:runId}}),lengths=object(coverage.lengths),manifest=[];
 const cases=new Set<string>(),payment=new Set<string>(),refund=new Set<string>();
 const sums=Object.fromEntries(['applicationPaymentRows','applicationRefundRows','legacyRows','differences','recordedPaymentRowsInPeriod','confirmedRefundsInPeriod'].map(key=>[key,0]));
 if(pages.length!==coverage.pageCount)throw Error('Bill final storage page gap');
 for(const phase of ['FORWARD','REVERSE_RECEIPTS','REVERSE_REFUNDS'])for(let start=0;start<Number(lengths[phase]);start+=500){
  const page=pages.find(x=>x.phase===phase&&x.start===start),end=Math.min(start+500,Number(lengths[phase]));
  if(!page||page.end!==end||page.snapshotHash!==snapshot.snapshotHash||page.contentHash!==hash({version:'v11-bill-page-1',snapshotHash:page.snapshotHash,phase:page.phase,start:page.start,end:page.end,result:page.result,caseIds:page.caseIds,paymentQueryRefs:page.paymentQueryRefs,refundQueryRefs:page.refundQueryRefs}))throw Error('Bill final storage page conflict');
  const stats=object(page.result);for(const key of Object.keys(sums)){if(!Number.isSafeInteger(stats[key])||Number(stats[key])<0)throw Error('Bill final storage count conflict');sums[key]!+=Number(stats[key]);}
  for(const id of page.caseIds)cases.add(id);for(const id of page.paymentQueryRefs)payment.add(id);for(const id of page.refundQueryRefs)refund.add(id);
  manifest.push({phase,start,end,contentHash:page.contentHash});
 }
 if(hash(manifest)!==coverage.manifestHash||Object.entries(sums).some(([key,n])=>result[key]!==n)||hash([...cases].sort())!==hash(row.caseIds)||hash([...payment].sort())!==hash(row.paymentQueryRefs)||hash([...refund].sort())!==hash(row.refundQueryRefs))throw Error('Bill final storage aggregate conflict');
 const ids=[...cases];for(let at=0;at<ids.length;at+=500){const found=await tx.financialCase.findMany({where:{id:{in:ids.slice(at,at+500)}},select:{category:true,sourceRef:true,caseKey:true}});if(found.length!==Math.min(500,ids.length-at)||found.some(x=>!x.category.startsWith('V11_BILL_')||x.caseKey!==x.category+':'+hash([runId,x.sourceRef])))throw Error('Bill final storage case missing');}
 for(const [kind,refs] of [['payment',[...payment]],['refund',[...refund]]] as const)for(let at=0;at<refs.length;at+=500){const expected=refs.slice(at,at+500).map(refId=>({refId,businessKey:`v11:bill-query:${runId}:${kind}:${refId}`}));const found=await tx.durableJob.findMany({where:{businessKey:{in:expected.map(x=>x.businessKey)}},select:{businessKey:true,refId:true,kind:true}});if(found.length!==expected.length||expected.some(x=>!found.some(j=>j.businessKey===x.businessKey&&j.refId===x.refId&&j.kind===(kind==='payment'?'V11_QUERY_PAYMENT':'V11_QUERY_REFUND'))))throw Error('Bill final storage query missing');}
 const events=await tx.receivedEvent.findMany({where:{source:'wechat-bill-observation-v11',merchantScope:snapshot.merchantScope,eventKey:{startsWith:`BILL:${snapshot.sourceSha256}:`}},select:{payloadHash:true,normalizedPayload:true,state:true,verificationMaterialId:true}});
 if(events.length!==Number(result.applicationPaymentRows)+Number(result.applicationRefundRows)||events.some(x=>x.state!=='MANUAL'||x.verificationMaterialId!==snapshot.providerConfigId||hash(x.normalizedPayload)!==x.payloadHash))throw Error('Bill final storage observation missing');
}
