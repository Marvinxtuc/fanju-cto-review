import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import {reject} from './contracts.js';

const identifier = z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const formalActions = ['POLICY_RUNTIME', 'SUPPLY_APPROVE', 'ACTIVITY_PUBLISH', 'NEW_REGISTRATION', 'PREPARE_PAYMENT',
  'RECORD_PAYMENT', 'DECIDE_REFUND', 'EXECUTE_REFUND', 'RECOVER_FUNDS', 'CLOSE_DIFFERENCE', 'CHECKIN_ISSUE', 'CHECKIN_RECORD', 'CORE_CHANGE_PROPOSE'] as const;
const schema = z.object({
  scope: z.literal('FORMAL_ACTION_AUTHORITY'), id: identifier, issuerId: identifier,
  environment: z.enum(['PRODUCTION', 'ISOLATED_TEST']), releaseVersion: identifier,
  materialSha256: digest, policyDigest: digest, parameterDigest: digest,
  channel: z.literal('wechat'), merchantScope: identifier, providerConfigId: identifier,
  issuedAt: z.string().datetime(), notBefore: z.string().datetime(), expiresAt: z.string().datetime(),
  actions: z.array(z.enum(formalActions)).min(1).max(formalActions.length),
  evidence: z.array(z.object({ referenceId: identifier, sha256: digest,
    responsibility: identifier }).strict()).min(1).max(64),
}).strict();
export type FormalAction = typeof formalActions[number];
export type FormalAuthority = z.infer<typeof schema>;
export type AuthorityContext = {
  environment: 'PRODUCTION' | 'ISOLATED_TEST'; releaseVersion: string;
  materialSha256: string; policyDigest: string; parameterDigest: string;
  channel: 'wechat'; merchantScope: string; providerConfigId: string;
};
export type AuthorityTrust = {
  publicKey: string; issuerId: string; authoritySha256: string;
  revokedIds: ReadonlySet<string>; evidence: ReadonlyMap<string, string>;
};
const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** Verifies an externally issued, pinned action grant. Does not issue grants,
 * assess professional conclusions, activate policies or authorize publication.
 * Call under the affected transaction and again at the final send boundary.
 * Trust/revocation must be reread by the caller; never cache a prior success. */
export function verifyFormalActionAuthority(raw: string, signature: string, trust: AuthorityTrust,
  context: AuthorityContext, action: FormalAction, now: Date): FormalAuthority {
  const fail = (): never => reject(503,'FORMAL_ACTION_AUTHORITY_UNAVAILABLE');
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 256 * 1024
    || !digest.safeParse(trust?.authoritySha256).success || sha256(raw) !== trust.authoritySha256
    || !Number.isFinite(now.getTime()) || !formalActions.includes(action)) fail();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail(); }
  const checked = schema.safeParse(parsed); if (!checked.success) fail();
  const grant = checked.data!;
  if (grant.issuerId !== trust.issuerId || trust.revokedIds.has(grant.id)
    || new Set(grant.actions).size !== grant.actions.length || !grant.actions.includes(action)) fail();
  for (const key of ['environment','releaseVersion','materialSha256','policyDigest','parameterDigest',
    'channel','merchantScope','providerConfigId'] as const) if (grant[key] !== context[key]) fail();
  const issued = Date.parse(grant.issuedAt), start = Date.parse(grant.notBefore), end = Date.parse(grant.expiresAt);
  if (issued > start || start >= end || issued > now.getTime() || now.getTime() < start || now.getTime() >= end) fail();
  const refs = new Set<string>();
  for (const item of grant.evidence) {
    if (refs.has(item.referenceId)) fail(); refs.add(item.referenceId);
    const attachment = trust.evidence.get(item.referenceId);
    if (typeof attachment !== 'string' || !attachment.trim() || Buffer.byteLength(attachment) > 4 * 1024 * 1024
      || sha256(attachment) !== item.sha256) fail();
  }
  try {
    const key = createPublicKey(trust.publicKey);
    if (key.asymmetricKeyType !== 'ed25519' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)
      || !verify(null, Buffer.from(raw), key, Buffer.from(signature, 'base64'))) fail();
  } catch { fail(); }
  return grant;
}
