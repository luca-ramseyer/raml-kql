import { beforeEach, describe, expect, it } from 'vitest';

import {
  activateEditor,
  closeActiveEditor,
  closeEditor,
  moveEditor,
  openEditor,
  openQueryEditor,
  resetEditors,
  splitGroup,
  useEditors,
} from './editors';

beforeEach(() => {
  resetEditors();
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
    expect(useEditors.getState().editors).toEqual([]);
    expect(useEditors.getState().activeId).toBeUndefined();
  });

  it('splits into groups, moves tabs between them and closes emptied groups', () => {
    const a = openQueryEditor();
    const groupB = splitGroup();
    const b = openQueryEditor();
    expect(useEditors.getState().groups.map((g) => g.editors.map((e) => e.id))).toEqual([[a], [b]]);
    expect(useEditors.getState().activeGroupId).toBe(groupB);
    moveEditor(b, 'group-1');
    expect(useEditors.getState().groups).toHaveLength(1);
    expect(useEditors.getState().editors.map((e) => e.id)).toEqual([a, b]);
  });

  it('replaces the previous preview tab in a group', () => {
    const first = openQueryEditor({ preview: true });
    const second = openQueryEditor({ preview: true });
    expect(useEditors.getState().editors.map((e) => e.id)).toEqual([second]);
    expect(first).not.toBe(second);
  });
});
