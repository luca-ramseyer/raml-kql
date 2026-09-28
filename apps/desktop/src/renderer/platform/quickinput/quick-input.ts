import { create } from 'zustand';

import { setContextKey } from '../context-keys';
import { fuzzyMatch, type MatchRange } from '../fuzzy';

/**
 * The quick input widget (spec 05): command palette, quick open and pickers such as the colour
 * theme picker all use it. Quick access providers are chosen by prefix, as in VS Code:
 * `>` commands, `?` help, no prefix for the default provider.
 */

export interface QuickPickItem {
  id: string;
  label: string;
  description?: string | undefined;
  detail?: string | undefined;
  /** Codicon name shown before the label. */
  icon?: string | undefined;
  /** Keybinding label shown on the right. */
  keybinding?: string | undefined;
  /** Separator label shown above this item when it starts a new group. */
  group?: string | undefined;
  highlights?: MatchRange[] | undefined;
}

export interface QuickInputProvider {
  placeholder: string;
  /** Items for the current filter text (without the prefix). */
  getItems(filter: string): QuickPickItem[];
  /** Enter or click. The widget closes before this runs. */
  onAccept(item: QuickPickItem | undefined, filter: string): void;
  /** The highlighted item changed (e.g. live theme preview). */
  onActive?(item: QuickPickItem | undefined): void;
  /** Closed without accepting (Escape, focus lost). */
  onCancel?(): void;
  /** Text shown when nothing matches. */
  noResultsText?: string;
}

export interface QuickAccessProvider extends QuickInputProvider {
  prefix: string;
  /** One-line description for the `?` help list. */
  helpText: string;
}

interface QuickInputState {
  visible: boolean;
  value: string;
  /** Fixed provider (pickers) or undefined for prefix-based quick access. */
  picker: QuickInputProvider | undefined;
  activeIndex: number;
}

export const useQuickInput = create<QuickInputState>(() => ({
  visible: false,
  value: '',
  picker: undefined,
  activeIndex: 0,
}));

const accessProviders: QuickAccessProvider[] = [];

export function registerQuickAccessProvider(provider: QuickAccessProvider): () => void {
  accessProviders.push(provider);
  // Longest prefix first, so `>` wins over the empty default prefix.
  accessProviders.sort((a, b) => b.prefix.length - a.prefix.length);
  return () => {
    const index = accessProviders.indexOf(provider);
    if (index >= 0) accessProviders.splice(index, 1);
  };
}

export function quickAccessProviders(): readonly QuickAccessProvider[] {
  return accessProviders;
}

/** The provider for the current state, and the filter text it should see. */
export function currentProvider(
  state: Pick<QuickInputState, 'picker' | 'value'> = useQuickInput.getState(),
): { provider: QuickInputProvider | undefined; filter: string } {
  if (state.picker !== undefined) return { provider: state.picker, filter: state.value };
  const provider = accessProviders.find((p) => state.value.startsWith(p.prefix));
  return {
    provider,
    filter: provider === undefined ? state.value : state.value.slice(provider.prefix.length),
  };
}

export function openQuickAccess(value = ''): void {
  useQuickInput.setState({ visible: true, value, picker: undefined, activeIndex: 0 });
  setContextKey('inQuickOpen', true);
}

export function showQuickPick(picker: QuickInputProvider, initialValue = ''): void {
  const previous = useQuickInput.getState();
  if (previous.visible) currentProvider(previous).provider?.onCancel?.();
  useQuickInput.setState({ visible: true, value: initialValue, picker, activeIndex: 0 });
  setContextKey('inQuickOpen', true);
}

export function setQuickInputValue(value: string): void {
  useQuickInput.setState({ value, activeIndex: 0 });
}

export function setQuickInputActiveIndex(activeIndex: number): void {
  useQuickInput.setState({ activeIndex });
}

export function hideQuickInput(cancelled = true): void {
  const state = useQuickInput.getState();
  if (!state.visible) return;
  const { provider } = currentProvider(state);
  useQuickInput.setState({ visible: false, value: '', picker: undefined, activeIndex: 0 });
  setContextKey('inQuickOpen', false);
  if (cancelled) provider?.onCancel?.();
}

export function acceptQuickInput(item: QuickPickItem | undefined): void {
  const state = useQuickInput.getState();
  const { provider, filter } = currentProvider(state);
  hideQuickInput(false);
  provider?.onAccept(item, filter);
}

/**
 * Filter items by fuzzy match on the label (and optionally the description), attaching
 * highlight ranges. With `sort`, best matches come first; groups are dropped when sorting
 * because they no longer describe contiguous runs.
 */
export function filterQuickPickItems(
  items: readonly QuickPickItem[],
  filter: string,
  options: { sort?: boolean; matchDescription?: boolean } = {},
): QuickPickItem[] {
  if (filter.trim() === '') return items.map((item) => ({ ...item, highlights: [] }));
  const scored: { item: QuickPickItem; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const label = fuzzyMatch(filter, item.label);
    const description =
      label === undefined && options.matchDescription === true && item.description !== undefined
        ? fuzzyMatch(filter, item.description)
        : undefined;
    const match = label ?? description;
    if (match === undefined) return;
    scored.push({
      item: { ...item, highlights: label?.ranges ?? [] },
      score: label === undefined ? match.score / 2 : match.score,
      index,
    });
  });
  if (options.sort === true) {
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.map(({ item }) => ({ ...item, group: undefined }));
  }
  return scored.map(({ item }) => item);
}
