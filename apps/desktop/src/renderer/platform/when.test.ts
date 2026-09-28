import { describe, expect, it } from 'vitest';

import { evaluateWhen, matchesWhen, parseWhen } from './when';

describe('when-clauses', () => {
  const context = {
    sideBarVisible: true,
    panelVisible: false,
    activeViewlet: 'workbench.view.targets',
    count: 1,
    isMac: true,
  };

  it.each([
    ['sideBarVisible', true],
    ['!sideBarVisible', false],
    ['sideBarVisible && panelVisible', false],
    ['sideBarVisible || panelVisible', true],
    ['!panelVisible && sideBarVisible', true],
    ["activeViewlet == 'workbench.view.targets'", true],
    ['activeViewlet == workbench.view.targets', true],
    ["activeViewlet != 'workbench.view.history'", true],
    ['count == 1', true],
    ["count == '1'", true],
    ['isMac == true', true],
    ['unknownKey', false],
    ['!unknownKey', true],
    ['(panelVisible || sideBarVisible) && isMac', true],
    ['true', true],
    ['false || !isMac', false],
    ['', true],
  ])('%s → %s', (expression, expected) => {
    expect(evaluateWhen(parseWhen(expression), context)).toBe(expected);
  });

  it.each(['&& a', 'a &&', '(a', 'a == ', "a == 'x", 'a b', 'a ~= b'])('rejects %j', (bad) => {
    expect(() => parseWhen(bad)).toThrow();
  });

  it('matchesWhen treats invalid expressions as false and undefined as true', () => {
    expect(matchesWhen(undefined, {})).toBe(true);
    expect(matchesWhen('(broken', { broken: true })).toBe(false);
  });
});
