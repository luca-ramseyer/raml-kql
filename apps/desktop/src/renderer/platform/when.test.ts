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

  it('matches regular expressions with =~', () => {
    expect(matchesWhen('cellEntityType =~ /ip|domain|sha256/', { cellEntityType: 'ip' })).toBe(
      true,
    );
    expect(matchesWhen('cellEntityType =~ /^ip$/i', { cellEntityType: 'IP' })).toBe(true);
    expect(matchesWhen('cellEntityType =~ /ip|domain/', { cellEntityType: 'url' })).toBe(false);
    expect(matchesWhen('cellEntityType =~ /ip/', {})).toBe(false);
    expect(matchesWhen('a =~ /x/ && b', { a: 'x', b: true })).toBe(true);
    expect(matchesWhen('a =~ nope', { a: 'x' })).toBe(false);
  });
});
