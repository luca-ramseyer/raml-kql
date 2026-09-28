/**
 * KQL snippets (spec 05): common patterns, in Monaco snippet syntax. All use `TimeGenerated`
 * (Log Analytics), never `Timestamp`.
 */
export interface KqlSnippet {
  prefix: string;
  label: string;
  description: string;
  body: string;
}

export const KQL_SNIPPETS: readonly KqlSnippet[] = [
  {
    prefix: 'sumbin',
    label: 'summarize by bin',
    description: 'Count events per time bucket',
    body: '${1:Table}\n| where TimeGenerated > ago(${2:1d})\n| summarize ${3:Count} = count() by bin(TimeGenerated, ${4:1h})\n| order by TimeGenerated asc',
  },
  {
    prefix: 'timechart',
    label: 'timechart',
    description: 'Events per time bucket, rendered as a chart',
    body: '${1:Table}\n| where TimeGenerated > ago(${2:7d})\n| summarize count() by bin(TimeGenerated, ${3:1h}), ${4:Column}\n| render timechart',
  },
  {
    prefix: 'join',
    label: 'join template',
    description: 'Join two tables on a key',
    body: '${1:LeftTable}\n| where TimeGenerated > ago(${2:1d})\n| join kind=${3|inner,leftouter,rightouter,fullouter,leftanti,rightanti,leftsemi|} (\n    ${4:RightTable}\n    | where TimeGenerated > ago($2)\n) on ${5:Key}',
  },
  {
    prefix: 'let',
    label: 'let parameters',
    description: 'Query parameters as let statements',
    body: 'let lookback = ${1:1d};\nlet ${2:watchlist} = dynamic([${3:"value"}]);\n${4:Table}\n| where TimeGenerated > ago(lookback)\n| where ${5:Column} in ($2)',
  },
  {
    prefix: 'parsejson',
    label: 'parse_json',
    description: 'Extract fields from a JSON string column',
    body: '${1:Table}\n| where TimeGenerated > ago(${2:1d})\n| extend Parsed = parse_json(${3:Column})\n| extend ${4:Field} = tostring(Parsed.${5:path})',
  },
  {
    prefix: 'mvexpand',
    label: 'mv-expand',
    description: 'One row per element of a dynamic array',
    body: '${1:Table}\n| where TimeGenerated > ago(${2:1d})\n| mv-expand ${3:Item} = ${4:ArrayColumn}\n| extend ${5:Field} = tostring($3.${6:name})',
  },
  {
    prefix: 'top',
    label: 'top N by count',
    description: 'Most frequent values of a column',
    body: '${1:Table}\n| where TimeGenerated > ago(${2:1d})\n| summarize Count = count() by ${3:Column}\n| top ${4:10} by Count',
  },
  {
    prefix: 'firstlast',
    label: 'first and last seen',
    description: 'First and last occurrence per key',
    body: '${1:Table}\n| where TimeGenerated > ago(${2:30d})\n| summarize FirstSeen = min(TimeGenerated), LastSeen = max(TimeGenerated), Count = count() by ${3:Column}',
  },
];

/** The snippet as plain KQL, placeholders filled with their defaults (for the docs pane). */
export function snippetPreview(body: string): string {
  const defaults = new Map<string, string>();
  const filled = body.replace(
    /\$\{(\d+)(?::([^}]*)|\|([^|},]*)[^}]*\|)\}/g,
    (_match, index: string, text: string | undefined, choice: string | undefined) => {
      const value = text ?? choice ?? '';
      defaults.set(index, value);
      return value;
    },
  );
  return filled.replace(/\$(\d+)/g, (_match, index: string) => defaults.get(index) ?? '');
}
