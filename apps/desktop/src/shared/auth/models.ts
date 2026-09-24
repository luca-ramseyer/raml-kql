import { z } from 'zod';

/**
 * Account and tenant models shared by main and renderer (spec 02). These never contain tokens:
 * tokens stay in the main process.
 */

export const AuthProviderKindSchema = z.enum(['builtin', 'custom', 'azureCli', 'demo']);
export type AuthProviderKind = z.infer<typeof AuthProviderKindSchema>;

export const GuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/** How an account relates to a tenant (ARM `/tenants` `tenantCategory`; Lighthouse = ProjectedBy/ManagedBy). */
export const TenantRelationSchema = z.enum(['home', 'guest', 'lighthouse']);
export type TenantRelation = z.infer<typeof TenantRelationSchema>;

/**
 * - `ok`: a token for this tenant can be acquired silently.
 * - `needsReauth`: interaction required (MFA, Conditional Access, consent). "Sign in to this tenant".
 * - `noAccess`: the account has no Azure access in this tenant (hidden by default).
 * - `unknown`: not checked yet.
 */
export const TenantStateSchema = z.enum(['ok', 'needsReauth', 'noAccess', 'unknown']);
export type TenantState = z.infer<typeof TenantStateSchema>;

export const TenantInfoSchema = z.object({
  tenantId: GuidSchema,
  displayName: z.string().max(300).optional(),
  defaultDomain: z.string().max(300).optional(),
  relation: TenantRelationSchema,
  state: TenantStateSchema,
  /** Short, redacted reason for needsReauth / noAccess. */
  detail: z.string().max(500).optional(),
});
export type TenantInfo = z.infer<typeof TenantInfoSchema>;

export const AccountSchema = z.object({
  /** Stable id: MSAL homeAccountId, `azcli:<user>` or `demo:<user>`. */
  id: z.string().min(1).max(300),
  username: z.string().max(300),
  /** User-chosen display label from accounts.jsonc. */
  label: z.string().max(200).optional(),
  provider: AuthProviderKindSchema,
  homeTenantId: GuidSchema,
  tenants: z.array(TenantInfoSchema),
  /** Tenant enumeration is running. */
  refreshing: z.boolean(),
});
export type Account = z.infer<typeof AccountSchema>;

/**
 * Whether sign-ins survive a restart. `encrypted`: OS-encrypted MSAL cache. `sessionOnly`: the
 * user opted into memory-only sign-in. `unavailable`: no OS keyring (Linux without libsecret)
 * and the user hasn't opted into session-only mode yet.
 */
export const TokenPersistenceSchema = z.enum(['encrypted', 'sessionOnly', 'unavailable']);
export type TokenPersistence = z.infer<typeof TokenPersistenceSchema>;

export const AccountsSnapshotSchema = z.object({
  accounts: z.array(AccountSchema),
  /** The built-in client ID was configured at build time. */
  builtinAvailable: z.boolean(),
  persistence: TokenPersistenceSchema,
});
export type AccountsSnapshot = z.infer<typeof AccountsSnapshotSchema>;

export const AddAccountRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('browser') }).strict(),
  z.object({ method: z.literal('deviceCode') }).strict(),
  z.object({ method: z.literal('azureCli') }).strict(),
  z
    .object({
      method: z.literal('custom'),
      clientId: GuidSchema,
      flow: z.enum(['browser', 'deviceCode']),
    })
    .strict(),
]);
export type AddAccountRequest = z.infer<typeof AddAccountRequestSchema>;

export const DeviceCodePromptSchema = z.object({
  /** Short code the user types at the verification URL. */
  userCode: z.string().max(50),
  verificationUri: z.url().max(500),
  /** Microsoft's instruction text. */
  message: z.string().max(1000),
  expiresInSeconds: z.number().int().nonnegative(),
});
export type DeviceCodePrompt = z.infer<typeof DeviceCodePromptSchema>;
