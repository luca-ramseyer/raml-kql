import type { KqlType, SchemaTable, WorkspaceSchemaData } from '../../shared/schema/models';

import { DEMO_WORKSPACES, demoResourceId, type DemoWorkspace } from './demo-inventory';

/**
 * Demo schemas (spec 04, "Demo mode"; spec 05 acceptance): common Log Analytics tables with a
 * trimmed set of their public column names. Workspaces differ on purpose so IntelliSense can
 * show "available in n/m": every workspace has the basics, Sentinel workspaces add security
 * tables, only some have Defender tables, and Contoso has a custom `_CL` table and a function.
 */
type ColumnSpec = readonly (readonly [string, KqlType])[];

const COMMON: ColumnSpec = [
  ['TimeGenerated', 'datetime'],
  ['TenantId', 'string'],
  ['Type', 'string'],
];

function table(name: string, columns: ColumnSpec): SchemaTable {
  return {
    name,
    columns: [...COMMON.slice(0, 1), ...columns, ...COMMON.slice(1)].map(([n, type]) => ({
      name: n,
      type,
    })),
  };
}

const HEARTBEAT = table('Heartbeat', [
  ['Computer', 'string'],
  ['OSType', 'string'],
  ['Version', 'string'],
  ['ComputerIP', 'string'],
  ['Category', 'string'],
]);

const AZURE_ACTIVITY = table('AzureActivity', [
  ['OperationNameValue', 'string'],
  ['ActivityStatusValue', 'string'],
  ['Caller', 'string'],
  ['CallerIpAddress', 'string'],
  ['ResourceGroup', 'string'],
  ['SubscriptionId', 'string'],
  ['_ResourceId', 'string'],
]);

const USAGE = table('Usage', [
  ['DataType', 'string'],
  ['Quantity', 'real'],
  ['QuantityUnit', 'string'],
  ['IsBillable', 'bool'],
  ['Solution', 'string'],
]);

const SIGNIN_LOGS = table('SigninLogs', [
  ['UserPrincipalName', 'string'],
  ['UserDisplayName', 'string'],
  ['AppDisplayName', 'string'],
  ['IPAddress', 'string'],
  ['Location', 'string'],
  ['ResultType', 'string'],
  ['ResultDescription', 'string'],
  ['ConditionalAccessStatus', 'string'],
  ['AuthenticationRequirement', 'string'],
  ['RiskLevelDuringSignIn', 'string'],
  ['ClientAppUsed', 'string'],
  ['DeviceDetail', 'dynamic'],
  ['LocationDetails', 'dynamic'],
  ['CorrelationId', 'string'],
]);

const AUDIT_LOGS = table('AuditLogs', [
  ['OperationName', 'string'],
  ['Category', 'string'],
  ['Result', 'string'],
  ['InitiatedBy', 'dynamic'],
  ['TargetResources', 'dynamic'],
  ['LoggedByService', 'string'],
  ['CorrelationId', 'string'],
]);

const SECURITY_EVENT = table('SecurityEvent', [
  ['Computer', 'string'],
  ['EventID', 'int'],
  ['Activity', 'string'],
  ['Account', 'string'],
  ['AccountType', 'string'],
  ['LogonType', 'int'],
  ['IpAddress', 'string'],
  ['Process', 'string'],
  ['CommandLine', 'string'],
]);

const SECURITY_ALERT = table('SecurityAlert', [
  ['AlertName', 'string'],
  ['AlertSeverity', 'string'],
  ['ProviderName', 'string'],
  ['ProductName', 'string'],
  ['Status', 'string'],
  ['Tactics', 'string'],
  ['Entities', 'string'],
  ['SystemAlertId', 'string'],
]);

const SECURITY_INCIDENT = table('SecurityIncident', [
  ['IncidentNumber', 'int'],
  ['Title', 'string'],
  ['Severity', 'string'],
  ['Status', 'string'],
  ['Classification', 'string'],
  ['Owner', 'dynamic'],
  ['AlertIds', 'dynamic'],
  ['CreatedTime', 'datetime'],
]);

const OFFICE_ACTIVITY = table('OfficeActivity', [
  ['Operation', 'string'],
  ['UserId', 'string'],
  ['ClientIP', 'string'],
  ['OfficeWorkload', 'string'],
  ['ResultStatus', 'string'],
]);

const DEVICE_PROCESS_EVENTS = table('DeviceProcessEvents', [
  ['DeviceName', 'string'],
  ['AccountName', 'string'],
  ['FileName', 'string'],
  ['FolderPath', 'string'],
  ['ProcessCommandLine', 'string'],
  ['InitiatingProcessFileName', 'string'],
  ['InitiatingProcessCommandLine', 'string'],
  ['SHA256', 'string'],
]);

const DEVICE_NETWORK_EVENTS = table('DeviceNetworkEvents', [
  ['DeviceName', 'string'],
  ['RemoteIP', 'string'],
  ['RemotePort', 'int'],
  ['RemoteUrl', 'string'],
  ['ActionType', 'string'],
  ['InitiatingProcessFileName', 'string'],
]);

const APP_REQUESTS = table('AppRequests', [
  ['Name', 'string'],
  ['Url', 'string'],
  ['Success', 'bool'],
  ['ResultCode', 'string'],
  ['DurationMs', 'real'],
  ['AppRoleName', 'string'],
]);

const CONTOSO_FIREWALL = table('ContosoFirewall_CL', [
  ['SourceIP', 'string'],
  ['DestinationIP', 'string'],
  ['DestinationPort', 'int'],
  ['Action', 'string'],
  ['RuleName', 'string'],
]);

/** Workspaces with the Defender XDR connector (DeviceProcessEvents, DeviceNetworkEvents). */
const WITH_DEFENDER = new Set(['la-contoso-soc', 'la-fabrikam-sentinel', 'la-woodgrove-sentinel']);

export function demoSchemaFor(workspace: DemoWorkspace): WorkspaceSchemaData {
  const tables: SchemaTable[] = [HEARTBEAT, AZURE_ACTIVITY, USAGE];
  if (workspace.sentinel) {
    tables.push(SIGNIN_LOGS, AUDIT_LOGS, SECURITY_ALERT, SECURITY_INCIDENT, OFFICE_ACTIVITY);
    if (!workspace.name.includes('identity')) tables.push(SECURITY_EVENT);
  }
  if (WITH_DEFENDER.has(workspace.name)) tables.push(DEVICE_PROCESS_EVENTS, DEVICE_NETWORK_EVENTS);
  if (workspace.name.includes('apps')) tables.push(APP_REQUESTS);
  const isContoso = workspace.name.startsWith('la-contoso');
  if (isContoso && workspace.sentinel) tables.push(CONTOSO_FIREWALL);
  return {
    tables,
    functions:
      workspace.name === 'la-contoso-soc'
        ? [
            {
              name: 'FailedSignIns',
              parameters: 'lookback:timespan',
              body: 'SigninLogs | where TimeGenerated > ago(lookback) and ResultType != "0"',
              description: 'Failed sign-ins in the lookback window (demo function).',
            },
          ]
        : [],
  };
}

/** Demo stand-in for the metadata API: forbidden workspaces fail, like the fake query engine. */
export function demoFetchSchema(resourceId: string): Promise<WorkspaceSchemaData> {
  const workspace = DEMO_WORKSPACES.find((w) => demoResourceId(w) === resourceId.toLowerCase());
  if (workspace === undefined || workspace.behaviour === 'alwaysForbidden') {
    return Promise.reject(new Error('Forbidden'));
  }
  return Promise.resolve(demoSchemaFor(workspace));
}
