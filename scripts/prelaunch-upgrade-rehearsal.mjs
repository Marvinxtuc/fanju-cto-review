// Complete SQL chain on a fresh owned database; synthetic historical rows only.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {root,createOwnedDatabase} from './prelaunch-owned-env.mjs';
import {captureCandidate} from './prelaunch-candidate-hash.mjs';
const [scratch]=process.argv.slice(2);if(!scratch)throw Error('Owned scratch required');
const candidate=captureCandidate(root);
const {runtime,evidence}=await createOwnedDatabase(scratch,'empty',{fresh:true});
const {Client}=createRequire(resolve(root,'services/api/package.json'))('pg');
const db=new Client({connectionString:runtime.database_url});await db.connect();
const dir=resolve(root,'docs/prelaunch/launch-readiness/evidence/upgrade-'+new Date().toISOString().replaceAll(/[:.]/g,'-'));mkdirSync(dir,{recursive:true});
const migrations=readdirSync(resolve(root,'prisma/migrations')).filter(n=>/^\d+_/.test(n)).sort();
const split=migrations.indexOf('20261001010000_v11_payment_preparation');assert.equal(split,14);
const applied=[];
async function apply(name){const sql=readFileSync(resolve(root,'prisma/migrations',name,'migration.sql'),'utf8');await db.query(sql);applied.push({name,sha256:createHash('sha256').update(sql).digest('hex')});}
const tables=['ChannelReceipt','V11RefundInstruction','V11FundComponent','V11Disposition','ReceivedEvent','DurableJob'];
async function snapshot(){const rows={};for(const table of tables)rows[table]=(await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;return rows;}
try{
 for(const name of migrations.slice(0,split))await apply(name);
 for(const [i,state]of ['NEW','SUBMITTING','UNKNOWN','CONFIRMED'].entries()){
  const id='synthetic_upgrade_'+i;
  await db.query(`INSERT INTO "ChannelReceipt" (id,channel,"merchantScope","channelTradeNo","merchantOrderNo","amountCents","evidenceHash","verifiedAt","paidAt") VALUES ($1,'mock','mock-local',$2,$3,100,'synthetic-hash',now(),now())`,[id,id+'_trade',id+'_order']);
  await db.query(`INSERT INTO "V11RefundInstruction" (id,"receiptId","businessKey","merchantRefundNo","serviceFeeCents","depositCents","totalCents","originalTradeNo",state,"updatedAt") VALUES ($1,$1,$2,$3,40,10,50,$4,$5,now())`,[id,id+'_key',id+'_refund',id+'_trade',state]);
  await db.query(`INSERT INTO "V11FundComponent" (id,"receiptId",kind,"originalCents") VALUES ($1,$1,'F',80)`,[id]);
  await db.query(`INSERT INTO "V11Disposition" (id,"componentId","businessKey",kind,"amountCents",state,"sourceRef","updatedAt") VALUES ($1,$1,$2,'REFUND',40,$3,$1,now())`,[id,id+'_disposition',state==='CONFIRMED'?'COMPLETED':'RESERVED']);
  await db.query(`INSERT INTO "V11FundComponent" (id,"receiptId",kind,"originalCents") VALUES ($1,$2,'D',20)`,[id+'_d',id]);
  await db.query(`INSERT INTO "V11Disposition" (id,"componentId","businessKey",kind,"amountCents",state,"sourceRef","updatedAt") VALUES ($1,$1,$2,'REFUND',10,$3,$4,now())`,[id+'_d',id+'_deposit-disposition',state==='CONFIRMED'?'COMPLETED':'RESERVED',id]);
  await db.query(`INSERT INTO "DurableJob" (id,kind,"businessKey","refId",state,"updatedAt") VALUES ($1,'V11_REFUND',$2,$1,'READY',now())`,[id,id+'_job']);
 }
 for(const state of ['RECEIVED','APPLIED','MANUAL'])await db.query(`INSERT INTO "ReceivedEvent" (id,source,"merchantScope","eventKey","payloadHash","normalizedPayload","verificationMaterialId","verifiedAt",state) VALUES ($1,'synthetic-upgrade','mock-local',$1,'synthetic-hash','{}','synthetic-material',now(),$2)`,['synthetic_'+state,state]);
 const before=await snapshot();
 for(const name of migrations.slice(split))await apply(name);
 const after=await snapshot();
 for(const table of tables){
  assert.equal(after[table].length,before[table].length);
  for(let i=0;i<before[table].length;i++)for(const key of Object.keys(before[table][i]))assert.deepEqual(after[table][i][key],before[table][i][key],table+'.'+key);
 }
 assert.ok(after.V11RefundInstruction.every(r=>r.requestedServiceFeeCents===null&&r.requestedDepositCents===null),'No fabricated cumulative historical request');
 assert.equal(captureCandidate(root).candidate_id,candidate.candidate_id);
 const counts=Object.fromEntries(tables.map(t=>[t,after[t].length]));
 writeFileSync(resolve(dir,'UPGRADE.json'),JSON.stringify({candidate_id:candidate.candidate_id,environment:evidence,applied,counts,prior_columns_preserved:true,historical_request_snapshots_remain_null:true,scope:'Complete SQL chain, synthetic refund obligations/events/jobs. Prisma deployment bookkeeping was verified separately. Payment intent rows covered by separate migration test; production history not used.'},null,2)+'\n');
 console.log(JSON.stringify({candidate_id:candidate.candidate_id,applied:applied.length,counts,preserved:true,evidence:dir}));
}finally{await db.query('ROLLBACK');await db.end();}
