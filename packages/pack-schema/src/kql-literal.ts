import { checkParameterValue, type Parameter } from './schemas';

/**
 * KQL literal encoding for query parameters (spec 08, "Injection"). Parameter values become
 * typed `let` statements; the query body is never string-substituted. Every value goes through
 * the encoder for its type, and a value that doesn't fit its type is rejected, not coerced.
 */

/**
 * A double-quoted KQL string literal. Backslash and quote are escaped; control characters and
 * line/paragraph separators become `\uXXXX`, so the literal is always a single line.
 */
export function kqlString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '\\') out += '\\\\';
    else if (char === '"') out += '\\"';
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else out += char;
  }
  return `${out}"`;
}

export class ParameterValueError extends Error {
  constructor(
    readonly parameter: string,
    message: string,
  ) {
    super(`Parameter ${parameter} ${message}.`);
    this.name = 'ParameterValueError';
  }
}

function realLiteral(value: number | string): string {
  if (value === 'nan' || (typeof value === 'number' && Number.isNaN(value))) return 'real(nan)';
  if (value === '+inf' || value === Infinity) return 'real(+inf)';
  if (value === '-inf' || value === -Infinity) return 'real(-inf)';
  const text = String(value);
  // JS may print 1e21; KQL real() accepts exponents too.
  return `real(${text})`;
}

/** The KQL literal for a parameter value; throws `ParameterValueError` when it doesn't fit. */
export function kqlLiteral(
  parameter: Pick<Parameter, 'name' | 'type' | 'values'>,
  value: unknown,
): string {
  const problem = checkParameterValue(parameter, value);
  if (problem !== undefined) throw new ParameterValueError(parameter.name, problem);
  switch (parameter.type) {
    case 'string':
    case 'enum':
      return kqlString(value as string);
    case 'int':
      return `int(${String(value)})`;
    case 'long':
      return `long(${String(value)})`;
    case 'real':
      return realLiteral(value as number | string);
    case 'bool':
      return (value as boolean) ? 'true' : 'false';
    case 'datetime':
      // Checked against a strict ISO 8601 pattern: digits, '-', ':', '.', 'T', 'Z', '+'.
      return `datetime(${value as string})`;
    case 'timespan':
      // Checked against the KQL timespan literal grammar.
      return `timespan(${value as string})`;
    case 'dynamic':
      // parse_json of an escaped string: any JSON value, with no way to break out of the literal.
      return `parse_json(${kqlString(JSON.stringify(value))})`;
    case 'stringList':
      return `dynamic([${(value as string[]).map(kqlString).join(', ')}])`;
  }
}

/** `let Name = <literal>;` */
export function letStatement(
  parameter: Pick<Parameter, 'name' | 'type' | 'values'>,
  value: unknown,
): string {
  return `let ${parameter.name} = ${kqlLiteral(parameter, value)};`;
}
