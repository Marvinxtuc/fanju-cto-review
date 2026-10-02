import {formalBusinessTestFixture} from '../prelaunch/formal-business-test-fixture.mjs';
import {verifyOwnedEnvironment,TASK_ID} from '../../scripts/prelaunch-owned-env.mjs';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
const {runtime}=await verifyOwnedEnvironment(dirname(process.env.PRELAUNCH_ENV_FILE??''));
const x=await formalBusinessTestFixture(),users=[];
for(let i=0;i<4;i++){const u=await x.user();await x.succeed(u);users.push(u);}
const normalIntersection=process.env.RESPONSIBILITY_NORMAL_INTERSECTION==='true';let normalRequestId;
const financialSnapshot=async()=>JSON.stringify({activity:await x.db.activity.findUnique({where:{id:x.activity.id}}),regs:await x.db.v11Registration.findMany({where:{id:{in:users.map(u=>u.registration.id)}},orderBy:{id:'asc'}}),members:await x.db.v11Membership.findMany({where:{registrationId:{in:users.map(u=>u.registration.id)}},orderBy:{id:'asc'}}),seats:await x.db.v11SeatHold.findMany({where:{registrationId:{in:users.map(u=>u.registration.id)}},orderBy:{id:'asc'}}),tables:await x.db.v11Table.findMany({where:{activityId:x.activity.id},orderBy:{id:'asc'}}),dispositions:await x.db.v11Disposition.findMany({where:{sourceRef:normalRequestId??'none'},orderBy:{id:'asc'}}),instructions:await x.db.v11RefundInstruction.findMany({where:{registrationId:{in:users.map(u=>u.registration.id)}},orderBy:{id:'asc'}})});
if(normalIntersection){const ids=users.map(u=>u.registration.id);await x.db.activity.update({where:{id:x.activity.id},data:{startsAt:new Date(Date.now()-3*3600000),endsAt:new Date(Date.now()-3600000)}});await x.db.v11Registration.updateMany({where:{id:{in:ids}},data:{acceptedAt:new Date(Date.now()-29*3600000)}});await x.db.v11Membership.updateMany({where:{registrationId:{in:ids}},data:{joinedAt:new Date(Date.now()-29*3600000)}});const normal=await x.request('POST','/api/v11/restaurant/formal/registrations/'+ids[0]+'/fulfillment',x.restHeaders,{result:'NORMAL'});normalRequestId=normal.requestId;await x.request('POST','/api/v11/ops/formal/refund-requests/'+normal.requestId+'/decide',x.opsHeaders,{});}
const beforeDigest=createHash('sha256').update(await financialSnapshot()).digest('hex');
await x.app.listen({host:'127.0.0.1',port:0});
const port=x.app.server.address().port;
process.send?.({type:'PRELAUNCH_READY',task_id:TASK_ID,owner_id:runtime.owner_id,pid:process.pid,port,
 normalIntersection,activityId:x.activity.id,password:x.password,opsUsername:x.ops.id,restaurantUsername:x.rest.id});
process.on('message',async m=>{
 if(m?.type==='COUNTS'){
  const ids=users.map(u=>u.registration.id),dues=await x.db.v11Request.findMany({where:{registrationId:{in:ids},kind:'FORMAL_MANDATORY_REFUND'}});
  process.send?.({type:'COUNTS',normalIntersection,beforeDigest,afterDigest:createHash('sha256').update(await financialSnapshot()).digest('hex'),reviews:await x.db.v11Request.count({where:{kind:'FORMAL_RESPONSIBILITY_CANCELLATION',state:'AWAITING_FULFILLMENT_RIGHTS_REVIEW',payload:{path:['activityId'],equals:x.activity.id}}}),activityState:(await x.db.activity.findUniqueOrThrow({where:{id:x.activity.id}})).status,
   activeMembers:await x.db.v11Membership.count({where:{registrationId:{in:ids},active:true}}),mandatoryDuties:dues.length,
   compensationAmounts:dues.map(d=>d.payload.compensationAmount??null),rightsSnapshots:await x.db.auditLog.count({where:{action:'refund.v11-responsibility-rights',targetId:{in:dues.map(d=>d.id)}}}),
   refundInstructions:await x.db.v11RefundInstruction.count({where:{registrationId:{in:ids}}})});
 }
});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await x.close();process.exit(0);});
