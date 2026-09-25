import { z } from 'zod';

import { SEMVER } from './schemas';
import { isValidRange } from './semver';

/**
 * Extension manifests (`package.json`, spec 07). Validated at install time and again when the
 * app starts; an invalid manifest never installs. Unknown top-level keys (npm's own fields
 * like `scripts` or `devDependencies`) are allowed, the Raml KQL parts are strict.
 */

/** Permissions an extension can declare (spec 07, "Permissions"). */
export const SIMPLE_PERMISSIONS = [
  'results.readSelection',
  'results.read',
  'query.run',
  'tenants.realNames',
  'clipboard.write',
  'secrets',
  'notifications',
] as const;
export type SimplePermission = (typeof SIMPLE_PERMISSIONS)[number];

export type PermissionRisk = 'high' | 'medium' | 'low';

export const PERMISSION_RISK: Record<SimplePermission | 'network' | 'auth', PermissionRisk> = {
  network: 'high',
  'results.read': 'high',
  'query.run': 'high',
  auth: 'high',
  'results.readSelection': 'medium',
  'tenants.realNames': 'medium',
  'clipboard.write': 'low',
  secrets: 'low',
  notifications: 'low',
};

/** `example.com` or `*.example.com` (no scheme, path or port). */
export const HOST_PATTERN =
  /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const Reason = z.string().min(1).max(300);

export const PermissionDeclarationSchema = z.union([
  z.strictObject({
    id: z.literal('network'),
    hosts: z
      .array(
        z
          .string()
          .toLowerCase()
          .regex(HOST_PATTERN, 'must be a host name like api.example.com or *.example.com'),
      )
      .min(1)
      .max(20),
    reason: Reason,
  }),
  z.strictObject({
    id: z.string().regex(/^auth:[a-z0-9.:/_-]{1,200}$/, 'must be auth:<resource>'),
    reason: Reason,
  }),
  z.strictObject({ id: z.enum(SIMPLE_PERMISSIONS), reason: Reason }),
]);
export type PermissionDeclaration = z.infer<typeof PermissionDeclarationSchema>;

/** `publisher.name` pieces: lowercase letters, digits and dashes. */
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Command, view, enricher and renderer ids: `word.word`. */
const CONTRIBUTION_ID = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;
/** Paths inside the package. */
const PackagePath = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (p) =>
      !p.startsWith('/') && !p.includes('\\') && !p.split('/').some((s) => s === '..' || s === ''),
    { message: 'must be a relative path inside the extension' },
  );

export const ENTITY_TYPES = [
  'ip',
  'domain',
  'url',
  'md5',
  'sha1',
  'sha256',
  'upn',
  'email',
  'hostname',
  'deviceId',
  'aadObjectId',
  'tenantId',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const MENU_LOCATIONS = ['commandPalette', 'results/cell/context', 'view/title'] as const;

const ConfigurationPropertySchema = z.strictObject({
  type: z.enum(['string', 'number', 'integer', 'boolean']),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().max(1000).optional(),
  enum: z
    .array(z.union([z.string(), z.number()]))
    .max(100)
    .optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
});
export type ConfigurationProperty = z.infer<typeof ConfigurationPropertySchema>;

export const ContributesSchema = z.strictObject({
  commands: z
    .array(
      z.strictObject({
        command: z.string().regex(CONTRIBUTION_ID).max(200),
        title: z.string().min(1).max(200),
        category: z.string().max(100).optional(),
        icon: z
          .string()
          .regex(/^\$\([a-z0-9-]+\)$/)
          .optional(),
      }),
    )
    .max(200)
    .optional(),
  menus: z
    .partialRecord(
      z.enum(MENU_LOCATIONS),
      z
        .array(
          z.strictObject({ command: z.string().max(200), when: z.string().max(500).optional() }),
        )
        .max(100),
    )
    .optional(),
  keybindings: z
    .array(
      z.strictObject({
        command: z.string().max(200),
        key: z.string().min(1).max(100),
        mac: z.string().max(100).optional(),
        when: z.string().max(500).optional(),
      }),
    )
    .max(100)
    .optional(),
  enrichers: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
        title: z.string().min(1).max(100),
        entityTypes: z.array(z.enum(ENTITY_TYPES)).min(1),
      }),
    )
    .max(20)
    .optional(),
  views: z
    .strictObject({
      sidebar: z
        .array(
          z.strictObject({
            id: z.string().regex(CONTRIBUTION_ID).max(200),
            name: z.string().min(1).max(100),
            icon: z
              .string()
              .regex(/^\$\([a-z0-9-]+\)$/)
              .optional(),
            ui: PackagePath,
          }),
        )
        .max(10)
        .optional(),
    })
    .optional(),
  resultRenderers: z
    .array(
      z.strictObject({
        id: z.string().regex(CONTRIBUTION_ID).max(200),
        title: z.string().min(1).max(100),
        ui: PackagePath,
      }),
    )
    .max(20)
    .optional(),
  dataSources: z
    .array(
      z.strictObject({
        id: z.string().regex(CONTRIBUTION_ID).max(200),
        title: z.string().min(1).max(100),
      }),
    )
    .max(10)
    .optional(),
  themes: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(100),
        uiTheme: z.enum(['vs', 'vs-dark', 'hc-black', 'hc-light']),
        path: PackagePath,
      }),
    )
    .max(20)
    .optional(),
  configuration: z
    .strictObject({
      title: z.string().max(100).optional(),
      properties: z.record(
        z
          .string()
          .regex(/^[a-z0-9-]+(\.[A-Za-z0-9_-]+)+$/)
          .max(200),
        ConfigurationPropertySchema,
      ),
    })
    .optional(),
});
export type Contributes = z.infer<typeof ContributesSchema>;

