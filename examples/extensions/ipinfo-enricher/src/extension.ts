import { ramlKql, type EnrichmentResult, type ExtensionContext } from '@raml-kql/extension-api';

import { enrichEntities, type ApiKind, type StopReason } from './ipinfo';

/**
 * IPinfo Enricher (example extension). Everything it does goes through the host: the access
 * token is in the OS keychain (`secrets`), values come only from what you choose to enrich
 * (`results.readSelection`), and requests go only to api.ipinfo.io (`network`), after you
 * allowed it for the query run.
 */
const KEY = 'token';

/** Answers found so far, kept while the extension runs so a second run continues the first. */
const cache = new Map<string, EnrichmentResult>();

async function token(): Promise<string | undefined> {
  const stored = await ramlKql.secrets.get(KEY);
  if (stored !== undefined && stored !== '') return stored;
  const entered = await ramlKql.window.showInputBox({
    prompt: 'IPinfo access token (kept in the OS keychain). The free Lite plan is enough.',
    placeHolder: 'Your token from ipinfo.io → Dashboard → Token',
    password: true,
  });
  if (entered === undefined || entered.trim() === '') return undefined;
  await ramlKql.secrets.set(KEY, entered.trim());
  return entered.trim();
}

export function activate(context: ExtensionContext): void {
  context.subscriptions.push(
    ramlKql.commands.registerCommand('ipinfo.setToken', async () => {
      await ramlKql.secrets.delete(KEY);
      if ((await token()) !== undefined)
        await ramlKql.window.showInformationMessage('IPinfo access token saved.');
    }),
    ramlKql.commands.registerCommand('ipinfo.clearToken', async () => {
      await ramlKql.secrets.delete(KEY);
      await ramlKql.window.showInformationMessage('IPinfo access token removed.');
    }),
    ramlKql.enrichment.registerProvider('ipinfo', {
      async enrich(entities, cancellation) {
        const key = await token();
        if (key === undefined) return [];
        const setting = async (name: string, fallback: number): Promise<number> =>
          (await ramlKql.configuration.get<number>(`ipinfo-enricher.${name}`)) ?? fallback;
        const api: ApiKind =
          (await ramlKql.configuration.get<string>('ipinfo-enricher.api')) === 'lookup'
            ? 'lookup'
            : 'lite';
        const limit = await setting('maxLookupsPerRun', 500);
        const requestsPerMinute = await setting('requestsPerMinute', 600);
        const budgetMs = (await setting('maxSecondsPerRun', 90)) * 1000;
        return ramlKql.window.withProgress(
          {
            title: `IPinfo: looking up up to ${String(Math.min(entities.length, limit))} addresses`,
          },
          async () => {
            const outcome = await enrichEntities(
              entities,
              key,
              cache,
              {
                fetch: (url, init) => ramlKql.net.fetch(url, init),
                sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
                now: () => Date.now(),
                isCancelled: () => cancellation.isCancellationRequested,
              },
              { api, limit, requestsPerMinute, budgetMs },
            );
            const note = noteFor(outcome.stopped, outcome.remaining);
            if (note !== undefined) await ramlKql.window.showInformationMessage(note);
            return outcome.results;
          },
        );
      },
    }),
  );
}

/** Why a run stopped early, and what to do. Undefined when everything was looked up. */
function noteFor(stopped: StopReason, remaining: number): string | undefined {
  if (remaining === 0) return undefined;
  const more = `${String(remaining)} ${remaining === 1 ? 'address is' : 'addresses are'} still missing: choose Enrich again to continue (answers you already have are kept).`;
  switch (stopped) {
    case 'quota':
      return `IPinfo's quota for your token is used up for now. ${more}`;
    case 'budget':
      return `This run stopped after ipinfo-enricher.maxSecondsPerRun. ${more}`;
    case 'limit':
      return `Stopped at the limit of ipinfo-enricher.maxLookupsPerRun. ${more}`;
    default:
      return undefined;
  }
}
