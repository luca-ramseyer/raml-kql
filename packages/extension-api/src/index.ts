/**
 * @raml-kql/extension-api — the public surface for extension authors (spec 07).
 *
 * ```ts
 * import { ramlKql, type ExtensionContext } from '@raml-kql/extension-api';
 *
 * export function activate(context: ExtensionContext) {
 *   context.subscriptions.push(
 *     ramlKql.commands.registerCommand('hello.world', () =>
 *       ramlKql.window.showInformationMessage('Hello!'),
 *     ),
 *   );
 * }
 * ```
 *
 * Extensions run in a sandboxed Web Worker, so this package never imports Node.js modules
 * (enforced by ESLint). Bundle it into your extension; at runtime it reads the `ramlKql`
 * object the host provides.
 */
import type { RamlKqlApi } from './types';

export type * from './types';

/** Semver of the extension host API. Extensions declare a compatible range in `engines`. */
export const EXTENSION_API_VERSION = '1.0.0';

/** The host API. Only usable inside the Raml KQL extension host. */
export const ramlKql: RamlKqlApi = new Proxy({} as RamlKqlApi, {
  get(_target, key) {
    const api = (globalThis as { ramlKql?: RamlKqlApi }).ramlKql;
    if (api === undefined) {
      throw new Error('ramlKql is only available inside the Raml KQL extension host.');
    }
    return api[key as keyof RamlKqlApi];
  },
});
