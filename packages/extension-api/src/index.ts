/**
 * @raml-kql/extension-api — the public surface for extension authors (spec 07).
 *
 * Phase 0 placeholder: only the API version is defined. Extensions run in a sandboxed Web
 * Worker, so this package must never import Node.js modules (enforced by ESLint).
 */

/** Semver of the extension host API. Extensions declare a compatible range in their manifest. */
export const EXTENSION_API_VERSION = '0.1.0';
