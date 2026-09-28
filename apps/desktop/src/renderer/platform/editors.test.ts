import { beforeEach, describe, expect, it } from 'vitest';

import { activateEditor, closeActiveEditor, closeEditor, openEditor, useEditors } from './editors';

beforeEach(() => {
  useEditors.setState({ editors: [], activeId: undefined });
});

describe('editors', () => {
  it('opens singleton editors once and focuses them again', () => {
    openEditor('welcome');
    openEditor('settings');
    openEditor('welcome');
    const { editors, activeId } = useEditors.getState();
    expect(editors.map((e) => e.kind)).toEqual(['welcome', 'settings']);
    expect(activeId).toBe('welcome');
  });

  it('inserts new editors to the right of the active one', () => {
    openEditor('settings');
    activateEditor('settings');
    openEditor('welcome');
    expect(useEditors.getState().editors.map((e) => e.id)).toEqual(['settings', 'welcome']);
  });

  it('activates the right neighbour (else left) after closing, like VS Code', () => {
    openEditor('welcome');
    openEditor('settings');
    activateEditor('welcome');
    closeActiveEditor();
    expect(useEditors.getState().activeId).toBe('settings');
    closeEditor('settings');
    expect(useEditors.getState()).toEqual({ editors: [], activeId: undefined });
  });
});
