import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateKeybindingsText, KeybindingsService } from './keybindings-service';

describe('evaluateKeybindingsText', () => {
  it('accepts VS Code-format entries with comments', () => {
    const text = `// user keybindings
    [
      { "key": "ctrl+shift+b", "command": "workbench.action.togglePanel" },
      { "key": "cmd+b", "command": "-workbench.action.toggleSidebarVisibility", "when": "isMac" },
    ]`;
    expect(evaluateKeybindingsText(text, [])).toEqual({
      entries: [
        { key: 'ctrl+shift+b', command: 'workbench.action.togglePanel' },
        { key: 'cmd+b', command: '-workbench.action.toggleSidebarVisibility', when: 'isMac' },
      ],
      problems: [],
    });
  });

  it('skips invalid entries and reports their line', () => {
    const text = '[\n  { "key": "ctrl+j", "command": "a" },\n  { "command": "missing.key" }\n]';
    const result = evaluateKeybindingsText(text, []);
    expect(result.entries).toEqual([{ key: 'ctrl+j', command: 'a' }]);
    expect(result.problems[0]).toMatchObject({ file: 'keybindings.jsonc', line: 3 });
  });

  it('keeps the previous entries on syntax errors', () => {
    const previous = [{ key: 'ctrl+j', command: 'a' }];
    const result = evaluateKeybindingsText('[ { "key": ', previous);
    expect(result.entries).toEqual(previous);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('requires an array', () => {
    expect(evaluateKeybindingsText('{}', []).problems[0]?.message).toMatch(/JSON array/);
  });

  it('KeybindingsService loads the file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rk-keys-'));
    try {
      const file = path.join(dir, 'keybindings.jsonc');
      writeFileSync(file, '[{ "key": "f2", "command": "x" }]');
      const service = new KeybindingsService(file);
      await service.reload();
      expect(service.current.entries).toEqual([{ key: 'f2', command: 'x' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
