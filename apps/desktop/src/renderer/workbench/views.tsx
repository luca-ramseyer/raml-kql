import { tenantsNeedingReauth, useAccounts } from '../features/accounts/accounts-store';
import { AccountsView } from '../features/accounts/AccountsView';
import { WelcomeView } from '../features/placeholders/WelcomeView';
import { useContextKeys } from '../platform/context-keys';

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

function DemoModeAction(): React.JSX.Element {
  const demo = useContextKeys((state) => state.values['demoMode'] === true);
  return demo ? (
    <WelcomeView paragraphs={['Demo mode is on: every view shows fake, deterministic data.']} />
  ) : (
    <WelcomeView
      paragraphs={['No Azure access yet? Explore Raml KQL with fake tenants and workspaces.']}
      actions={[{ label: 'Restart in Demo Mode', command: 'workbench.action.restartInDemoMode' }]}
    />
  );
}

export const VIEWS: readonly ViewDescriptor[] = [
  {
    id: 'workbench.view.targets',
    title: 'Targets',
    icon: 'target',
    position: 'top',
    component: () => (
      <>
        <WelcomeView
          paragraphs={[
            'Targets are the Log Analytics workspaces a query runs against.',
            'Workspaces appear here after you add an account and choose which workspaces to enable.',
          ]}
        />
        <DemoModeAction />
      </>
    ),
  },
  {
    id: 'workbench.view.library',
    title: 'Library',
    icon: 'library',
    position: 'top',
    component: () => (
      <WelcomeView
        paragraphs={['Your saved queries and installed query packs will appear here.']}
      />
    ),
  },
  {
    id: 'workbench.view.history',
    title: 'History',
    icon: 'history',
    position: 'top',
    component: () => (
      <WelcomeView
        paragraphs={['Queries you run will appear here. Only query text is kept, never results.']}
      />
    ),
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
