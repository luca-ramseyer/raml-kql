import type { RamlKqlApi } from '../shared/ipc/contracts';

declare global {
  interface Window {
    /** Typed bridge to the main process, exposed by the preload script. */
    readonly ramlKql: RamlKqlApi;
  }
}

export {};
