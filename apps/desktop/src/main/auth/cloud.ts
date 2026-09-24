/**
 * Endpoints for one Azure cloud (spec 02, "Sovereign clouds"). Only the public cloud exists
 * today, but call sites must take URLs from here, never hard-code them.
 */
export interface CloudProfile {
  readonly name: 'public';
  readonly authorityHost: string;
  readonly armEndpoint: string;
  readonly logAnalyticsEndpoint: string;
}

export const PUBLIC_CLOUD: CloudProfile = {
  name: 'public',
  authorityHost: 'https://login.microsoftonline.com',
  armEndpoint: 'https://management.azure.com',
  logAnalyticsEndpoint: 'https://api.loganalytics.io',
};

/** The APIs Raml KQL gets tokens for. */
export type AzureResource = 'arm' | 'logAnalytics';

/** Delegated scope for a resource (spec 02, "Scopes"). */
export function scopeFor(cloud: CloudProfile, resource: AzureResource): string {
  switch (resource) {
    case 'arm':
      return `${cloud.armEndpoint}/user_impersonation`;
    case 'logAnalytics':
      return `${cloud.logAnalyticsEndpoint}/Data.Read`;
  }
}

/** Resource URI for tools that take `--resource` (Azure CLI). */
export function resourceUriFor(cloud: CloudProfile, resource: AzureResource): string {
  return resource === 'arm' ? `${cloud.armEndpoint}/` : cloud.logAnalyticsEndpoint;
}

export function authorityFor(cloud: CloudProfile, tenant: string): string {
  return `${cloud.authorityHost}/${tenant}`;
}
