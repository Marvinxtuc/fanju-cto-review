import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo||!process.env.PRELAUNCH_TEST_EXPIRY_SCOPE||!process.env.PRELAUNCH_TEST_EXPIRY_CONFIG)throw Error('Owned expiry fixture required');
const require=createRequire(`${repo}/services/api/package.json`),{PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(`${repo}/services/api/dist/generated/prisma/client.js`)),{verifyOwnedDatabase}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/ownership.js`)),{runFormalHoldExpiryWorker}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/formal-hold-expiry-runtime.js`));
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
try{await verifyOwnedDatabase(db,process.env);await runFormalHoldExpiryWorker(db,{channel:'wechat',merchantScope:process.env.PRELAUNCH_TEST_EXPIRY_SCOPE,providerConfigId:process.env.PRELAUNCH_TEST_EXPIRY_CONFIG},'synthetic-expiry-owner','synthetic-expiry-release');}finally{await db.$disconnect();}
