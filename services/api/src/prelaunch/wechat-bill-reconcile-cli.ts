import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../generated/prisma/client.js';
import {downloadWechatTradeBill} from './wechat-trade-bill.js';
import {reconcileDownloadedWechatBillResumable as reconcileDownloadedWechatBill} from './wechat-bill-resumable.js';
async function main(){
 const [date,runId,...extra]=process.argv.slice(2),env=process.env;
 if(extra.length||!date||!runId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId)||env.FEATURE_V11_BILL_RECONCILIATION!=='true'||env.FEATURE_V11_QUERY_RECOVERY!=='true'
  ||!env.DATABASE_URL||!env.FINANCIAL_CASE_OWNER?.trim()||!env.RELEASE_VERSION?.trim())throw Error('Explicit bill reconciliation configuration required');
 const bill=await downloadWechatTradeBill(env,date);
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:env.DATABASE_URL})});
 try{console.log(JSON.stringify(await reconcileDownloadedWechatBill(db,env,bill,env.FINANCIAL_CASE_OWNER,env.RELEASE_VERSION,runId)));}
 finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Verified bill comparison failed; no completeness conclusion recorded');process.exitCode=1;});
