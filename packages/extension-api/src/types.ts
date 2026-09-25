/**
 * Public types of the Raml KQL extension API v1 (spec 07). Extensions run in a sandboxed Web
 * Worker with no DOM, Node or network; everything goes through `ramlKql`, and the host checks
 * permissions for every call.
 */

export interface Disposable {
  dispose(): void;
}

/** Entity types detected in result cells (spec 07). */
export type EntityType =
  | 'ip'
  | 'domain'
  | 'url'
  | 'md5'
  | 'sha1'
  | 'sha256'
  | 'upn'
  | 'email'
  | 'hostname'
  | 'deviceId'
  | 'aadObjectId'
  | 'tenantId';

export interface Entity {
  type: EntityType;
  value: string;
}

/** What an enricher returns per entity: short fields shown as extra result columns. */
export interface EnrichmentResult {
  entity: Entity;
  fields: Record<string, string | number | boolean | null>;
  /** Optional link for "Open in …". */
  url?: string;
}

export interface EnrichmentProvider {
  enrich(entities: Entity[], token: CancellationToken): Promise<EnrichmentResult[]>;
}

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
}

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
}

export interface InputBoxOptions {
  prompt?: string;
  placeHolder?: string;
  value?: string;
  password?: boolean;
}

/** The subset of `Response` extensions get back from `net.fetch`. */
export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface FetchInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
}

export interface Webview {
  postMessage(message: unknown): Promise<void>;
  onDidReceiveMessage(listener: (message: unknown) => void): Disposable;
}

export interface WebviewViewProvider {
  resolveWebviewView(webview: Webview): void | Promise<void>;
}

export interface ExtensionContext {
  /** `publisher.name`. */
  readonly extensionId: string;
  readonly extensionVersion: string;
  /** Disposed when the extension is deactivated (disabled, uninstalled or updated). */
  readonly subscriptions: Disposable[];
}

export interface Environment {
  readonly appVersion: string;
  readonly apiVersion: string;
  /** `dark`, `light` or `high-contrast`. */
  readonly theme: string;
  /** Presentation mode (aliasing) was on when the extension started. */
  readonly presentationMode: boolean;
}

export interface QueryTabOptions {
  query: string;
  title?: string;
}

/** The `ramlKql` object available to extension code. */
export interface RamlKqlApi {
  readonly commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable;
    /** The extension's own commands, and host commands on a public allowlist. */
    executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
  };
  readonly window: {
    showInformationMessage(message: string, ...actions: string[]): Promise<string | undefined>;
    showWarningMessage(message: string, ...actions: string[]): Promise<string | undefined>;
    showErrorMessage(message: string, ...actions: string[]): Promise<string | undefined>;
    showQuickPick(
      items: (string | QuickPickItem)[],
      options?: { placeHolder?: string },
    ): Promise<QuickPickItem | undefined>;
    showInputBox(options?: InputBoxOptions): Promise<string | undefined>;
    withProgress<T>(options: { title: string }, task: () => Promise<T>): Promise<T>;
  };
  readonly enrichment: {
    registerProvider(id: string, provider: EnrichmentProvider): Disposable;
  };
  readonly views: {
    registerWebviewView(viewId: string, provider: WebviewViewProvider): Disposable;
  };
  readonly net: {
    /** Permission `network`: only to the hosts in the manifest, and only once granted. */
    fetch(url: string, init?: FetchInit): Promise<FetchResponse>;
  };
  readonly secrets: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  /** Per-extension JSON storage (5 MB). Never store result data here. */
  readonly storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };
  readonly configuration: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    onDidChangeConfiguration(listener: (keys: string[]) => void): Disposable;
  };
  readonly editor: {
    getActiveQuery(): Promise<string | undefined>;
    insertText(text: string): Promise<void>;
    openQueryTab(options: QueryTabOptions): Promise<void>;
  };
  readonly clipboard: {
    /** Permission `clipboard.write`. */
    writeText(text: string): Promise<void>;
  };
  readonly env: Environment;
}
