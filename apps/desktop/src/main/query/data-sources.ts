import { QueryFailure } from '../azure/log-analytics-query';

import type { DataSource } from './query-engine';

/**
 * Data sources behind one interface (spec 01, `DataSourceRegistry`): the built-in Log
 * Analytics source is registered like any other, and each workspace is routed to its
 * `dataSourceId` (Log Analytics when it has none).
 */
export const LOG_ANALYTICS_SOURCE = 'log-analytics';

export class DataSourceRegistry {
  private readonly sources = new Map<string, { title: string; source: DataSource }>();

  register(id: string, title: string, source: DataSource): () => void {
    if (this.sources.has(id)) throw new Error(`The data source ${id} is already registered.`);
    const entry = { title, source };
    this.sources.set(id, entry);
    return () => {
      if (this.sources.get(id) === entry) this.sources.delete(id);
    };
  }

  list(): { id: string; title: string }[] {
    return [...this.sources].map(([id, { title }]) => ({ id, title }));
  }

  /** The source the engine calls: routes each workspace to its data source. */
  router(): DataSource {
    return {
      execute: (request) => {
        const id = request.workspace.dataSourceId ?? LOG_ANALYTICS_SOURCE;
        const entry = this.sources.get(id);
        if (entry === undefined) {
          return Promise.reject(
            new QueryFailure(
              'badRequest',
              `The data source "${id}" is not available (is its extension disabled?).`,
            ),
          );
        }
        return entry.source.execute(request);
      },
    };
  }
}
