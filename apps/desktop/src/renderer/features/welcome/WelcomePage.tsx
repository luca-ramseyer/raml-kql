import { executeCommand } from '../../platform/commands';
import { useContextKeys } from '../../platform/context-keys';
import { useKeybindingLabel } from '../../platform/keybindings/keybinding-service';
import { updateSetting, useSetting } from '../../platform/settings';
import { Codicon } from '../../workbench/common/Codicon';
import { KeybindingLabel } from '../../workbench/common/KeybindingLabel';

import './WelcomePage.css';

function StartLink({
  icon,
  label,
  command,
}: {
  icon: string;
  label: string;
  command: string;
}): React.JSX.Element {
  return (
    <li>
      <button type="button" className="welcome-link" onClick={() => void executeCommand(command)}>
        <Codicon name={icon} />
        <span>{label}</span>
      </button>
    </li>
  );
}

function ShortcutRow({ label, command }: { label: string; command: string }): React.JSX.Element {
  const keybinding = useKeybindingLabel(command);
  return (
    <li className="welcome-shortcut">
      <button type="button" className="welcome-link" onClick={() => void executeCommand(command)}>
        {label}
      </button>
      {keybinding === undefined ? null : <KeybindingLabel label={keybinding} />}
    </li>
  );
}

/** First-run page, modelled on VS Code's Welcome page (spec 05, "Empty and first-run states"). */
export function WelcomePage(): React.JSX.Element {
  const demo = useContextKeys((state) => state.values['demoMode'] === true);
  const startupEditor = useSetting('workbench.startupEditor');

  return (
    <div className="welcome-page">
      <div className="welcome-content">
        <div className="welcome-header">
          <h1>Raml KQL</h1>
          <p className="welcome-subtitle">One KQL query, many Log Analytics workspaces</p>
        </div>
        <div className="welcome-columns">
          <section className="welcome-section" aria-labelledby="welcome-start">
            <h2 id="welcome-start">Start</h2>
            <ul className="welcome-list">
              <StartLink icon="new-file" label="New Query" command="query.new" />
              <StartLink
                icon="repo-clone"
                label="Add Query Pack Source…"
                command="library.addPackSource"
              />
              {demo ? (
                <StartLink
                  icon="beaker"
                  label="Exit Demo Mode…"
                  command="workbench.action.restartInLiveMode"
                />
              ) : (
                <StartLink
                  icon="beaker"
                  label="Try Demo Mode…"
                  command="workbench.action.restartInDemoMode"
                />
              )}
              <StartLink
                icon="settings-gear"
                label="Open Settings"
                command="workbench.action.openSettings"
              />
              <StartLink
                icon="symbol-color"
                label="Choose a Color Theme"
                command="workbench.action.selectTheme"
              />
              <StartLink
                icon="folder-opened"
                label="Open Config Folder"
                command="workbench.action.openConfigFolder"
              />
            </ul>
            <h2>Help</h2>
            <ul className="welcome-list">
              <StartLink
                icon="book"
                label="Documentation"
                command="workbench.action.openDocumentation"
              />
              <StartLink
                icon="github"
                label="Report an Issue"
                command="workbench.action.openIssueReporter"
              />
            </ul>
          </section>
          <section className="welcome-section" aria-labelledby="welcome-shortcuts">
            <h2 id="welcome-shortcuts">Keyboard Shortcuts</h2>
            <ul className="welcome-list">
              <ShortcutRow label="Show All Commands" command="workbench.action.showCommands" />
              <ShortcutRow label="Go to Query" command="workbench.action.quickOpen" />
              <ShortcutRow
                label="Toggle Primary Side Bar"
                command="workbench.action.toggleSidebarVisibility"
              />
              <ShortcutRow label="Toggle Panel" command="workbench.action.togglePanel" />
              <ShortcutRow label="Show Targets" command="workbench.view.targets" />
              <ShortcutRow label="Open Settings" command="workbench.action.openSettings" />
            </ul>
          </section>
        </div>
        <label className="welcome-startup">
          <input
            type="checkbox"
            className="checkbox"
            checked={startupEditor === 'welcomePage'}
            onChange={(event) =>
              void updateSetting(
                'workbench.startupEditor',
                event.target.checked ? 'welcomePage' : 'none',
              )
            }
          />
          Show welcome page on startup
        </label>
      </div>
    </div>
  );
}
