import {
  checkParameterValue,
  type Parameter,
  type ParameterValue,
} from '@raml-kql/pack-schema/schemas';

import type { BoundParameter } from '../../../shared/query/models';

/**
 * Query parameters in a tab (spec 08, "Parameters"): the parameter bar edits text, one input
 * per parameter; values are typed and checked when the query runs, and main turns them into
 * `let` statements.
 */
export interface QueryParameters {
  definitions: Parameter[];
  /** What the user typed, by parameter name (`true`/`false` for bool). */
  inputs: Record<string, string>;
}

/** The text an input starts with. */
export function inputFor(
  parameter: Parameter,
  value: ParameterValue | undefined = parameter.default,
): string {
  if (value === undefined || value === null) return parameter.type === 'bool' ? 'false' : '';
  switch (parameter.type) {
    case 'bool':
      return value === true ? 'true' : 'false';
    case 'dynamic':
      return JSON.stringify(value);
    case 'stringList': {
      const list = Array.isArray(value) ? value.map(String) : [];
      return list.some((item) => item.includes(',') || item !== item.trim())
        ? JSON.stringify(list)
        : list.join(', ');
    }
    default:
      return typeof value === 'string' ? value : JSON.stringify(value);
  }
}

export function initialParameters(definitions: readonly Parameter[]): QueryParameters {
  return {
    definitions: [...definitions],
    inputs: Object.fromEntries(definitions.map((p) => [p.name, inputFor(p)])),
  };
}

/** Parse an input into a value of the parameter's type (or say why it can't). */
export function parseInput(
  parameter: Parameter,
  input: string,
): { value: ParameterValue } | { error: string } {
  const text = input.trim();
  let value: unknown;
  switch (parameter.type) {
    case 'string':
      value = input;
      break;
    case 'enum':
    case 'datetime':
    case 'timespan':
      value = text;
      break;
    case 'bool':
      value = text === 'true';
      break;
    case 'int':
    case 'real':
      if (parameter.type === 'real' && ['nan', '+inf', '-inf'].includes(text)) value = text;
      else if (text === '' || Number.isNaN(Number(text))) return { error: 'Enter a number.' };
      else value = Number(text);
      break;
    case 'long':
      if (!/^-?\d+$/.test(text)) return { error: 'Enter a whole number.' };
      value = Number.isSafeInteger(Number(text)) ? Number(text) : text;
      break;
    case 'dynamic':
      try {
        value = JSON.parse(text === '' ? 'null' : text) as unknown;
      } catch {
        return { error: 'Enter valid JSON, for example ["a", "b"] or {"key": 1}.' };
      }
      break;
    case 'stringList':
      if (text.startsWith('[')) {
        try {
          value = JSON.parse(text) as unknown;
        } catch {
          return { error: 'Enter values separated by commas, or a JSON list.' };
        }
      } else {
        value =
          text === ''
            ? []
            : text
                .split(',')
                .map((item) => item.trim())
                .filter((item) => item !== '');
      }
      break;
  }
  const problem = checkParameterValue(parameter, value);
  return problem === undefined
    ? { value: value as ParameterValue }
    : { error: `${parameter.name} ${problem}.` };
}

/** Parameters ready to run, or the first problem. */
export function bindParameters(
  parameters: QueryParameters,
): { parameters: BoundParameter[] } | { error: string; name: string } {
  const bound: BoundParameter[] = [];
  for (const definition of parameters.definitions) {
    const parsed = parseInput(
      definition,
      parameters.inputs[definition.name] ?? inputFor(definition),
    );
    if ('error' in parsed) return { error: parsed.error, name: definition.name };
    bound.push({
      name: definition.name,
      type: definition.type,
      ...(definition.values === undefined ? {} : { values: definition.values }),
      value: parsed.value,
    });
  }
  return { parameters: bound };
}
