/** Messages from extensions to their sidebar views (`extensions.webviewPost` events). */
type Listener = (message: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

export function onWebviewPost(viewId: string, listener: Listener): () => void {
  const set = listeners.get(viewId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(viewId, set);
  return () => set.delete(listener);
}

export function dispatchWebviewPost(event: { viewId: string; message: unknown }): void {
  for (const listener of listeners.get(event.viewId) ?? []) listener(event.message);
}
