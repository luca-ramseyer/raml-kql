import { watch, type FSWatcher } from 'node:fs';

/**
 * Watch a directory (non-recursively) and report changed file names, debounced. Watching the
 * directory rather than the file keeps working when editors save by replacing the file and
 * when a dotfiles repo is updated with `git pull`.
 */
export function watchDirectory(
  dir: string,
  onChange: (fileName: string | undefined) => void,
  debounceMs = 150,
): { dispose(): void } {
  const timers = new Map<string, NodeJS.Timeout>();
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(dir, { persistent: false }, (_event, fileName) => {
      // Some platforms don't report a file name; treat that as "anything may have changed".
      const key = fileName ?? '*';
      clearTimeout(timers.get(key));
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          onChange(fileName ?? undefined);
        }, debounceMs),
      );
    });
    watcher.on('error', () => {
      // The directory may have been removed; live reload stops until the next start.
    });
  } catch {
    // Directory missing or not watchable: live reload is unavailable, loading still works.
  }
  return {
    dispose() {
      watcher?.close();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
