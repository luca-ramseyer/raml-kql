// Setup for renderer (jsdom) tests: adds DOM matchers such as `toBeInTheDocument()`.
import '@testing-library/jest-dom/vitest';

import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// jest-dom's bundled typings augment `Assertion`; Vitest 5 reads custom matchers from
// `Matchers`, so register them there too.
/* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars --
   declaration merging must repeat Vitest's type parameters exactly */
declare module 'vitest' {
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > extends TestingLibraryMatchers<unknown, R> {}
}
/* eslint-enable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars */

// GitHub's CI runners are several times slower than a laptop, and these tests render the whole
// workbench under coverage. A longer wait costs nothing when the UI is quick (waitFor and
// findBy return as soon as they succeed), but stops one-in-twenty timing failures.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

// jsdom has no matchMedia; the theme service uses it to follow the OS appearance.
// Tests can flip `prefers-color-scheme` with `setMediaMatch()` from test/helpers/media.ts.
if (typeof window.matchMedia !== 'function') {
  const listeners = new Map<string, Set<() => void>>();
  const matches = new Map<string, boolean>();
  Object.assign(window, {
    matchMedia: (query: string) => ({
      get matches() {
        return matches.get(query) ?? false;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        let set = listeners.get(query);
        if (set === undefined) {
          set = new Set();
          listeners.set(query, set);
        }
        set.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.get(query)?.delete(listener);
      },
      dispatchEvent: () => false,
    }),
    __setMediaMatch: (query: string, value: boolean) => {
      matches.set(query, value);
      for (const listener of listeners.get(query) ?? []) listener();
    },
  });
}
