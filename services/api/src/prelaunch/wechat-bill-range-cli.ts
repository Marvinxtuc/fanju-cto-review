import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../generated/prisma/client.js';
import {bindingFor} from '../funding/intents.js';
import {inspectWechatBillRange,billRangeDays} from './wechat-bill-range.js';
async function main(){
 const [start,end,...extra]=process.argv.slice(2),env=process.env;
 if(extra.length||!start||!end||env.FEATURE_V11_BILL_RANGE_CHECK!=='true'||!env.DATABASE_URL||!env.RELEASE_VERSION?.trim())throw Error('Explicit range inspection configuration required');
 billRangeDays(start,end);const binding=bindingFor(env,'wechat');
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:env.DATABASE_URL})});
 try{console.log(JSON.stringify(await inspectWechatBillRange(db,binding,env.RELEASE_VERSION,start,end)));}finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Bill range inspection failed; no completeness conclusion recorded');process.exitCode=1;});
