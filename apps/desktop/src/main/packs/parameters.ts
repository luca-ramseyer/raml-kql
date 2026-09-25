import { letStatement, ParameterValueError } from '@raml-kql/pack-schema/kql-literal';

import { AppError } from '../../shared/errors';
import type { BoundParameter, QueryRunRequest } from '../../shared/query/models';
import { topLevelStatements } from '../kusto/kusto-parser';

/**
 * Parameter injection (spec 08). Each parameter becomes `let Name = <typed literal>;`. When the
 * query defines a top-level `let` of the same name (a portable default, so the query also runs
 * in the portal), that statement is replaced in place; otherwise the `let` is prepended. The
 * query body itself is never string-substituted, and values that don't fit their type throw
 * `ParameterValueError` before anything is sent.
 */
export function injectParameters(query: string, parameters: readonly BoundParameter[]): string {
  if (parameters.length === 0) return query;
  const statements = new Map(
    parameters.map((p) => [p.name, letStatement(p, p.value).replace(/;$/, '')]),
  );
  const replaced = new Set<string>();
  const edits: { start: number; end: number; text: string }[] = [];
  for (const statement of topLevelStatements(query)) {
    if (statement.kind !== 'let' || statement.name === undefined) continue;
    const text = statements.get(statement.name);
    if (text === undefined) continue;
    edits.push({ start: statement.start, end: statement.end, text });
    replaced.add(statement.name);
  }
  let out = query;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  const prepend = [...statements]
    .filter(([name]) => !replaced.has(name))
    .map(([, text]) => `${text};\n`)
    .join('');
  return prepend + out;
}

/** The request the engine runs: parameters injected into the query text. */
export function withParameters(request: QueryRunRequest): Omit<QueryRunRequest, 'parameters'> {
  const { parameters, ...rest } = request;
  if (parameters === undefined || parameters.length === 0) return rest;
  try {
    return { ...rest, query: injectParameters(request.query, parameters) };
  } catch (error) {
    if (error instanceof ParameterValueError) {
      throw new AppError({
        code: 'PARAMETER_INVALID',
        message: `${error.message} The query was not sent.`,
        retryable: false,
        source: 'main',
      });
    }
    throw error;
  }
}
