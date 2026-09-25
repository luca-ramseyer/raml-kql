# Starter Hunting Pack

A small, practical set of queries for Log Analytics and Microsoft Sentinel, and an example of
the Raml KQL query pack format (see `docs/spec/08-query-packs.md`).

Every query runs unchanged in the Azure Portal: parameters are ordinary `let` statements with a
default value, which Raml KQL replaces with the values from the parameter bar.

| Query                                         | Area     | MITRE ATT&CK     |
| --------------------------------------------- | -------- | ---------------- |
| Failed sign-ins by user                       | Identity | T1110            |
| Successful sign-ins from new countries        | Identity | T1078.004        |
| Repeated MFA denials (MFA fatigue)            | Identity | T1621            |
| New admin role assignments                    | Identity | T1098.003        |
| Rare process executions                       | Endpoint | T1204, T1059     |
| Encoded PowerShell commands                   | Endpoint | T1059.001, T1027 |
| Inbound email with URL clicks                 | Email    | T1566.002        |
| Bulk Azure resource deletions                 | Azure    | T1485            |
| Tables with an ingestion drop in the last 24h | Health   | —                |
| Agents that stopped reporting                 | Health   | —                |
| Open incidents by severity                    | Triage   | —                |

Licensed under MIT.
