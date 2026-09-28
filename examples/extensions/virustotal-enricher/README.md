# VirusTotal Enricher

An example Raml KQL **enricher**. Right-click an IP address, domain, URL or file hash in a
result and choose **Enrich Value with VirusTotal** (or **Enrich Column**). The verdicts appear
as extra columns (`VirusTotal: verdict`, `VirusTotal: malicious`, …) next to the result. They
are a view on top of the data and are never saved.

## Permissions

| Permission                          | Why                                       |
| ----------------------------------- | ----------------------------------------- |
| `network` (www.virustotal.com only) | Query the VirusTotal API                  |
| `results.readSelection`             | Read only the values you choose to enrich |
| `secrets`                           | Keep your API key in the OS keychain      |

Raml KQL asks once per query run before any value leaves the app ("VirusTotal Enricher wants
to send 14 values (IP addresses) from this result to www.virustotal.com"). You can allow it for
the session or always, and revoke it in the Extensions view.

## Setup

Run **VirusTotal: Set API Key…** with your key from virustotal.com. The public API allows 4
lookups per minute; `virustotal-enricher.maxLookupsPerRun` (default 25) caps one enrichment.
