import type { NetworkActivity, NetworkHost } from '../../shared/network/activity';

/**
 * The hosts contacted this session (spec 10, "Network Activity"). In memory only; records the
 * host (with port when not default) and a category, never a path, query string or body.
 */
export class NetworkActivityRecorder {
  private readonly hosts = new Map<string, NetworkHost>();
  private readonly since: string;

  constructor(private readonly now: () => Date = () => new Date()) {
    this.since = now().toISOString();
  }

  record(url: string, category: string): void {
    let host: string;
    try {
      const parsed = new URL(url);
      if (!/^(https?|wss?):$/.test(parsed.protocol)) return;
      host = parsed.host;
    } catch {
      return;
    }
    const key = `${category}|${host}`;
    const at = this.now().toISOString();
    const entry = this.hosts.get(key);
    if (entry === undefined)
      this.hosts.set(key, { host, category, count: 1, firstSeen: at, lastSeen: at });
    else this.hosts.set(key, { ...entry, count: entry.count + 1, lastSeen: at });
  }

  snapshot(): NetworkActivity {
    return {
      since: this.since,
      hosts: [...this.hosts.values()].sort(
        (a, b) => a.category.localeCompare(b.category) || a.host.localeCompare(b.host),
      ),
    };
  }
}

/** The app-wide recorder (set at startup; a no-op recorder before that, e.g. in tests). */
let current: NetworkActivityRecorder | undefined;

export function setNetworkRecorder(recorder: NetworkActivityRecorder): void {
  current = recorder;
}

export function recordNetwork(url: string, category: string): void {
  current?.record(url, category);
}
