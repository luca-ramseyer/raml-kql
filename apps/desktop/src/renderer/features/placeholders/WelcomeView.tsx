import { executeCommand } from '../../platform/commands';

export interface WelcomeViewAction {
  label: string;
  command: string;
}

/**
 * VS Code's "welcome view" pattern: explanatory text and buttons shown in a sidebar view that
 * has no content yet.
 */
export function WelcomeView({
  paragraphs,
  actions = [],
}: {
  paragraphs: string[];
  actions?: WelcomeViewAction[];
}): React.JSX.Element {
  return (
    <div className="welcome-view">
      {paragraphs.map((text) => (
        <p key={text}>{text}</p>
      ))}
      {actions.map((action) => (
        <button
          key={action.command}
          type="button"
          className="button button-primary welcome-view-button"
          onClick={() => void executeCommand(action.command)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
