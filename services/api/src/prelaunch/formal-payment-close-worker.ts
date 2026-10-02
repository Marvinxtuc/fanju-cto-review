import {bindingFor} from '../funding/intents.js';
import {randomUUID} from 'node:crypto';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../generated/prisma/client.js';
import {createWechatProviders} from '../providers.js';
import {createWechatChannel} from './wechat-channel.js';
import {runFormalPaymentCloseWorker} from './formal-payment-close-runtime.js';
async function main(){
 const env=process.env;
 if(process.argv.slice(2).some(x=>x!=='--once')||env.FEATURE_V11_FORMAL_PAYMENT_CLOSE!=='true'||env.FEATURE_V11_QUERY_RECOVERY!=='true'||env.PAYMENT_PROVIDER!=='wechat'||env.REFUND_PROVIDER!=='wechat'||!env.DATABASE_URL||!env.FINANCIAL_CASE_OWNER?.trim()||!env.RELEASE_VERSION?.trim())throw Error('Explicit formal closure configuration required');
 const providers=createWechatProviders(env),channel=createWechatChannel(env,providers.payment,providers.refund),db=new PrismaClient({adapter:new PrismaPg({connectionString:env.DATABASE_URL})}),owner=randomUUID();
 try{await runFormalPaymentCloseWorker(db,channel,bindingFor(env,'wechat'),owner,env.FINANCIAL_CASE_OWNER,env.RELEASE_VERSION,process.argv.includes('--once'));}finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Formal closure worker unavailable; query recovery remains required');process.exitCode=1;});
