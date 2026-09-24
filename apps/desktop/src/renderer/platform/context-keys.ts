import { create } from 'zustand';

import type { ContextValues } from './when';

/**
 * Context keys for `when`-clauses (spec 01): `sideBarVisible`, `panelVisible`, `inQuickOpen`,
 * `inputFocus`, `isMac`, `demoMode`, `activeViewlet`, ...
 */
export const useContextKeys = create<{ values: ContextValues }>(() => ({ values: {} }));

export function setContextKey(key: string, value: unknown): void {
  const current = useContextKeys.getState().values;
  if (current[key] === value) return;
  useContextKeys.setState({ values: { ...current, [key]: value } });
}

export function getContextValues(): ContextValues {
  return useContextKeys.getState().values;
}
