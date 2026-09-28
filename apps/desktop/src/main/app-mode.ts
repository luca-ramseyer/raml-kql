/**
 * Runtime mode resolved once at startup from CLI flags and environment variables.
 *
 * Demo mode (spec 04, "Demo mode") replaces every Azure-facing service with a deterministic
 * fake and makes no network calls. It is enabled with `--demo` or `RAML_KQL_DEMO=1`.
 */
export interface AppMode {
  demo: boolean;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function resolveAppMode(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): AppMode {
  const flag = argv.includes('--demo');
  const envValue = env['RAML_KQL_DEMO']?.trim().toLowerCase();
  const fromEnv = envValue !== undefined && TRUTHY.has(envValue);
  return { demo: flag || fromEnv };
}
