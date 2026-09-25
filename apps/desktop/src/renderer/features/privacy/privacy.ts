import { create } from 'zustand';

import { DisplayNamer, type AliasScope } from '../../../shared/privacy/aliasing';
import { registerCommand } from '../../platform/commands';
import { setContextKey } from '../../platform/context-keys';
import { showQuickPick } from '../../platform/quickinput/quick-input';
import { getSetting, useSettings } from '../../platform/settings';
import { registerStatusBarItem } from '../../platform/statusbar';
import { useAccounts } from '../accounts/accounts-store';
import { useInventory } from '../workspaces/inventory-store';

/**
 * Presentation privacy (spec 03): `aliased` is a session flag. It starts on when
 * `privacy.aliasing.activeOnStartup` is set, and the master switch `privacy.aliasing.enabled`
 * turns the whole feature off.
 */
export const usePrivacy = create<{ aliased: boolean }>(() => ({ aliased: true }));

function aliasingActive(): boolean {
  return getSetting('privacy.aliasing.enabled') && usePrivacy.getState().aliased;
}

function buildNamer(): DisplayNamer {
  const { inventory } = useInventory.getState();
  const { accounts } = useAccounts.getState().snapshot;
  return new DisplayNamer(
    {
      active: aliasingActive(),
      format: getSetting('privacy.aliasing.autoAliasFormat'),
      scope: new Set<AliasScope>(getSetting('privacy.aliasing.scope')),
    },
    inventory.tenants,
    inventory.workspaces,
    accounts.map((a) => a.id),
  );
}

let cached: { key: unknown[]; namer: DisplayNamer } | undefined;

/** The display namer for the current state (non-React callers, e.g. notifications). */
export function currentNamer(): DisplayNamer {
  const key = [
    useInventory.getState().inventory,
    useAccounts.getState().snapshot,
    usePrivacy.getState().aliased,
    useSettings.getState().values,
  ];
  if (cached === undefined || cached.key.some((value, i) => value !== key[i])) {
    cached = { key, namer: buildNamer() };
  }
  return cached.namer;
}

/** React hook: re-renders when anything that affects display names changes. */
export function useNamer(): DisplayNamer {
  useInventory((s) => s.inventory);
  useAccounts((s) => s.snapshot);
  usePrivacy((s) => s.aliased);
  useSettings((s) => s.values);
  return currentNamer();
}

export function setAliased(aliased: boolean): void {
  usePrivacy.setState({ aliased });
}

/** "Privacy: Toggle Presentation Mode" with the confirm-before-reveal safeguard. */
export function togglePresentationMode(): void {
  if (!usePrivacy.getState().aliased) {
    setAliased(true);
    return;
  }
  if (!getSetting('privacy.aliasing.confirmReveal')) {
    setAliased(false);
    return;
  }
  showQuickPick({
    placeholder: 'Show real tenant, subscription and workspace names on screen?',
    getItems: () => [
      { id: 'stay', label: 'Stay Aliased', icon: 'eye-closed' },
      {
        id: 'reveal',
        label: 'Show Real Names',
        icon: 'eye',
        description: 'make sure you are not sharing your screen',
      },
    ],
    onAccept: (item) => {
      if (item?.id === 'reveal') setAliased(false);
    },
  });
}

/** Commands, context key and status bar item. Returns a disposer. */
export function startPrivacy(): () => void {
  setAliased(getSetting('privacy.aliasing.activeOnStartup'));
  const item = registerStatusBarItem({
    id: 'status.privacy',
    alignment: 'left',
    priority: 5000,
    text: '$(eye-closed) Aliased',
    tooltip: 'Customer names are aliased (presentation mode). Click to show real names.',
    command: 'privacy.togglePresentationMode',
  });
  const sync = (): void => {
    const enabled = getSetting('privacy.aliasing.enabled');
    const aliased = usePrivacy.getState().aliased;
    setContextKey('privacyAliasingEnabled', enabled);
    setContextKey('presentationMode', enabled && aliased);
    item.update(
      !enabled
        ? { text: '', tooltip: undefined }
        : aliased
          ? {
              text: '$(eye-closed) Aliased',
              tooltip: 'Customer names are aliased (presentation mode). Click to show real names.',
            }
          : {
              text: '$(eye) Real names',
              tooltip: 'Real customer names are shown. Click to alias them.',
              kind: 'warning',
            },
    );
    if (aliased || !enabled) item.update({ kind: 'standard' });
  };
  sync();
  const disposers = [
    usePrivacy.subscribe(sync),
    useSettings.subscribe(sync),
    registerCommand({
      id: 'privacy.togglePresentationMode',
      title: 'Toggle Presentation Mode',
      category: 'Privacy',
      when: 'privacyAliasingEnabled',
      run: togglePresentationMode,
    }),
  ];
  return () => {
    item.dispose();
    for (const dispose of disposers) dispose();
  };
}
