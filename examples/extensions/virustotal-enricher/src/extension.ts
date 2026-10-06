import { ramlKql, type EnrichmentResult, type ExtensionContext } from '@raml-kql/extension-api';

import { enrichEntities, type StopReason } from './virustotal';

/**
 * VirusTotal Enricher (example extension). Everything it does goes through the host: the API
 * key is in the OS keychain (`secrets`), values come only from what you choose to enrich
 * (`results.readSelection`), and requests go only to www.virustotal.com (`network`), after you
 * allowed it for the query run.
 */
const KEY = 'apiKey';

/** Answers found so far, kept while the extension runs so a second run continues the first. */
const cache = new Map<string, EnrichmentResult>();

async function apiKey(): Promise<string | undefined> {
  const stored = await ramlKql.secrets.get(KEY);
  if (stored !== undefined && stored !== '') return stored;
  const entered = await ramlKql.window.showInputBox({
    prompt: 'VirusTotal API key (kept in the OS keychain)',
    placeHolder: 'Your key from virustotal.com → API key',
    password: true,
  });
  if (entered === undefined || entered.trim() === '') return undefined;
  await ramlKql.secrets.set(KEY, entered.trim());
  return entered.trim();
}

export function activate(context: ExtensionContext): void {
  context.subscriptions.push(
    ramlKql.commands.registerCommand('virustotal.setApiKey', async () => {
      await ramlKql.secrets.delete(KEY);
      if ((await apiKey()) !== undefined)
        await ramlKql.window.showInformationMessage('VirusTotal API key saved.');
    }),
    ramlKql.commands.registerCommand('virustotal.clearApiKey', async () => {
      await ramlKql.secrets.delete(KEY);
      await ramlKql.window.showInformationMessage('VirusTotal API key removed.');
    }),
    ramlKql.enrichment.registerProvider('virustotal', {
      async enrich(entities, token) {
        const key = await apiKey();
        if (key === undefined) return [];
        const setting = async (name: string, fallback: number): Promise<number> =>
          (await ramlKql.configuration.get<number>(`virustotal-enricher.${name}`)) ?? fallback;
        const limit = await setting('maxLookupsPerRun', 25);
        const requestsPerMinute = await setting('requestsPerMinute', 4);
        const budgetMs = (await setting('maxSecondsPerRun', 90)) * 1000;
        return ramlKql.window.withProgress(
          {
            title: `VirusTotal: looking up up to ${String(Math.min(entities.length, limit))} values`,
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
                isCancelled: () => token.isCancellationRequested,
              },
              { limit, requestsPerMinute, budgetMs },
            );
            const note = noteFor(outcome.stopped, outcome.remaining, requestsPerMinute);
            if (note !== undefined) await ramlKql.window.showInformationMessage(note);
            return outcome.results;
          },
        );
      },
    }),
  );
}

/** Why a run stopped early, and what to do. Undefined when everything was looked up. */
function noteFor(stopped: StopReason, remaining: number, rate: number): string | undefined {
  if (remaining === 0) return undefined;
  const more = `${String(remaining)} ${remaining === 1 ? 'value is' : 'values are'} still missing: choose Enrich again to continue (answers you already have are kept).`;
  switch (stopped) {
    case 'quota':
      return `VirusTotal's quota for your key is used up for now. ${more}`;
    case 'budget':
      return `VirusTotal looks up ${String(rate)} values per minute, so this run stopped after about a minute and a half. ${more}`;
    case 'limit':
      return `Stopped at the limit of virustotal-enricher.maxLookupsPerRun. ${more}`;
    default:
      return undefined;
  }
}
