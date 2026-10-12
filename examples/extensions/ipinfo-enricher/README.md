# IPinfo Enricher

An example Raml KQL **enricher**. Right-click an IP address in a result and choose **Enrich Value
with IPinfo** (or **Enrich Column**). Country, network owner (ASN) and, on paid plans, city,
network type and hosting or VPN flags appear as extra columns (`IPinfo: country`,
`IPinfo: as_name`, …) next to the result. They are a view on top of the data and are never saved.

## Permissions

| Permission                     | Why                                       |
| ------------------------------ | ----------------------------------------- |
| `network` (api.ipinfo.io only) | Query the IPinfo API                      |
| `results.readSelection`        | Read only the values you choose to enrich |
| `secrets`                      | Keep your access token in the OS keychain |

Raml KQL asks once per query run before any value leaves the app ("IPinfo Enricher wants to send
14 values (IP addresses) from this result to api.ipinfo.io"). You can allow it for the session or
always, and revoke it in the Extensions view.

**Private and reserved addresses are never sent.** `10.0.0.0/8`, `192.168.0.0/16`, loopback,
link-local, carrier-grade NAT, documentation ranges, IPv6 unique-local and similar addresses get
the note `private or reserved address` without a request. The access token is sent in the
`Authorization` header, so it never appears in a URL or in Network Activity.

## Setup

Create a free account on ipinfo.io and run **IPinfo: Set Access Token…** with the token from your
dashboard. The free **Lite** plan has no request limit.

## Columns

| `ipinfo-enricher.api` | Plan            | Columns                                                                                  |
| --------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `lite` (default)      | Free            | `country`, `country_code`, `asn`, `as_name`, `as_domain`                                 |
| `lookup`              | Core and higher | The above, plus `region`, `city`, `as_type`, `hosting`, `anonymous`, `anycast`, `mobile` |
| `lookup`              | Plus and higher | The above, plus `vpn`, `proxy`, `tor`, `relay`, `privacy_service`                        |

A `note` column explains rows without an answer: `private or reserved address`, `unknown to
IPinfo`, or an HTTP error (errors are tried again on the next run).

## Limits

| Setting                             | Default | Meaning                                           |
| ----------------------------------- | ------- | ------------------------------------------------- |
| `ipinfo-enricher.requestsPerMinute` | 600     | Lookup pace.                                      |
| `ipinfo-enricher.maxLookupsPerRun`  | 500     | At most this many new values per run.             |
| `ipinfo-enricher.maxSecondsPerRun`  | 90      | A run stops starting new lookups after this long. |

A run that stops early shows what it found; the answers are kept, so choosing **Enrich** again
continues with the values that are still missing. If IPinfo reports that a paid plan's quota is
used up, the run stops the same way instead of failing.
