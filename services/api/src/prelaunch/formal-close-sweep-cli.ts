import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../generated/prisma/client.js';
import {bindingFor} from '../funding/intents.js';
import {scheduleFormalCloseBatch} from './formal-close-sweep.js';
async function main(){
 const env=process.env,[cursor,...extra]=process.argv.slice(2);
 if(extra.length||env.FEATURE_V11_FORMAL_CLOSE_SWEEP!=='true'||env.FEATURE_V11_QUERY_RECOVERY!=='true'||env.PAYMENT_PROVIDER!=='wechat'||env.REFUND_PROVIDER!=='wechat'||!env.DATABASE_URL||!env.FINANCIAL_CASE_OWNER?.trim()||!env.WECHAT_PAY_CONFIG_VERSION?.trim())throw Error('Explicit formal close sweep configuration required');
 const binding=bindingFor(env,'wechat'),db=new PrismaClient({adapter:new PrismaPg({connectionString:env.DATABASE_URL})});
 try{const result=await scheduleFormalCloseBatch(db,binding,env.FINANCIAL_CASE_OWNER,cursor);console.log(JSON.stringify(result));if(result.counts.review)process.exitCode=2;}finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Formal close sweep unavailable; no channel I/O performed');process.exitCode=1;});
