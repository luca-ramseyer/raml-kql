import {
  ISSUES_URL,
  type CrashKind,
  type CrashRecord,
  type CrashReport,
  type PendingCrashes,
} from '../../shared/crash/models';
import { sanitize, type SanitizeOptions } from '../../shared/crash/sanitize';

import type { CrashStore } from './crash-store';
import type { CrashSink } from './sentry-sink';

/**
 * Crash capture and reporting (spec 10): local first, user-sent. Errors are sanitized before
 * they are written; the next start offers a sanitized report the user can read, edit and file
 * on GitHub themselves.
 */
export interface CrashServiceOptions {
  store: CrashStore;
  env: { appVersion: string; electronVersion: string; os: string };
  /** Paths and names to scrub (read at capture time: tenant and workspace names change). */
  sanitizeOptions: () => SanitizeOptions;
  mode: () => 'ask' | 'off' | 'auto';
  sink?: CrashSink | undefined;
  now?: () => Date;
}

const MAX_PER_SESSION = 25;
/** GitHub rejects very long URLs; keep the prefilled issue well under the limit. */
const MAX_URL = 7500;

function toText(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: `${error.name}: ${error.message}`,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  if (typeof error === 'string') return { message: error };
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: 'Unknown error' };
  }
}

export class CrashService {
  private captured = 0;
  private unclean = false;

  constructor(private readonly options: CrashServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  clean(text: string): string {
    return sanitize(text, this.options.sanitizeOptions());
  }

  /** Remember whether the last session ended normally, and start this one. */
  async start(): Promise<void> {
    this.unclean = await this.options.store.startSession();
  }

  /** The app is quitting normally. */
  end(): void {
    this.options.store.endSession();
  }

  /** Record an error (sanitized). Never throws. */
  async capture(
    kind: CrashKind,
    error: unknown,
    extras: { extensionId?: string } = {},
  ): Promise<CrashRecord | undefined> {
    if (this.captured >= MAX_PER_SESSION) return undefined;
    this.captured += 1;
    try {
      const { message, stack } = toText(error);
      const record = await this.options.store.write({
        ts: this.now().toISOString(),
        kind,
        message: this.clean(message).slice(0, 4000),
        ...(stack === undefined ? {} : { stack: this.clean(stack).slice(0, 20_000) }),
        ...(extras.extensionId === undefined ? {} : { extensionId: extras.extensionId }),
        ...this.options.env,
      });
      if (this.options.mode() === 'auto' && this.options.sink !== undefined) {
        await this.options.sink.send(record).catch(() => undefined);
      }
      return record;
    } catch {
      return undefined;
    }
  }

  /** What to offer on this start: an unclean exit and/or errors since the user last looked. */
  async pending(): Promise<PendingCrashes> {
    if (this.options.mode() !== 'ask') return { unclean: false, records: [] };
    const seen = await this.options.store.lastSeen();
    const records = (await this.options.store.list()).filter((r) => r.ts > seen);
    const serious = records.filter((r) => r.kind !== 'renderer' && r.kind !== 'extension');
    // Errors the app survived only earn a prompt with a crash, or when they pile up.
    const worth = this.unclean || serious.length > 0 || records.length >= 3;
    return worth ? { unclean: this.unclean, records } : { unclean: false, records: [] };
  }

  async dismiss(): Promise<void> {
    await this.options.store.markSeen(this.now().toISOString());
    this.unclean = false;
  }

  /** The sanitized issue text (the user can still edit it before sending). */
  async report(): Promise<CrashReport> {
    const { records, unclean } = await this.pending();
    const { env } = this.options;
    const last = records.at(-1);
    const title =
      last === undefined
        ? 'Raml KQL closed unexpectedly'
        : `Crash: ${(last.message.split('\n')[0] ?? '').slice(0, 100)}`;
    const errors = records
      .slice(-5)
      .reverse()
      .map((r) =>
        [
          `### ${r.kind}${r.extensionId === undefined ? '' : ` (extension ${r.extensionId})`} — ${r.ts}`,
          '',
          '```',
          r.message,
          ...(r.stack === undefined ? [] : [r.stack.split('\n').slice(0, 25).join('\n')]),
          '```',
        ].join('\n'),
      );
    const body = [
      '**What happened?**',
      '',
      '<!-- What were you doing? Please do not paste query text, results or customer names. -->',
      '',
      '**Environment**',
      '',
      `- Raml KQL: ${env.appVersion}`,
      `- Electron: ${env.electronVersion}`,
      `- OS: ${env.os}`,
      ...(unclean ? ['- The previous session ended unexpectedly.'] : []),
      '',
      '**Errors** (sanitized: IDs, names, e-mail addresses, IPs, tokens and paths are replaced)',
      '',
      ...(errors.length === 0 ? ['No error was captured before the app closed.'] : errors),
      '',
      '<!-- A native crash dump may exist in the config folder under state/crashes/dumps. Attach it only if a maintainer asks for it: it can contain memory contents. -->',
    ].join('\n');
    return { title: this.clean(title), body };
  }

  /** The prefilled GitHub new-issue URL (the user submits it in the browser). */
  issueUrl(report: CrashReport): string {
    const title = this.clean(report.title).slice(0, 200);
    let body = this.clean(report.body);
    const build = (text: string): string =>
      `${ISSUES_URL}?${new URLSearchParams({ title, body: text, labels: 'crash' }).toString()}`;
    while (build(body).length > MAX_URL && body.length > 200) {
      body = `${body.slice(0, Math.floor(body.length * 0.8))}\n\n_(shortened)_`;
    }
    return build(body);
  }
}
