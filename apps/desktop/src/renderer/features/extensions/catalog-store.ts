import { create } from 'zustand';

import type { CatalogResult } from '../../../shared/extensions/models';
import { getBridge, unwrap } from '../../services/ipc';

/**
 * The extension catalog behind the Browse tab (D-058). It loads only when the user opens
 * Browse or presses Refresh, never at startup.
 */
export type ExtensionsTab = 'installed' | 'browse';

interface CatalogState {
  tab: ExtensionsTab;
  search: string;
  result: CatalogResult | undefined;
  loading: boolean;
  /** The request itself failed (not "the catalog is empty"). */
  error: string | undefined;
}

export const useCatalog = create<CatalogState>(() => ({
  tab: 'installed',
  search: '',
  result: undefined,
  loading: false,
  error: undefined,
}));

export function setExtensionsTab(tab: ExtensionsTab): void {
  useCatalog.setState({ tab, search: '' });
  if (tab === 'browse' && useCatalog.getState().result === undefined) void loadCatalog(false);
}

export function setExtensionsSearch(search: string): void {
  useCatalog.setState({ search });
}

export async function loadCatalog(refresh: boolean): Promise<void> {
  if (useCatalog.getState().loading) return;
  useCatalog.setState({ loading: true, error: undefined });
  try {
    const result = await unwrap(getBridge().extensions.catalog({ refresh }));
    useCatalog.setState({ result, loading: false });
  } catch (error) {
    useCatalog.setState({
      loading: false,
      error: error instanceof Error ? error.message : 'The catalog could not be loaded.',
    });
  }
}

/** "3 hours ago" for the "updated" line. */
export function ago(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${String(hours)} h ago`;
  return `${String(Math.round(hours / 24))} days ago`;
}
