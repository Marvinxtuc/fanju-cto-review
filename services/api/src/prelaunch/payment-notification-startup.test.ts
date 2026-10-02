import {expect,it} from 'vitest';
import {buildApp} from '../app.js';
import type {PrismaClient} from '../generated/prisma/client.js';
it.each(['true','bad'])('rejects unsafe notification configuration %s before serving',async flag=>{
 await expect(buildApp({prisma:{} as PrismaClient,providerEnv:{APP_ENV:'ci',NODE_ENV:'test',SESSION_SECRET:'synthetic-only-session-key-32-characters',FEATURE_V11_PAYMENT_NOTIFICATIONS:flag}})).rejects.toThrow(flag==='true'?'real provider':'notification flag');
});

it.each(['true','bad'])('rejects unsafe refund notification configuration %s before serving',async flag=>{
 await expect(buildApp({prisma:{} as PrismaClient,providerEnv:{APP_ENV:'ci',NODE_ENV:'test',SESSION_SECRET:'synthetic-only-session-key-32-characters',FEATURE_V11_REFUND_NOTIFICATIONS:flag}})).rejects.toThrow(flag==='true'?'real provider':'notification flag');
});
