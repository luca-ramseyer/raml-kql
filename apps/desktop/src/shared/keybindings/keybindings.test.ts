import { describe, expect, it } from 'vitest';

import { DEFAULT_KEYBINDINGS, defaultKeyFor } from './keybindings';
import { parseKeySequence, sequenceToString } from './keys';

describe('DEFAULT_KEYBINDINGS', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('all parse on %s', (platform) => {
    for (const binding of DEFAULT_KEYBINDINGS) {
      expect(parseKeySequence(defaultKeyFor(binding, platform)), binding.command).toBeDefined();
    }
  });

  it.each(['darwin', 'win32', 'linux'] as const)(
    'never bind the same key twice with the same when-clause on %s',
    (platform) => {
      const seen = new Map<string, string>();
      for (const binding of DEFAULT_KEYBINDINGS) {
        const key = `${sequenceToString(parseKeySequence(defaultKeyFor(binding, platform))!)}|${binding.when ?? ''}`;
        expect(seen.get(key), `${key} used by ${binding.command}`).toBeUndefined();
        seen.set(key, binding.command);
      }
    },
  );

  it('matches the spec 05 view shortcuts', () => {
    const mac = (command: string): string[] =>
      DEFAULT_KEYBINDINGS.filter((b) => b.command === command).map((b) =>
        defaultKeyFor(b, 'darwin'),
      );
    expect(mac('workbench.view.targets')).toEqual(['cmd+shift+e']);
    expect(mac('workbench.view.library')).toEqual(['cmd+shift+l']);
    expect(mac('workbench.view.history')).toEqual(['cmd+shift+h']);
    expect(mac('workbench.view.extensions')).toEqual(['cmd+shift+x']);
    expect(mac('workbench.action.openSettings')).toEqual(['cmd+,']);
    expect(mac('workbench.action.showCommands')).toEqual(['f1', 'cmd+shift+p']);
  });
});
