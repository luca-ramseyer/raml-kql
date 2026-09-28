/**
 * Short descriptions of common Log Analytics / Microsoft Sentinel tables for hovers and
 * completions (spec 05). Written for this project; not copied from Microsoft documentation.
 * The metadata API's own description wins when a workspace provides one.
 */
export const TABLE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  AADNonInteractiveUserSignInLogs:
    'Entra ID sign-ins performed by clients on behalf of a user, such as token refreshes.',
  AADServicePrincipalSignInLogs: 'Entra ID sign-ins by service principals (apps, not users).',
  AADManagedIdentitySignInLogs: 'Entra ID sign-ins by managed identities.',
  AlertEvidence: 'Entities (files, IPs, users, devices) attached to Defender XDR alerts.',
  AlertInfo: 'Defender XDR alerts: title, severity, category and detection source.',
  AppRequests: 'Incoming requests recorded by Application Insights.',
  AuditLogs: 'Entra ID directory changes: users, groups, apps, roles and policies.',
  AzureActivity: 'Azure control-plane operations on subscriptions and resources.',
  AzureDiagnostics: 'Diagnostic logs from Azure services that use the legacy shared table.',
  CommonSecurityLog: 'CEF-formatted events from firewalls, proxies and other appliances.',
  DeviceEvents: 'Miscellaneous Defender for Endpoint device events and security controls.',
  DeviceFileEvents: 'File creation, modification and deletion on Defender-onboarded devices.',
  DeviceInfo: 'Defender for Endpoint device inventory: OS, domain, exposure and health.',
  DeviceLogonEvents: 'Sign-ins and other authentication events on devices.',
  DeviceNetworkEvents: 'Network connections made by processes on devices.',
  DeviceProcessEvents: 'Process creation on devices, with command lines and parent processes.',
  DeviceRegistryEvents: 'Registry key and value changes on Windows devices.',
  EmailEvents: 'Defender for Office 365 email delivery and filtering results.',
  Heartbeat: 'Periodic check-ins from monitoring agents; shows which machines report in.',
  IdentityLogonEvents: 'Authentication activity seen by Defender for Identity and cloud apps.',
  OfficeActivity: 'Microsoft 365 audit activity from Exchange, SharePoint, OneDrive and Teams.',
  SecurityAlert: 'Alerts raised by Sentinel analytics rules and connected security products.',
  SecurityEvent: 'Windows Security event log entries collected from machines.',
  SecurityIncident: 'Sentinel incidents with their status, owner, severity and alerts.',
  SigninLogs: 'Interactive Entra ID user sign-ins, with result, location and risk.',
  Syslog: 'Syslog messages from Linux machines and network devices.',
  ThreatIntelligenceIndicator: 'Threat intelligence indicators imported into Sentinel.',
  Usage: 'Hourly ingestion volume per data type in the workspace.',
  W3CIISLog: 'IIS web server access logs.',
  Event: 'Windows event log entries other than the Security log.',
};