export const ExtensionManifestSchema = z
  .looseObject({
    name: z.string().regex(NAME, 'lowercase letters, digits and dashes'),
    publisher: z.string().regex(NAME, 'lowercase letters, digits and dashes'),
    displayName: z.string().min(1).max(100).optional(),
    version: z.string().regex(SEMVER, 'must be a semantic version like 1.2.0'),
    description: z.string().max(1000).optional(),
    license: z.string().max(100).optional(),
    repository: z
      .union([z.url().max(2000), z.object({ url: z.string().max(2000) }).loose()])
      .optional(),
    icon: PackagePath.optional(),
    engines: z.looseObject({
      'raml-kql': z
        .string()
        .refine(isValidRange, { message: 'must be a version range like ^1.0.0' }),
    }),
    main: PackagePath.optional(),
    activationEvents: z
      .array(
        z
          .string()
          .regex(
            /^(\*|onStartupFinished|onCommand:.+|onEnricher:.+|onView:.+|onResultRenderer:.+|onDataSource:.+)$/,
          ),
      )
      .max(100)
      .optional(),
    permissions: z.array(PermissionDeclarationSchema).max(30).optional(),
    contributes: ContributesSchema.optional(),
  })
  .superRefine((manifest, ctx) => {
    const configuration = manifest.contributes?.configuration?.properties ?? {};
    for (const key of Object.keys(configuration)) {
      if (!key.startsWith(`${manifest.name}.`)) {
        ctx.addIssue({
          code: 'custom',
          path: ['contributes', 'configuration', 'properties', key],
          message: `settings must start with "${manifest.name}."`,
        });
      }
    }
    const commands = new Set((manifest.contributes?.commands ?? []).map((c) => c.command));
    for (const [location, items] of Object.entries(manifest.contributes?.menus ?? {})) {
      for (const item of items) {
        if (!commands.has(item.command)) {
          ctx.addIssue({
            code: 'custom',
            path: ['contributes', 'menus', location],
            message: `menu item "${item.command}" is not a contributed command`,
          });
        }
      }
    }
    for (const binding of manifest.contributes?.keybindings ?? []) {
      if (!commands.has(binding.command)) {
        ctx.addIssue({
          code: 'custom',
          path: ['contributes', 'keybindings'],
          message: `keybinding command "${binding.command}" is not a contributed command`,
        });
      }
    }
    const needsCode =
      (manifest.contributes?.commands?.length ?? 0) +
      (manifest.contributes?.enrichers?.length ?? 0) +
      (manifest.contributes?.dataSources?.length ?? 0);
    if (needsCode > 0 && manifest.main === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['main'],
        message: 'commands, enrichers and data sources need "main"',
      });
    }
    const ids = (manifest.permissions ?? []).map((p) => p.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['permissions'],
        message: 'each permission may be declared once',
      });
    }
  });
export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>;

/** The hosts of a `network` declaration (undefined for other permissions). */
export function networkHosts(declaration: PermissionDeclaration | undefined): string[] | undefined {
  return declaration !== undefined && declaration.id === 'network' && 'hosts' in declaration
    ? declaration.hosts
    : undefined;
}

export function extensionId(manifest: Pick<ExtensionManifest, 'publisher' | 'name'>): string {
  return `${manifest.publisher}.${manifest.name}`;
}

export function permissionRisk(id: string): PermissionRisk {
  if (id.startsWith('auth:')) return 'high';
  return (PERMISSION_RISK as Record<string, PermissionRisk | undefined>)[id] ?? 'high';
}

/** Whether a host is allowed by a list of patterns (`*.example.com` matches subdomains only). */
export function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const target = host.toLowerCase().replace(/\.$/, '');
  return patterns.some((pattern) =>
    pattern.startsWith('*.')
      ? target.endsWith(pattern.slice(1)) && target.length > pattern.length - 1
      : target === pattern,
  );
}
