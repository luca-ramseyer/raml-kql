// Setup for renderer (jsdom) tests: adds DOM matchers such as `toBeInTheDocument()`.
import '@testing-library/jest-dom/vitest';

import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
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

afterEach(() => {
  cleanup();
});
