import type { UiRequest } from '../../../shared/extensions/models';
import { executeCommand } from '../../platform/commands';
import { showDialog } from '../../platform/dialogs';
import { useEditors } from '../../platform/editors';
import { dismissNotification, notify } from '../../platform/notifications';
import { showInputBox, showQuickPick } from '../../platform/quickinput/quick-input';
import { getSetting } from '../../platform/settings';
import { getBridge, unwrap } from '../../services/ipc';
import { getActiveCodeEditor } from '../editor/active-editor';
import { usePrivacy } from '../privacy/privacy';
import { openQueryTab } from '../query/open-query';
import { useQueryDocs } from '../query/query-docs';

/**
 * Requests from the extension host that need the workbench (spec 07): messages, quick picks,
 * input boxes, progress, the query editor, and permission prompts. Each is answered with
 * `extensions.respond`.
 */
const PERMISSION_TEXT: Record<string, string> = {
  network: 'connect to the internet',
  'results.read': 'read the full query results',
  'results.readSelection': 'read the result values you selected',
  'query.run': 'run KQL queries against your targets',
  'tenants.realNames': 'see real tenant and workspace names',
};

const SCOPES = ['run', 'session', 'always'] as const;

/** The permission prompt (spec 07): what will happen, why, and for how long. */
export async function promptPermission(
  request: Extract<UiRequest, { kind: 'permission' }>,
): Promise<'run' | 'session' | 'always' | 'deny'> {
  const what = request.permission.startsWith('auth:')
    ? `get access tokens for ${request.permission.slice(5)}`
    : (PERMISSION_TEXT[request.permission] ?? request.permission);
  const high = request.risk === 'high';
  const buttons = [
    request.hasRun ? 'Allow for This Run' : 'Allow Once',
    'Allow for This Session',
    'Always Allow',
    'Deny',
  ];
  const preferred = SCOPES.indexOf(getSetting('extensions.permissions.defaultScope'));
  const choice = await showDialog({
    severity: high ? 'shield' : 'info',
    label: `Permission request from ${request.extension}`,
    message: `${request.extension} wants to ${what}.`,
    detail: (
      <div className="permission-detail">
        <p>
          It wants to <strong>{request.detail}</strong>
          {request.hosts === undefined ? '' : ` (allowed hosts: ${request.hosts.join(', ')})`}.
        </p>
        {request.reason === '' ? null : <p>Reason given by the extension: “{request.reason}”</p>}
        {high ? <p>This is a high-risk permission.</p> : null}
        {usePrivacy.getState().aliased && request.permission.startsWith('results') ? (
          <p>Presentation mode is on — values are real, not aliased, when sent.</p>
        ) : null}
      </div>
    ),
    buttons,
    defaultButton: preferred < 0 ? 0 : preferred,
  });
  return choice === undefined || choice === 3 ? 'deny' : (SCOPES[choice] ?? 'deny');
}

function pickIndex(
  request: Extract<UiRequest, { kind: 'quickPick' }>,
): Promise<number | undefined> {
  return new Promise((resolve) => {
    showQuickPick({
      placeholder: request.placeHolder ?? `${request.extension}: select an item`,
      getItems: () =>
        request.items.map((item, index) => ({
          id: String(index),
          label: item.label,
          description: item.description,
          detail: item.detail,
        })),
      onAccept: (item) => {
        resolve(item === undefined ? undefined : Number(item.id));
      },
      onCancel: () => {
        resolve(undefined);
      },
    });
  });
}

function input(request: Extract<UiRequest, { kind: 'inputBox' }>): Promise<string | undefined> {
  return new Promise((resolve) => {
    showInputBox({
      placeholder: request.placeHolder ?? '',
      prompt: request.prompt ?? request.extension,
      ...(request.value === undefined ? {} : { value: request.value }),
      ...(request.password === true ? { password: true } : {}),
      onAccept: resolve,
      onCancel: () => {
        resolve(undefined);
      },
    });
  });
}

function message(request: Extract<UiRequest, { kind: 'message' }>): Promise<string | undefined> {
  if (request.actions.length === 0) {
    notify({ severity: request.severity, message: request.message, source: request.extension });
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const id = notify({
      severity: request.severity,
      message: request.message,
      source: request.extension,
      actions: request.actions.map((label) => ({
        label,
        run: () => {
          dismissNotification(id);
          resolve(label);
        },
      })),
    });
  });
}

const progress = new Map<number, number>();

async function handle(request: UiRequest): Promise<unknown> {
  switch (request.kind) {
    case 'message':
      return message(request);
    case 'quickPick':
      return pickIndex(request);
    case 'inputBox':
      return input(request);
    case 'progress': {
      const existing = progress.get(request.progressId);
      if (request.title === undefined) {
        if (existing !== undefined) dismissNotification(existing);
        progress.delete(request.progressId);
      } else {
        progress.set(
          request.progressId,
          notify({ severity: 'info', message: `${request.title}…`, source: request.extension }),
        );
      }
      return undefined;
    }
    case 'permission':
      return promptPermission(request);
    case 'editor.getActiveQuery': {
      const { activeId, editors } = useEditors.getState();
      const editor = editors.find((e) => e.id === activeId);
      return editor?.kind === 'query' ? useQueryDocs.getState().docs[editor.id]?.text : undefined;
    }
    case 'editor.insertText': {
      const editor = getActiveCodeEditor();
      const selection = editor?.getSelection();
      if (editor !== undefined && selection !== null && selection !== undefined) {
        editor.executeEdits('extension', [{ range: selection, text: request.text }]);
      }
      return undefined;
    }
    case 'editor.openQueryTab':
      openQueryTab({
        text: request.query,
        ...(request.title === undefined ? {} : { title: request.title }),
      });
      return undefined;
    case 'executeHostCommand':
      await executeCommand(request.command);
      return undefined;
  }
}

export function handleUiRequest(event: { requestId: number; request: UiRequest }): void {
  void handle(event.request)
    .catch(() => undefined)
    .then((value) =>
      unwrap(
        getBridge().extensions.respond({
          requestId: event.requestId,
          ...(value === undefined ? {} : { value: value as never }),
        }),
      ),
    )
    .catch(() => undefined);
}
