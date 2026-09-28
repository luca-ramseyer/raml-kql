import { randomBytes } from 'node:crypto';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  findNodeAtLocation,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError,
} from 'jsonc-parser';

import type { ConfigProblem } from '../../shared/config/config-snapshots';

/** Largest config file we read. Anything bigger is almost certainly not a config file. */
export const MAX_CONFIG_FILE_BYTES = 2 * 1024 * 1024;

export interface ParsedJsonc {
  /** Root of the syntax tree, or undefined when the text is empty. */
  tree: Node | undefined;
  /** Syntax problems. When non-empty, the file must not be edited programmatically. */
  problems: ConfigProblem[];
}

/** 1-based line of a character offset. */
export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

export function parseJsonc(text: string, file: string): ParsedJsonc {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
  return {
    tree,
    problems: errors.map((error) => ({
      file,
      line: lineOf(text, error.offset),
      message: `Syntax error: ${printParseErrorCode(error.error)}`,
    })),
  };
}

/** Line of a top-level property (for "invalid value" problems). */
export function propertyLine(text: string, tree: Node | undefined, key: string): number {
  const node = tree === undefined ? undefined : findNodeAtLocation(tree, [key]);
  return node === undefined ? 0 : lineOf(text, node.parent?.offset ?? node.offset);
}

/** Read a UTF-8 file; `undefined` if it doesn't exist. Refuses oversized files. */
export async function readTextFile(file: string): Promise<string | undefined> {
  try {
    const buffer = await readFile(file);
    if (buffer.byteLength > MAX_CONFIG_FILE_BYTES) {
      throw new Error(`${path.basename(file)} is larger than ${MAX_CONFIG_FILE_BYTES} bytes`);
    }
    return buffer.toString('utf8').replace(/^\uFEFF/, '');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Write via a temporary file + rename so a crash never leaves a half-written config file.
 * Rename follows the target path, so a symlinked file (dotfiles repo) is replaced by a
 * regular file; for symlinks we write in place instead.
 */
export async function writeTextFileAtomic(file: string, content: string): Promise<void> {
  const stat = await lstat(file).catch(() => undefined);
  if (stat?.isSymbolicLink() === true) {
    await writeFile(file, content, 'utf8');
    return;
  }
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    await writeFile(temp, content, 'utf8');
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
