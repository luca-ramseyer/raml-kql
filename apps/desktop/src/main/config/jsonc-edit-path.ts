import { applyEdits, modify } from 'jsonc-parser';

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: '\n' } as const;

/** Set (or remove, with `undefined`) a nested JSONC value, keeping comments elsewhere intact. */
export function setJsoncPath(text: string, jsonPath: (string | number)[], value: unknown): string {
  return applyEdits(text, modify(text, jsonPath, value, { formattingOptions: FORMATTING }));
}
