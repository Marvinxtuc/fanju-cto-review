import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../generated/prisma/client.js';
import {inspectFinancialMonitor,validateMonitorLimits} from './financial-monitor.js';
async function main(){
 const env=process.env;if(process.argv.length!==2||env.FEATURE_V11_FINANCIAL_MONITOR!=='true'||!env.DATABASE_URL||!env.RELEASE_VERSION?.trim())throw Error('Explicit monitor configuration required');
 const read=(key:string)=>{const value=env[key];if(!value||!/^[1-9]\d*$/.test(value))throw Error('Explicit monitor threshold required');return Number(value);};
 const limits={dueJobs:read('MONITOR_DUE_JOBS'),manualJobs:read('MONITOR_MANUAL_JOBS'),expiredLeases:read('MONITOR_EXPIRED_LEASES'),overdueCases:read('MONITOR_OVERDUE_CASES'),oldestDueSeconds:read('MONITOR_OLDEST_DUE_SECONDS'),heartbeatSeconds:read('MONITOR_HEARTBEAT_SECONDS')};
 validateMonitorLimits(limits);
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:env.DATABASE_URL})});
 try{const result=await inspectFinancialMonitor(db,env.RELEASE_VERSION,limits);console.log(JSON.stringify(result));if(result.alerts.length)process.exitCode=2;}finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Financial monitor failed; observation unavailable');process.exitCode=1;});
