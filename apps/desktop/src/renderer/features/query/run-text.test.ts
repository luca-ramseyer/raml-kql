import { describe, expect, it } from 'vitest';

import { queryToRun } from './run-text';

const TEXT = [
  'SigninLogs', // 1
  '| take 10', // 2
  '', // 3
  '   ', // 4
  'Heartbeat', // 5
  '| count', // 6
  '', // 7
].join('\n');

describe('queryToRun', () => {
  it('runs the block under the cursor', () => {
    expect(queryToRun(TEXT, 2, 'block')).toEqual({
      text: 'SigninLogs\n| take 10',
      startLine: 1,
      endLine: 2,
    });
    expect(queryToRun(TEXT, 5, 'block')).toEqual({
      text: 'Heartbeat\n| count',
      startLine: 5,
      endLine: 6,
    });
  });

  it('uses the block above when the cursor is on a blank line', () => {
    expect(queryToRun(TEXT, 4, 'block')?.startLine).toBe(1);
    expect(queryToRun(TEXT, 7, 'block')?.startLine).toBe(5);
    expect(queryToRun('\n\n', 2, 'block')).toBeUndefined();
  });

  it('prefers a non-empty selection and honours runScope "all"', () => {
    expect(queryToRun(TEXT, 1, 'block', { text: 'Heartbeat', startLine: 5, endLine: 5 })).toEqual({
      text: 'Heartbeat',
      startLine: 5,
      endLine: 5,
    });
    expect(queryToRun(TEXT, 1, 'block', { text: '  ', startLine: 3, endLine: 3 })?.startLine).toBe(
      1,
    );
    expect(queryToRun(TEXT, 1, 'all')).toEqual({ text: TEXT, startLine: 1, endLine: 7 });
    expect(queryToRun('  ', 1, 'all')).toBeUndefined();
  });

  it('handles CRLF and out-of-range cursors', () => {
    expect(queryToRun('A\r\n| take 1', 99, 'block')?.text).toBe('A\n| take 1');
  });
});
