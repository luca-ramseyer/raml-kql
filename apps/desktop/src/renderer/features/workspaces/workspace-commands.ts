import { registerCommand } from '../../platform/commands';
import { openEditor } from '../../platform/editors';
import { showView } from '../../platform/layout';
import { notify } from '../../platform/notifications';
import { showInputBox, showQuickPick } from '../../platform/quickinput/quick-input';
import { selectGroup, setSelected, useTargets, visibleTargets } from '../targets/targets-store';

import { refreshInventory, saveGroup, useInventory } from './inventory-store';

function slug(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? 'group' : base.slice(0, 80);
}

export function registerWorkspaceCommands(): () => void {
  const disposers = [
    registerCommand({
      id: 'workbench.action.openWorkspacesSettings',
      title: 'Open Workspaces Settings',
      category: 'Preferences',
      icon: 'settings',
      run: () => {
        openEditor('workspaces');
      },
    }),
    registerCommand({
      id: 'workspaces.refresh',
      title: 'Refresh Workspaces',
      category: 'Workspaces',
      icon: 'refresh',
      run: refreshInventory,
    }),
    registerCommand({
      id: 'targets.selectAll',
      title: 'Select All Shown',
      category: 'Targets',
      run: () => {
        setSelected(
          visibleTargets(useTargets.getState().groupId).map((w) => w.resourceId),
          true,
        );
      },
    }),
    registerCommand({
      id: 'targets.clearSelection',
      title: 'Clear Selection',
      category: 'Targets',
      run: () => {
        setSelected(
          visibleTargets(useTargets.getState().groupId).map((w) => w.resourceId),
          false,
        );
      },
    }),
    registerCommand({
      id: 'targets.selectGroup',
      title: 'Select Group…',
      category: 'Targets',
      run: () => {
        const { groups } = useInventory.getState().groups;
        showQuickPick({
          placeholder: 'Select a group of workspaces',
          getItems: (filter) =>
            [
              { id: '', label: 'All enabled' },
              ...groups.map((g) => ({ id: g.id, label: g.name, description: g.type })),
            ].filter((item) => item.label.toLowerCase().includes(filter.toLowerCase())),
          onAccept: (item) => {
            if (item === undefined) return;
            selectGroup(item.id === '' ? undefined : item.id);
            showView('workbench.view.targets');
          },
        });
      },
    }),
    registerCommand({
      id: 'targets.saveSelectionAsGroup',
      title: 'Save Selection as Group…',
      category: 'Targets',
      icon: 'save',
      run: () => {
        const selected = [...useTargets.getState().selected];
        if (selected.length === 0) {
          notify({ severity: 'warning', message: 'Select some workspaces first.' });
          return;
        }
        const existing = new Set(useInventory.getState().groups.groups.map((g) => g.id));
        showInputBox({
          placeholder: 'Group name, e.g. On-call set',
          prompt: `Save the ${String(selected.length)} selected workspace${selected.length === 1 ? '' : 's'} as a static group`,
          validate: (value) =>
            value.trim() === ''
              ? 'Enter a name.'
              : value.length > 200
                ? 'Keep it under 200 characters.'
                : undefined,
          onAccept: (value) => {
            let id = slug(value);
            for (let n = 2; existing.has(id); n++) id = `${slug(value)}-${String(n)}`;
            void saveGroup({ id, name: value.trim(), type: 'static', workspaces: selected }).then(
              (ok) => {
                if (ok) useTargets.setState({ groupId: id });
              },
            );
          },
        });
      },
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
