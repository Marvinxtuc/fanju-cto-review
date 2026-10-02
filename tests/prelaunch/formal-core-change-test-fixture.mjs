import {formalBusinessTestFixture} from './formal-business-test-fixture.mjs';
import {createHash} from 'node:crypto';
import {proposeFormalSupply} from '../../services/api/dist/prelaunch/formal-supply.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
const canonical=value=>JSON.stringify(normal(value));function normal(v){if(Array.isArray(v))return v.map(normal);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,normal(v[k])]));return v;}
export async function coreChangeFixture({normalFulfillment=false,memberCount=4}={}){
 const x=await formalBusinessTestFixture(),users=[];for(let i=0;i<memberCount;i++){const u=await x.user();await x.succeed(u);users.push(u);}
 if(normalFulfillment){
  x.activity=await x.db.activity.update({where:{id:x.activity.id},data:{startsAt:new Date(Date.now()-3*3600000),endsAt:new Date(Date.now()-3600000)}});
  // Move only this owned synthetic fixture's original signup/member clocks too,
  // so its ended activity has genuinely formed historical membership at T24.
  const prior=new Date(x.activity.startsAt.getTime()-25*3600000);
  await x.db.v11Registration.updateMany({where:{id:{in:users.map(u=>u.registration.id)}},data:{acceptedAt:prior}});
  await x.db.v11Membership.updateMany({where:{registrationId:{in:users.map(u=>u.registration.id)}},data:{joinedAt:prior}});
 }

 const original=await x.db.v11SupplyRevision.findFirstOrThrow({where:{activityId:x.activity.id,status:'FORMAL_APPROVED'},include:{activity:{include:{restaurant:true}}}});
 const restaurant=await x.db.restaurant.create({data:{name:'合成候选江边餐厅',district:'合成新区',businessArea:'合成江边商圈',address:'合成候选完整受限地址',contactName:'合成候选联系人',contactPhone:'synthetic-candidate-phone',budgetCents:1000,cuisineTags:[],capacity:4}});
 const actor=await x.db.v11Actor.create({data:{role:'RESTAURANT',personId:x.prefix+'_candidate_supplier',restaurantId:restaurant.id,passwordHash:'EXTERNAL_SESSION_ONLY'}});
 const candidate=await x.db.activity.create({data:{restaurantId:restaurant.id,title:'合成候选菜单体验',theme:'菜单体验',description:'隔离候选供给',district:restaurant.district,businessArea:restaurant.businessArea,startsAt:new Date(Date.now()+76*3600000),endsAt:new Date(Date.now()+78*3600000),registrationEndsAt:new Date(Date.now()+64*3600000),serviceFeeCents:0,mealFeePolicyText:'餐费到店直接支付',capacity:4}});
 // The second controlled restaurant is separately verified by the same formal service;
 // no fake DB approval rows or new authority are substituted.
 const proposal=await proposeFormalSupply(x.db,{...actor,role:'RESTAURANT'},candidate.id,{policyId:x.policy.policyId,businessKey:x.prefix+'_candidate',min:4,target:4,max:4,maxTables:1,strategy:'FILL_TO_TARGET',depositCents:300,waitlistMax:4},async()=>x.f.authority());
 const approved=await x.request('POST','/api/v11/ops/supply-proposals/'+proposal.proposalId+'/approve',x.opsHeaders,{activityFeeCents:null}),newSupply=await x.db.v11SupplyRevision.findUniqueOrThrow({where:{id:approved.supplyId}});
 const snapshot=(s,a,r)=>({scope:'FORMAL_CORE_CHANGE_SNAPSHOT',activityId:a.id,supplyId:s.id,supplyDigest:s.digest,policyId:s.policyId,policyDigest:x.policy.policyDigest,restaurantId:s.restaurantId,restaurantName:r.name,district:r.district,businessArea:r.businessArea,startsAt:a.startsAt.toISOString(),endsAt:a.endsAt.toISOString(),F:s.serviceFeeCents,D:s.depositCents,min:s.minSize,target:s.targetSize,max:s.maxSize,maxTables:s.maxTables});
 const oldSnapshot=snapshot(original,x.activity,original.activity.restaurant),proposedSnapshot=snapshot(newSupply,candidate,restaurant),url='/api/v11/ops/formal/activities/'+x.activity.id+'/core-changes',body={businessKey:x.prefix+'_change',proposedSupplyId:newSupply.id};
 const approval={scope:'FORMAL_CORE_CHANGE_APPROVAL',businessKey:body.businessKey,activityId:x.activity.id,originalSupplyId:original.id,originalSupplyDigest:original.digest,originalSnapshotDigest:hash(canonical(oldSnapshot)),policyDigest:x.policy.policyDigest,proposedSnapshotDigest:hash(canonical(proposedSnapshot)),proposedSupplyId:newSupply.id,professionalSignoff:'APPROVED',supplySignoff:'APPROVED'};
 const signoff={scope:'FORMAL_CORE_CHANGE_PROFESSIONAL_SIGNOFF',businessKey:body.businessKey,activityId:x.activity.id,originalSupplyDigest:original.digest,originalSnapshotDigest:approval.originalSnapshotDigest,proposedSnapshotDigest:approval.proposedSnapshotDigest,conclusion:'APPROVED'};
 function sign(){if(!x.f.grant.actions.includes('CORE_CHANGE_PROPOSE'))x.f.grant.actions.push('CORE_CHANGE_PROPOSE');for(const [responsibility,payload] of [['CORE_CHANGE_PROPOSAL',approval],['CORE_CHANGE_PROFESSIONAL_SIGNOFF',signoff]]){const ref=x.prefix+'_'+responsibility,raw=JSON.stringify(payload);x.f.trust.evidence.set(ref,raw);x.f.grant.evidence=x.f.grant.evidence.filter(e=>e.referenceId!==ref);x.f.grant.evidence.push({referenceId:ref,sha256:hash(raw),responsibility});}}
 return {...x,users,original,candidate,restaurant,newSupply,oldSnapshot,proposedSnapshot,url,body,approval,signoff,sign};
}
