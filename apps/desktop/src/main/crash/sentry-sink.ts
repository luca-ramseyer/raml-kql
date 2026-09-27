import { randomBytes } from 'node:crypto';

import type { CrashRecord } from '../../shared/crash/models';

/**
 * `crashReporting.mode: "auto"` (spec 10): sanitized records sent to Sentry's envelope API,
 * only when a DSN was configured at build time; public builds ship without one. No SDK: only
 * the sanitized record is sent (no breadcrumbs, no user, no device or server names).
 */
export interface CrashSink {
  send(record: CrashRecord): Promise<void>;
}

export interface Dsn {
  key: string;
  envelopeUrl: string;
}

export function parseDsn(dsn: string): Dsn | undefined {
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\/+|\/+$/g, '');
    if (url.protocol !== 'https:' || url.username === '' || !/^\d+$/.test(project)) {
      return undefined;
    }
    return { key: url.username, envelopeUrl: `https://${url.host}/api/${project}/envelope/` };
  } catch {
    return undefined;
  }
}

export class SentrySink implements CrashSink {
  constructor(
    private readonly dsn: Dsn,
    private readonly fetch: (url: string, init: RequestInit) => Promise<Response>,
  ) {}

  async send(record: CrashRecord): Promise<void> {
    const eventId = randomBytes(16).toString('hex');
    const [type = 'Error', ...rest] = record.message.split(': ');
    const event = {
      event_id: eventId,
      timestamp: Date.parse(record.ts) / 1000,
      platform: 'javascript',
      level: record.kind === 'renderer' ? 'error' : 'fatal',
      release: `raml-kql@${record.appVersion}`,
      environment: 'production',
      tags: {
        kind: record.kind,
        os: record.os,
        electron: record.electronVersion,
        ...(record.extensionId === undefined ? {} : { extension: record.extensionId }),
      },
      exception: { values: [{ type, value: rest.length > 0 ? rest.join(': ') : record.message }] },
      extra: record.stack === undefined ? {} : { stack: record.stack },
    };
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n');
    await this.fetch(this.dsn.envelopeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${this.dsn.key}, sentry_client=raml-kql/${record.appVersion}`,
      },
      body,
    });
  }
}
