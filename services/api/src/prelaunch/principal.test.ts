import { describe, it, expect } from 'vitest';
import { scryptSync } from 'node:crypto';
import { createSimulationIdentity, resolveVerifiedIdentity, type ActorRecord, type VerifiedIdentityBinding } from './principal.js';
const salt='01'.repeat(16); const passwordHash='scrypt:'+salt+':'+scryptSync('fixture-password',Buffer.from(salt,'hex'),64).toString('hex');
function fixture() {
  const actor: ActorRecord={id:'actor',personId:'person',role:'USER',userId:'user',restaurantId:null,version:2,enabled:true,passwordHash};
  let clock=1_000; const lookup=async(id:string)=>id===actor.id?actor:null;
  const identity=createSimulationIdentity('test-only-session-secret-32-characters',lookup,()=>clock);
  const binding:VerifiedIdentityBinding={actorId:'actor',personId:'person',role:'USER',userId:'user',restaurantId:null,actorVersion:2};
  return {actor,lookup,identity,binding,advance:()=>{clock+=3600_000;}};
}
describe('V1.1 identity boundary',()=>{
 it('authenticates current DB actor and returns no stored credential',async()=>{const f=fixture();const login=await f.identity.login('actor','fixture-password');expect(login.actor).toEqual({id:'actor',role:'USER'});const p=await f.identity.authenticate('Bearer '+login.token);expect(p).not.toHaveProperty('passwordHash');expect(p).not.toHaveProperty('enabled');expect(p.userId).toBe('user');});
 it('rejects a wrong password',async()=>{const f=fixture();await expect(f.identity.login('actor','wrong')).rejects.toMatchObject({statusCode:401});});
 it('rejects unknown or disabled actors at login',async()=>{const f=fixture();await expect(f.identity.login('missing','fixture-password')).rejects.toMatchObject({statusCode:401});f.actor.enabled=false;await expect(f.identity.login('actor','fixture-password')).rejects.toMatchObject({statusCode:401});});
 it('rejects malformed stored credential without exposing it',async()=>{const f=fixture();f.actor.passwordHash='bad';await expect(f.identity.login('actor','fixture-password')).rejects.toMatchObject({message:'SESSION_EXPIRED'});});
 it('rejects tampering, trailing token segments and missing authorization',async()=>{const f=fixture();const x=await f.identity.login('actor','fixture-password');for(const auth of [undefined,'Bearer '+x.token+'x','Bearer '+x.token+'.extra'])await expect(f.identity.authenticate(auth)).rejects.toMatchObject({statusCode:401});});
 it('rejects the exact expiry boundary',async()=>{const f=fixture();const x=await f.identity.login('actor','fixture-password');f.advance();await expect(f.identity.authenticate('Bearer '+x.token)).rejects.toMatchObject({statusCode:401});});
 it('revokes an issued token when DB actor version changes or is disabled',async()=>{const f=fixture();const x=await f.identity.login('actor','fixture-password');f.actor.version++;await expect(f.identity.authenticate('Bearer '+x.token)).rejects.toMatchObject({statusCode:401});f.actor.version--;f.actor.enabled=false;await expect(f.identity.authenticate('Bearer '+x.token)).rejects.toMatchObject({statusCode:401});});
 it('rejects invalid roles even if stored in DB',async()=>{const f=fixture();f.actor.role='SUPER_ADMIN';await expect(f.identity.login('actor','fixture-password')).rejects.toMatchObject({statusCode:401});});
 it('maps only an exact verified identity binding and projects fields',async()=>{const f=fixture();const p=await resolveVerifiedIdentity(f.binding,f.lookup);expect(p.id).toBe('actor');expect(p).not.toHaveProperty('passwordHash');});
 it.each(['actorId','personId','role','userId','restaurantId','actorVersion'] as const)('rejects mismatched verified %s without fallback',async key=>{const f=fixture();const changed={...f.binding,[key]:key==='actorVersion'?3:key==='role'?'OPS':'other'} as VerifiedIdentityBinding;await expect(resolveVerifiedIdentity(changed,f.lookup)).rejects.toHaveProperty('statusCode');});
 it('requires user linkage and explicit restaurant authorization',async()=>{const f=fixture();f.actor.userId=null;f.binding.userId=null;await expect(resolveVerifiedIdentity(f.binding,f.lookup)).rejects.toMatchObject({statusCode:403});f.actor.role='RESTAURANT';f.binding.role='RESTAURANT';await expect(resolveVerifiedIdentity(f.binding,f.lookup)).rejects.toMatchObject({statusCode:403});});
 it('does not elevate OPS to REVIEWER',async()=>{const f=fixture();f.actor.role='OPS';f.binding.role='REVIEWER';await expect(resolveVerifiedIdentity(f.binding,f.lookup)).rejects.toMatchObject({statusCode:403});});
});
