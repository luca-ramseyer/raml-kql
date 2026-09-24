import { SettingsEditor } from '../../features/settings/SettingsEditor';
import { WelcomePage } from '../../features/welcome/WelcomePage';
import { executeCommand } from '../../platform/commands';
import { activateEditor, closeEditor, useEditors, type EditorInput } from '../../platform/editors';
import { useKeybindingLabel } from '../../platform/keybindings/keybinding-service';
import { Codicon } from '../common/Codicon';
import { KeybindingLabel } from '../common/KeybindingLabel';

import './EditorArea.css';

function Tab({ editor, active }: { editor: EditorInput; active: boolean }): React.JSX.Element {
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={`tab${active ? ' active' : ''}`}
      title={editor.title}
      onClick={() => {
        activateEditor(editor.id);
      }}
      onAuxClick={(event) => {
        // Middle click closes, like VS Code.
        if (event.button === 1) closeEditor(editor.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') activateEditor(editor.id);
      }}
    >
      <Codicon name={editor.icon} className="tab-icon" />
      <span className="tab-label">{editor.title}</span>
      <button
        type="button"
        className="tab-close"
        title="Close"
        aria-label={`Close ${editor.title}`}
        onClick={(event) => {
          event.stopPropagation();
          closeEditor(editor.id);
        }}
      >
        <Codicon name="close" />
      </button>
    </div>
  );
}

function WatermarkEntry({ label, command }: { label: string; command: string }): React.JSX.Element {
  const keybinding = useKeybindingLabel(command);
  return (
    <dl className="watermark-entry">
      <dt>{label}</dt>
      <dd>{keybinding === undefined ? null : <KeybindingLabel label={keybinding} />}</dd>
    </dl>
  );
}

/** Shown when no editor is open, like VS Code's empty editor watermark. */
function Watermark(): React.JSX.Element {
  return (
    <div className="editor-watermark">
      <div className="watermark-box">
        <WatermarkEntry label="Show All Commands" command="workbench.action.showCommands" />
        <WatermarkEntry label="Go to Query" command="workbench.action.quickOpen" />
        <WatermarkEntry label="Toggle Panel" command="workbench.action.togglePanel" />
        <WatermarkEntry label="Open Settings" command="workbench.action.openSettings" />
        <button
          type="button"
          className="watermark-link"
          onClick={() => void executeCommand('workbench.action.showWelcomePage')}
        >
          Open Welcome Page
        </button>
      </div>
    </div>
  );
}

export function EditorArea(): React.JSX.Element {
  const { editors, activeId } = useEditors();
  const active = editors.find((editor) => editor.id === activeId);

  return (
    <section className="part editor" aria-label="Editor">
      {editors.length === 0 ? (
        <Watermark />
      ) : (
        <>
          <div className="tabs-container" role="tablist" aria-label="Open editors">
            {editors.map((editor) => (
              <Tab key={editor.id} editor={editor} active={editor.id === activeId} />
            ))}
          </div>
          <div className="editor-content" role="tabpanel" aria-label={active?.title}>
            {active?.kind === 'welcome' ? <WelcomePage /> : null}
            {active?.kind === 'settings' ? <SettingsEditor /> : null}
          </div>
        </>
      )}
    </section>
  );
}
