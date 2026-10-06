import {
  ContributesSchema,
  ENTITY_TYPES,
  PermissionDeclarationSchema,
} from '@raml-kql/pack-schema/extension-manifest';
import { z } from 'zod';

import { ConfigProblemSchema } from '../config/config-snapshots';

/** Installed extensions, grants and the host ↔ workbench UI requests (spec 07). */
export const EXTENSION_ID = /^[a-z0-9][a-z0-9-]{0,62}\.[a-z0-9][a-z0-9-]{0,62}$/;
export const ExtensionIdSchema = z.string().regex(EXTENSION_ID);

export const GrantScopeSchema = z.enum(['run', 'session', 'always']);
export type GrantScope = z.infer<typeof GrantScopeSchema>;

export const ExtensionSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file'), name: z.string().max(300) }),
  z.object({
    type: z.literal('git'),
    url: z.string().max(2000),
    tag: z.string().max(200),
    sha: z.string().max(64).optional(),
  }),
  z.object({ type: z.literal('dev'), path: z.string().max(2000) }),
]);
export type ExtensionSource = z.infer<typeof ExtensionSourceSchema>;

export const ExtensionInfoSchema = z.object({
  id: z.string(),
  publisher: z.string(),
  name: z.string(),
  displayName: z.string(),
  version: z.string(),
  description: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  enabled: z.boolean(),
  state: z.enum(['disabled', 'inactive', 'starting', 'active', 'failed']),
  error: z.string().optional(),
  source: ExtensionSourceSchema,
  sha256: z.string(),
  installedAt: z.string(),
  permissions: z.array(PermissionDeclarationSchema),
  contributes: ContributesSchema,
  /** Signed by a key the app trusts, and unchanged since (D-057). */
  verified: z.boolean(),
  /** Who signed it, for the badge: "Raml KQL". Only when `verified`. */
  verifiedBy: z.string().optional(),
  /** An update is available (git sources, after a check). */
  update: z.object({ version: z.string(), tag: z.string() }).optional(),
});
export type ExtensionInfo = z.infer<typeof ExtensionInfoSchema>;

export const GrantSchema = z.object({
  extensionId: z.string(),
  permission: z.string(),
  scope: GrantScopeSchema,
  /** `network` grants: the hosts that were allowed. */
  hosts: z.array(z.string()).optional(),
  /** `run` grants: the query run they belong to. */
  runId: z.string().optional(),
  grantedAt: z.string(),
});
export type Grant = z.infer<typeof GrantSchema>;

export const ExtensionsSnapshotSchema = z.object({
  extensions: z.array(ExtensionInfoSchema),
  /** Session and persisted ("always") grants; run grants are short-lived and not listed. */
  grants: z.array(GrantSchema),
  problems: z.array(ConfigProblemSchema),
});
export type ExtensionsSnapshot = z.infer<typeof ExtensionsSnapshotSchema>;

export const InstallPreviewSchema = z.object({
  previewId: z.string(),
  extension: ExtensionInfoSchema,
  readme: z.string().max(200_000).optional(),
  /** Already installed: the version being replaced, and permissions the new version adds. */
  replaces: z
    .object({ version: z.string(), addedPermissions: z.array(PermissionDeclarationSchema) })
    .optional(),
});
export type InstallPreview = z.infer<typeof InstallPreviewSchema>;

export const InstallResultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cancelled') }),
  z.object({ type: z.literal('preview'), preview: InstallPreviewSchema }),
]);
export type InstallResult = z.infer<typeof InstallResultSchema>;

const QuickPickItemSchema = z.object({
  label: z.string().max(500),
  description: z.string().max(500).optional(),
  detail: z.string().max(1000).optional(),
});

/** Main → workbench: something only the workbench can do (dialogs, the editor). */
export const UiRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    extension: z.string(),
    severity: z.enum(['info', 'warning', 'error']),
    message: z.string().max(2000),
    actions: z.array(z.string().max(100)).max(5),
  }),
  z.object({
    kind: z.literal('quickPick'),
    extension: z.string(),
    items: z.array(QuickPickItemSchema).max(1000),
    placeHolder: z.string().max(300).optional(),
  }),
  z.object({
    kind: z.literal('inputBox'),
    extension: z.string(),
    prompt: z.string().max(500).optional(),
    placeHolder: z.string().max(300).optional(),
    value: z.string().max(10_000).optional(),
    password: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('progress'),
    extension: z.string(),
    progressId: z.number().int(),
    /** Undefined when the task finished. */
    title: z.string().max(300).optional(),
  }),
  z.object({
    kind: z.literal('permission'),
    extensionId: z.string(),
    extension: z.string(),
    permission: z.string(),
    risk: z.enum(['high', 'medium', 'low']),
    /** What exactly will happen ("send 14 values to www.virustotal.com"). */
    detail: z.string().max(1000),
    reason: z.string().max(300),
    hosts: z.array(z.string()).optional(),
    /** Whether the grant can apply to a query run (the default scope). */
    hasRun: z.boolean(),
  }),
  z.object({ kind: z.literal('editor.getActiveQuery'), extension: z.string() }),
  z.object({
    kind: z.literal('editor.insertText'),
    extension: z.string(),
    text: z.string().max(1_000_000),
  }),
  z.object({
    kind: z.literal('editor.openQueryTab'),
    extension: z.string(),
    query: z.string().max(1_000_000),
    title: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('executeHostCommand'),
    extension: z.string(),
    command: z.string().max(200),
  }),
]);
export type UiRequest = z.infer<typeof UiRequestSchema>;

export const UiRequestEventSchema = z.object({
  requestId: z.number().int(),
  request: UiRequestSchema,
});

export const UiResponseSchema = z
  .object({ requestId: z.number().int(), value: z.json().optional() })
  .strict();

export const EntitySchema = z.object({ type: z.enum(ENTITY_TYPES), value: z.string().max(2000) });

/** What an enricher returns per value (shown as extra result columns). */
export const EnrichmentResultSchema = z.object({
  entity: EntitySchema,
  fields: z
    .record(z.string().max(100), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))
    .refine((fields) => Object.keys(fields).length <= 20, { message: 'at most 20 fields' }),
  url: z
    .url()
    .max(2000)
    .refine((u) => u.startsWith('https://'), { message: 'https only' })
    .optional(),
});
export type EnrichmentResultData = z.infer<typeof EnrichmentResultSchema>;
