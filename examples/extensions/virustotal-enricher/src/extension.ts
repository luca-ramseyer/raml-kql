import {
  ramlKql,
  type Entity,
  type EnrichmentResult,
  type ExtensionContext,
} from '@raml-kql/extension-api';

import { endpoints, toResult } from './virustotal';

/**
 * VirusTotal Enricher (example extension). Everything it does goes through the host: the API
 * key is in the OS keychain (`secrets`), values come only from what you choose to enrich
 * (`results.readSelection`), and requests go only to www.virustotal.com (`network`), after you
 * allowed it for the query run.
 */
const KEY = 'apiKey';

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

async function lookUp(entity: Entity, key: string): Promise<EnrichmentResult | undefined> {
  const target = endpoints(entity);
  if (target === undefined) return undefined;
  const response = await ramlKql.net.fetch(target.api, {
    headers: { 'x-apikey': key, accept: 'application/json' },
  });
  if (response.status === 404)
    return {
      entity,
      fields: { verdict: 'unknown to VirusTotal', malicious: null },
      url: target.gui,
    };
  if (response.status === 401)
    throw new Error('VirusTotal refused the API key. Run "VirusTotal: Set API Key…".');
  if (response.status === 429) throw new Error('VirusTotal quota exceeded; try again later.');
  if (!response.ok)
    return { entity, fields: { verdict: `error ${String(response.status)}`, malicious: null } };
  return toResult(entity, await response.json(), target.gui);
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
        const limit =
          (await ramlKql.configuration.get<number>('virustotal-enricher.maxLookupsPerRun')) ?? 25;
        const results: EnrichmentResult[] = [];
        return ramlKql.window.withProgress(
          { title: `VirusTotal: looking up ${String(Math.min(entities.length, limit))} values` },
          async () => {
            for (const entity of entities.slice(0, limit)) {
              if (token.isCancellationRequested) break;
              const result = await lookUp(entity, key);
              if (result !== undefined) results.push(result);
            }
            return results;
          },
        );
      },
    }),
  );
}
