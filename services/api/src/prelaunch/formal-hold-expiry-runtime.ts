import {channelWorkerMode} from './channel-worker-mode.js';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {PrismaClient} from '../generated/prisma/client.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
import {recordWorkerPoll} from '../jobs/heartbeat.js';
import {scanFormalHoldExpiryBatch} from './formal-hold-expiry.js';
export async function runFormalHoldExpiryWorker(db:PrismaClient,binding:ChannelBinding,caseOwner:string,release:string,once=false){
 if(!release.trim()||!caseOwner.trim())throw Error('Explicit expiry runtime identity required');
 const owner=randomUUID();let stopping=false,timer:ReturnType<typeof setTimeout>|undefined,cursor:string|undefined;
 const stop=()=>{if(stopping)return;stopping=true;timer=setTimeout(()=>process.exit(1),15000);timer.unref();};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{do{const result=await scanFormalHoldExpiryBatch(db,binding,caseOwner,cursor);cursor=result.nextCursor??undefined;
  await recordWorkerPoll(db,'v11-formal-hold-expiry',owner,release);
  await recordWorkerPoll(db,channelWorkerMode('v11-formal-hold-expiry',binding),owner,release);
  if(Object.values(result.counts).some(x=>x>0))console.log(JSON.stringify({scope:'FORMAL_HOLD_EXPIRY_ONLY',...result.counts}));
  if(once){if(result.counts.failed||result.counts.review)process.exitCode=2;break;}if(!stopping)await delay(cursor?10:1000);
 }while(!stopping);}finally{if(timer)clearTimeout(timer);process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
