import {channelWorkerMode} from './channel-worker-mode.js';
import {setTimeout as delay} from 'node:timers/promises';
import type {PrismaClient} from '../generated/prisma/client.js';
import type {createWechatChannel} from './wechat-channel.js';
import {createFormalPaymentCloser} from './formal-payment-close.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
import {runOne} from '../jobs/queue.js';
import {recordWorkerPoll} from '../jobs/heartbeat.js';
export async function runFormalPaymentCloseWorker(db:PrismaClient,channel:ReturnType<typeof createWechatChannel>,binding:ChannelBinding,owner:string,caseOwner:string,release:string,once=false){
 if(!owner.trim()||!caseOwner.trim()||!release.trim())throw Error('Explicit closure runtime identity required');
 channel.assertBinding(binding);
 let stopping=false,timer:ReturnType<typeof setTimeout>|undefined;
 const stop=()=>{if(stopping)return;stopping=true;timer=setTimeout(()=>process.exit(1),15000);timer.unref();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{const handlers={V11_CLOSE_EXPIRED_PAYMENT:createFormalPaymentCloser(db,channel)};do{
  const worked=await runOne(db,owner,caseOwner,handlers,['V11_CLOSE_EXPIRED_PAYMENT'],binding);await recordWorkerPoll(db,'v11-formal-payment-close',owner,release);
  await recordWorkerPoll(db,channelWorkerMode('v11-formal-payment-close',binding),owner,release);
  if(once)break;if(!worked&&!stopping)await delay(250);
 }while(!stopping);}finally{if(timer)clearTimeout(timer);process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
