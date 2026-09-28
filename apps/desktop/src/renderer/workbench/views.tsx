import { tenantsNeedingReauth, useAccounts } from '../features/accounts/accounts-store';
import { AccountsView } from '../features/accounts/AccountsView';
import { HistoryView } from '../features/history/HistoryView';
import { LibraryView } from '../features/library/LibraryView';
import { WelcomeView } from '../features/placeholders/WelcomeView';
import { TargetsView } from '../features/targets/TargetsView';

/**
 * Sidebar views shown by the activity bar (spec 05). Each view has a "show" command
 * (`workbench.view.<name>`) with a keybinding. The real contents arrive in later phases:
 * Targets (Phase 3), Library (Phase 8), History (Phase 7), Extensions (Phase 9),
 * Accounts (Phase 2).
 */
export interface ViewDescriptor {
  id: string;
  title: string;
  icon: string;
  /** Top group, or the bottom group (Accounts) like VS Code. */
  position: 'top' | 'bottom';
  component: () => React.JSX.Element;
  /** Icon buttons in the view's title bar. */
  actions?: readonly { icon: string; title: string; command: string }[];
  /** Hook returning the activity bar badge count (0 = no badge). */
  useBadge?: () => number;
}

export const VIEWS: readonly ViewDescriptor[] = [
  {
    id: 'workbench.view.targets',
    title: 'Targets',
    icon: 'target',
    position: 'top',
    component: TargetsView,
    actions: [
      { icon: 'save', title: 'Save Selection as Group…', command: 'targets.saveSelectionAsGroup' },
      { icon: 'refresh', title: 'Refresh Workspaces', command: 'workspaces.refresh' },
      {
        icon: 'settings',
        title: 'Workspaces Settings',
        command: 'workbench.action.openWorkspacesSettings',
      },
    ],
  },
  {
    id: 'workbench.view.library',
    title: 'Library',
    icon: 'library',
    position: 'top',
    component: LibraryView,
    actions: [
      { icon: 'new-file', title: 'New Query…', command: 'library.newQuery' },
      { icon: 'new-folder', title: 'New Folder…', command: 'library.newFolder' },
      { icon: 'refresh', title: 'Refresh', command: 'library.refresh' },
    ],
  },
  {
    id: 'workbench.view.history',
    title: 'History',
    icon: 'history',
    position: 'top',
    component: HistoryView,
    actions: [{ icon: 'clear-all', title: 'Clear History', command: 'history.clear' }],
  },
  {
    id: 'workbench.view.extensions',
    title: 'Extensions',
    icon: 'extensions',
    position: 'top',
    component: () => (
      <WelcomeView paragraphs={['Installed extensions and extension sources will appear here.']} />
    ),
  },
  {
    id: 'workbench.view.accounts',
    title: 'Accounts',
    icon: 'account',
    position: 'bottom',
    component: AccountsView,
    actions: [
      { icon: 'refresh', title: 'Refresh Accounts', command: 'accounts.refresh' },
      { icon: 'add', title: 'Add Account…', command: 'accounts.add' },
    ],
    useBadge: () => useAccounts((state) => tenantsNeedingReauth(state.snapshot).length),
  },
];

export function getView(id: string): ViewDescriptor | undefined {
  return VIEWS.find((view) => view.id === id);
}
