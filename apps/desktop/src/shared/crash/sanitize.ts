/**
 * Crash report sanitizer (spec 10): runs before anything is written, shown or sent. Stack
 * traces keep their shape with app-relative paths; everything that could identify a customer,
 * a user or a secret is replaced by a placeholder.
 */
export interface SanitizeOptions {
  /** The user's home directory (replaced by `~`). */
  homeDir?: string | undefined;
  /** The app's install/resources path (replaced by `<app>`). */
  appDir?: string | undefined;
  /** Known sensitive names: tenant, subscription, workspace and account names. */
  names?: readonly string[] | undefined;
}

const RULES: [RegExp, string][] = [
  // JWTs and bearer tokens.
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}\b/g, '<jwt>'],
  [/\b(Bearer|Basic)\s+[\w\-.~+/=]{8,}/gi, '$1 <token>'],
  [
    /\b(token|secret|password|passwd|pwd|apikey|api_key|client_secret|access_token|refresh_token|code|sig)=([^&\s"']+)/gi,
    '$1=<redacted>',
  ],
  // Emails and UPNs.
  [/\b[\w.%+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '<email>'],
  // ARM resource paths leak resource group and workspace names.
  [/\/subscriptions\/[^\s"'<>]+/gi, '/subscriptions/<resource>'],
  // GUIDs (tenant, subscription, workspace, object IDs).
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<guid>'],
  // IPv4 and IPv6 addresses.
  [/\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b/g, '<ip>'],
  // Long hex or base64 blobs (keys, hashes, cache contents).
  [/\b[0-9a-f]{40,}\b/gi, '<hex>'],
  [/\b[A-Za-z0-9+/]{48,}={0,2}(?![\w/])/g, '<base64>'],
];

/** Quoted text in messages is usually user data (query snippets, names, values). */
const QUOTED = /(["'`])(?:(?!\1)[^\\\n]|\\.){12,}\1/g;

/** KQL in messages: a table name followed by a pipe, or a `let` statement. */
const KQL =
  /\blet\s+\w+\s*=[^;\n]*;?|\b[A-Z][A-Za-z0-9_]*\s*\|\s*(where|project|summarize|extend|take|limit|join|union|top|sort|order|count|render|parse|mv-expand|distinct)\b[^\n]*/g;

/** IPv6, including `::` compression; plain times (`10:20:30`) are left alone. */
const IPV6 = /(?<![\w:.])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitize(text: string, options: SanitizeOptions = {}): string {
  let out = text;
  if (options.appDir !== undefined && options.appDir.length > 3) {
    out = out.split(options.appDir).join('<app>');
  }
  if (options.homeDir !== undefined && options.homeDir.length > 3) {
    out = out.split(options.homeDir).join('~');
    out = out.split(options.homeDir.replace(/\\/g, '/')).join('~');
  }
  // Other users' profile paths (e.g. in a message copied from a different machine).
  out = out.replace(/([A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\\/\s"'<>]+/g, '~');
  out = out.replace(KQL, '<query>');
  out = out.replace(QUOTED, '$1<text>$1');
  for (const name of [...(options.names ?? [])].sort((a, b) => b.length - a.length)) {
    const trimmed = name.trim();
    if (trimmed.length < 3) continue;
    out = out.replace(new RegExp(escapeRegex(trimmed), 'gi'), '<name>');
  }
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  out = out.replace(IPV6, (match) => (/::|[a-f]/i.test(match) ? '<ip>' : match));
  return out;
}
