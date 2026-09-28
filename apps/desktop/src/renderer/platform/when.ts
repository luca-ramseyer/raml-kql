/**
 * `when`-clause expressions, a simplified version of VS Code's (spec 01): context keys,
 * `!`, `&&`, `||`, parentheses, `==` / `!=` against a quoted string, word, number or boolean.
 *
 *   sideBarVisible && !inQuickOpen
 *   activeViewlet == 'workbench.view.targets' || panelVisible
 */

export type WhenExpression =
  | { type: 'true' }
  | { type: 'false' }
  | { type: 'key'; key: string }
  | { type: 'not'; operand: WhenExpression }
  | { type: 'and'; operands: WhenExpression[] }
  | { type: 'or'; operands: WhenExpression[] }
  | { type: 'equals'; key: string; value: string | number | boolean; negate: boolean }
  | { type: 'regex'; key: string; pattern: RegExp };

type Token =
  | { kind: 'word'; text: string }
  | { kind: 'string'; text: string }
  | { kind: 'op'; text: '!' | '&&' | '||' | '==' | '!=' | '=~' | '(' | ')' }
  | { kind: 'regex'; pattern: RegExp };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (two === '=~') {
      // VS Code's regex match: `key =~ /pattern/flags`.
      i += 2;
      while (/\s/.test(input.charAt(i))) i++;
      const literal = /^\/((?:[^/\\\n]|\\.)+)\/([imsu]*)/.exec(input.slice(i));
      if (literal === null) throw new Error(`Expected a /regex/ at ${String(i)}`);
      tokens.push({ kind: 'op', text: '=~' });
      tokens.push({ kind: 'regex', pattern: new RegExp(literal[1] ?? '', literal[2]) });
      i += literal[0].length;
      continue;
    }
    if (two === '&&' || two === '||' || two === '==' || two === '!=') {
      tokens.push({ kind: 'op', text: two });
      i += 2;
      continue;
    }
    if (ch === '!' || ch === '(' || ch === ')') {
      tokens.push({ kind: 'op', text: ch });
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = input.indexOf(ch, i + 1);
      if (end < 0) throw new Error(`Unterminated string at ${String(i)}`);
      tokens.push({ kind: 'string', text: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const match = /^[A-Za-z0-9_.:\-/]+/.exec(input.slice(i));
    if (match === null) throw new Error(`Unexpected character "${ch}" at ${String(i)}`);
    tokens.push({ kind: 'word', text: match[0] });
    i += match[0].length;
  }
  return tokens;
}

/** Parse a when-clause. Throws with a readable message on invalid input. */
export function parseWhen(input: string): WhenExpression {
  const tokens = tokenize(input);
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const isOp = (text: string): boolean => {
    const token = peek();
    return token?.kind === 'op' && token.text === text;
  };

  function parseOr(): WhenExpression {
    const operands = [parseAnd()];
    while (isOp('||')) {
      pos++;
      operands.push(parseAnd());
    }
    return operands.length === 1 && operands[0] ? operands[0] : { type: 'or', operands };
  }

  function parseAnd(): WhenExpression {
    const operands = [parseUnary()];
    while (isOp('&&')) {
      pos++;
      operands.push(parseUnary());
    }
    return operands.length === 1 && operands[0] ? operands[0] : { type: 'and', operands };
  }

  function parseUnary(): WhenExpression {
    if (isOp('!')) {
      pos++;
      return { type: 'not', operand: parseUnary() };
    }
    if (isOp('(')) {
      pos++;
      const inner = parseOr();
      if (!isOp(')')) throw new Error('Expected ")"');
      pos++;
      return inner;
    }
    const token = peek();
    if (token?.kind !== 'word') throw new Error('Expected a context key');
    pos++;
    if (token.text === 'true') return { type: 'true' };
    if (token.text === 'false') return { type: 'false' };
    if (isOp('=~')) {
      pos++;
      const regex = peek();
      if (regex?.kind !== 'regex') throw new Error('Expected a /regex/');
      pos++;
      return { type: 'regex', key: token.text, pattern: regex.pattern };
    }
    if (isOp('==') || isOp('!=')) {
      const negate = isOp('!=');
      pos++;
      const valueToken = peek();
      if (valueToken === undefined || valueToken.kind === 'op' || valueToken.kind === 'regex') {
        throw new Error('Expected a value');
      }
      pos++;
      let value: string | number | boolean = valueToken.text;
      if (valueToken.kind === 'word') {
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
      }
      return { type: 'equals', key: token.text, value, negate };
    }
    return { type: 'key', key: token.text };
  }

  if (tokens.length === 0) return { type: 'true' };
  const expression = parseOr();
  if (pos !== tokens.length) throw new Error('Unexpected input after expression');
  return expression;
}

export type ContextValues = Readonly<Record<string, unknown>>;

export function evaluateWhen(expression: WhenExpression, context: ContextValues): boolean {
  switch (expression.type) {
    case 'true':
      return true;
    case 'false':
      return false;
    case 'key':
      return Boolean(context[expression.key]);
    case 'not':
      return !evaluateWhen(expression.operand, context);
    case 'and':
      return expression.operands.every((operand) => evaluateWhen(operand, context));
    case 'or':
      return expression.operands.some((operand) => evaluateWhen(operand, context));
    case 'equals': {
      const actual = context[expression.key];
      // VS Code compares loosely, so `count == 1` matches the string '1' too.
      const equal = actual == expression.value;
      return expression.negate ? !equal : equal;
    }
    case 'regex': {
      const actual = context[expression.key];
      return (
        (typeof actual === 'string' || typeof actual === 'number') &&
        expression.pattern.test(String(actual))
      );
    }
  }
}

const cache = new Map<string, WhenExpression | Error>();

/** Parse (cached) and evaluate; invalid expressions evaluate to false. */
export function matchesWhen(when: string | undefined, context: ContextValues): boolean {
  if (when === undefined || when.trim() === '') return true;
  let parsed = cache.get(when);
  if (parsed === undefined) {
    try {
      parsed = parseWhen(when);
    } catch (error) {
      parsed = error as Error;
    }
    cache.set(when, parsed);
  }
  return parsed instanceof Error ? false : evaluateWhen(parsed, context);
}
