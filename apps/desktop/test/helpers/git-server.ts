import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

/**
 * Test-only git hosting: bare repositories made with the system git, served over smart HTTP
 * by `git http-backend` (CGI) on 127.0.0.1. The app itself never needs system git; this only
 * stands in for GitHub in tests.
 */
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'author@contoso.example',
  GIT_COMMITTER_NAME: 'Test Author',
  GIT_COMMITTER_EMAIL: 'author@contoso.example',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      env: { ...process.env, ...GIT_ENV },
      encoding: 'utf8',
    },
  ).trim();
}

export interface TestRepo {
  /** Name in the server root (`name.git`). */
  name: string;
  /** Commit files (path → text, `null` deletes) and push; returns the new SHA. */
  commit(files: Record<string, string | null>, message: string): string;
}

/** A bare repo `<root>/<name>.git` with a working clone to commit from. */
export function createRepo(root: string, name: string): TestRepo {
  const bare = path.join(root, `${name}.git`);
  const work = path.join(root, `${name}-work`);
  mkdirSync(bare, { recursive: true });
  git(bare, 'init', '--bare', '--quiet');
  mkdirSync(work, { recursive: true });
  git(work, 'init', '--quiet');
  git(work, 'remote', 'add', 'origin', bare);
  return {
    name,
    commit(files, message) {
      for (const [file, text] of Object.entries(files)) {
        const target = path.join(work, file);
        if (text === null) rmSync(target, { force: true });
        else {
          mkdirSync(path.dirname(target), { recursive: true });
          writeFileSync(target, text);
        }
      }
      git(work, 'add', '--all');
      git(work, 'commit', '--quiet', '-m', message);
      git(work, 'push', '--quiet', 'origin', 'HEAD:main');
      return git(work, 'rev-parse', 'HEAD');
    },
  };
}

export interface GitServer {
  url(name: string): string;
  close(): Promise<void>;
}

function authorized(request: IncomingMessage, token: string | undefined): boolean {
  if (token === undefined) return true;
  const header = request.headers.authorization ?? '';
  const [, encoded = ''] = /^Basic (.+)$/.exec(header) ?? [];
  const password = Buffer.from(encoded, 'base64').toString('utf8').split(':').slice(1).join(':');
  return password === token;
}

function handle(
  root: string,
  token: string | undefined,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (!authorized(request, token)) {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' });
    response.end();
    return;
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const child = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: decodeURIComponent(url.pathname),
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: request.method ?? 'GET',
      CONTENT_TYPE: request.headers['content-type'] ?? '',
      ...(request.headers['content-encoding'] === undefined
        ? {}
        : { HTTP_CONTENT_ENCODING: request.headers['content-encoding'] }),
      ...(request.headers['git-protocol'] === undefined
        ? {}
        : { GIT_PROTOCOL: String(request.headers['git-protocol']) }),
    },
  });
  request.pipe(child.stdin);
  let buffer = Buffer.alloc(0);
  let headersDone = false;
  child.stdout.on('data', (chunk: Buffer) => {
    if (headersDone) {
      response.write(chunk);
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;
    headersDone = true;
    let status = 200;
    for (const line of buffer.subarray(0, end).toString('utf8').split('\r\n')) {
      const colon = line.indexOf(':');
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (key.toLowerCase() === 'status') status = Number.parseInt(value, 10);
      else response.setHeader(key, value);
    }
    response.statusCode = status;
    response.write(buffer.subarray(end + 4));
  });
  child.on('close', () => response.end());
  child.on('error', () => {
    response.statusCode = 500;
    response.end();
  });
}

/** Serve the bare repositories in `root` on 127.0.0.1 (optionally requiring a token). */
export async function startGitServer(
  root: string,
  options: { token?: string } = {},
): Promise<GitServer> {
  const server = createServer((request, response) => {
    handle(root, options.token, request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (name) => `http://127.0.0.1:${String(port)}/${name}.git`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
