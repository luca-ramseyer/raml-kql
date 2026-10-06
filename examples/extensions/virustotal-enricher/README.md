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

Run **VirusTotal: Set API Key…** with your key from virustotal.com.

## Rate limits and enriching a whole column

The public VirusTotal API allows **4 lookups per minute** (and 500 per day). The extension paces
its requests to the key's rate, so **Enrich Column** on a long column takes a while: one value
every 15 seconds with a public key. A run stops after about a minute and a half and shows what it
found; the answers are kept, so choosing **Enrich Column** again continues with the values that are
still missing. If VirusTotal reports that your quota is used up, the run stops the same way
instead of failing, and keeps everything it already has.

| Setting                                 | Default | Meaning                                             |
| --------------------------------------- | ------- | --------------------------------------------------- |
| `virustotal-enricher.requestsPerMinute` | 4       | Lookup pace. Premium keys allow far more: raise it. |
| `virustotal-enricher.maxLookupsPerRun`  | 25      | At most this many new values per run.               |
| `virustotal-enricher.maxSecondsPerRun`  | 90      | A run stops starting new lookups after this long.   |
