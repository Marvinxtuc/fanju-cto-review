import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { sessionContext } from '../auth.js';
import { identifier, reject, type LocalPrincipal } from './contracts.js';
import { resolveVerifiedIdentity } from './principal.js';
const derive = promisify(scrypt);
const accountSchema = z.object({
  accountId: identifier, username: z.string().min(2).max(80), accountVersion: z.string().min(1).max(80), enabled: z.boolean(),
  passwordHash: z.string().regex(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/),
  actorId: identifier, personId: identifier, actorVersion: z.number().int().nonnegative(),
  role: z.enum(['OPS', 'REVIEWER', 'RESTAURANT']), restaurantId: identifier.nullable(),
}).strict().superRefine((row, ctx) => {
  if ((row.role === 'RESTAURANT') !== (row.restaurantId !== null)) ctx.addIssue({ code: 'custom', message: 'Restaurant binding mismatch' });
});
export type ControlledIdentityBinding = z.infer<typeof accountSchema>;
export function parseControlledIdentityBindings(value: string | undefined): readonly ControlledIdentityBinding[] {
  if (!value) return [];
  try {
    const rows = z.array(accountSchema).max(100).parse(JSON.parse(value));
    for (const field of ['accountId','username','actorId'] as const) if (new Set(rows.map(x=>x[field])).size!==rows.length) throw Error();
    return Object.freeze(rows.map(x=>Object.freeze(x)));
  } catch { throw Error('Invalid controlled V1.1 identity configuration'); }
}
function binding(row: ControlledIdentityBinding) {
  return { actorId: row.actorId, personId: row.personId, role: row.role, actorVersion: row.actorVersion,
    userId: null, restaurantId: row.restaurantId };
}
export function createProductionControlledIdentity(db: PrismaClient, configuredAccounts: string | undefined) {
  const accounts = parseControlledIdentityBindings(configuredAccounts);
  const lookup = (id: string) => db.v11Actor.findUnique({where:{id}});
  const windows = new Map<string,{count:number,until:number}>(); let pending=0;
  function limit(key:string) {
    const now=Date.now();for(const [k,v]of windows)if(v.until<=now)windows.delete(k);
    if(!windows.has(key)&&windows.size>=10000)reject(429,'LOGIN_TEMPORARILY_UNAVAILABLE');
    const window=windows.get(key)??{count:0,until:now+900_000};window.count++;windows.set(key,window);
    if(window.count>10)reject(429,'LOGIN_RATE_LIMITED');
  }
  return {
    async login(request:FastifyRequest) {
      const context=sessionContext(request.server);if(context.demo)reject(503,'FORMAL_IDENTITY_REQUIRED');
      limit('ip:'+request.ip);
      const parsed=z.object({username:z.string().min(2).max(80),password:z.string().min(1).max(256)}).strict().safeParse(request.body);
      if(!parsed.success)reject(400,'INVALID_INPUT');limit('username:'+parsed.data.username);
      if(pending>=4)reject(429,'LOGIN_TEMPORARILY_UNAVAILABLE');pending++;
      try{
        const account=accounts.find(x=>x.username===parsed.data.username);
        const [,salt,digest]=(account?.passwordHash??'scrypt:'+ '0'.repeat(32)+':'+ '0'.repeat(128)).split(':');
        // Same string-salt encoding as the existing controlled-admin hash utility.
        const actual=await derive(parsed.data.password,salt!,64) as Buffer;
        if(!timingSafeEqual(actual,Buffer.from(digest!,'hex'))||!account?.enabled)reject(401,'SESSION_EXPIRED');
        const principal=await resolveVerifiedIdentity(binding(account),lookup);
        const sessionToken=request.server.jwt.sign({sub:account.accountId,role:account.role,aud:'fanju-v11-controlled',iss:context.issuer,
          sessionVersion:context.version,accountVersion:account.accountVersion,actorVersion:account.actorVersion},{expiresIn:900});
        await db.auditLog.create({data:{action:'identity.v11-controlled-login',targetType:'V11Actor',targetId:principal.id,
          metadata:{scope:'V11_CONTROLLED',role:principal.role}}});
        return {token:sessionToken,principal};
      }finally{pending--;}
    },
    async authenticate(request:FastifyRequest):Promise<LocalPrincipal> {
      const context=sessionContext(request.server);if(context.demo)reject(503,'FORMAL_IDENTITY_REQUIRED');
      let payload:Record<string,unknown>;try{payload=await request.jwtVerify<Record<string,unknown>>();}catch{reject(401,'SESSION_EXPIRED');}
      const now=Math.floor(Date.now()/1000);
      if(payload.aud!=='fanju-v11-controlled'||payload.iss!==context.issuer||payload.sessionVersion!==context.version
        ||typeof payload.sub!=='string'||typeof payload.exp!=='number'||typeof payload.iat!=='number'
        ||!Number.isInteger(payload.exp)||!Number.isInteger(payload.iat)||payload.exp<=now||payload.iat>now+30
        ||payload.exp-payload.iat>900||context.revoked.has(payload.sub))reject(401,'SESSION_EXPIRED');
      const account=accounts.find(x=>x.accountId===payload.sub);
      if(!account?.enabled||account.accountVersion!==payload.accountVersion||account.actorVersion!==payload.actorVersion
        ||account.role!==payload.role)reject(401,'SESSION_EXPIRED');
      return resolveVerifiedIdentity(binding(account),lookup);
    },
  };
}
export function createProductionControlledPrincipal(db:PrismaClient, configuredAccounts:string|undefined) {
  return createProductionControlledIdentity(db,configuredAccounts).authenticate;
}
