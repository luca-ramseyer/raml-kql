import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetWorkbenchState } from '../../../../test/helpers/workbench-harness';
import { executeCommand, getCommand } from '../../platform/commands';
import { closeEditor, useEditors } from '../../platform/editors';

import { registerQueryCommands, resetQueryCommands } from './query-commands';
import { STARTER_QUERY, useQueryDocs } from './query-docs';

describe('query commands', () => {
  let dispose: () => void = () => undefined;
  beforeEach(() => {
    resetQueryCommands();
    useQueryDocs.setState({ docs: {} });
    dispose = registerQueryCommands();
  });
  afterEach(() => {
    dispose();
    resetWorkbenchState();
  });

  it('opens query tabs; only the first starts with the sample query', async () => {
    await executeCommand('query.new');
    await executeCommand('query.new');
    const { editors, activeId } = useEditors.getState();
    expect(editors.map((e) => [e.kind, e.title])).toEqual([
      ['query', expect.stringMatching(/^Query \d+$/)],
      ['query', expect.stringMatching(/^Query \d+$/)],
    ]);
    const [first, second] = editors;
    expect(activeId).toBe(second?.id);
    expect(useQueryDocs.getState().docs[first?.id ?? '']?.text).toBe(STARTER_QUERY);
    expect(useQueryDocs.getState().docs[second?.id ?? '']).toEqual({
      text: '',
      timeRange: { kind: 'preset', preset: '24h' },
      timeSetInQuery: false,
    });
  });

  it('forgets a query document when its tab closes', async () => {
    await executeCommand('query.new');
    const id = useEditors.getState().activeId ?? '';
    closeEditor(id);
    expect(useQueryDocs.getState().docs[id]).toBeUndefined();
  });

  it('only offers editor actions while a query tab is active', () => {
    expect(getCommand('editor.action.formatDocument')?.when).toBe("editorLangId == 'kusto'");
    expect(getCommand('schema.refresh')?.when).toBeUndefined();
  });

  it('the sample query uses TimeGenerated', () => {
    expect(STARTER_QUERY).toContain('TimeGenerated');
    expect(STARTER_QUERY).not.toMatch(/\bTimestamp\b/);
  });
});
