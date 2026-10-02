import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../generated/prisma/client.js';
import {bindingFor} from '../funding/intents.js';
import {runFormalHoldExpiryWorker} from './formal-hold-expiry-runtime.js';
async function main(){
 const env=process.env;if(process.argv.slice(2).some(x=>x!=='--once')||env.FEATURE_V11_FORMAL_HOLD_EXPIRY!=='true'||env.FEATURE_V11_QUERY_RECOVERY!=='true'||env.PAYMENT_PROVIDER!=='wechat'||env.REFUND_PROVIDER!=='wechat'||!env.DATABASE_URL||!env.FINANCIAL_CASE_OWNER?.trim()||!env.RELEASE_VERSION?.trim()||!env.WECHAT_PAY_CONFIG_VERSION?.trim())throw Error('Explicit formal expiry configuration required');
 const binding=bindingFor(env,'wechat'),db=new PrismaClient({adapter:new PrismaPg({connectionString:env.DATABASE_URL})});
 try{await runFormalHoldExpiryWorker(db,binding,env.FINANCIAL_CASE_OWNER,env.RELEASE_VERSION,process.argv.includes('--once'));}finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Formal expiry worker failed; no channel closure inferred');process.exitCode=1;});
