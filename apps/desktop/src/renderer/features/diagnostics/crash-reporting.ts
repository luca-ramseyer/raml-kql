import { AppError } from '../../../shared/errors';
import { registerCommand } from '../../platform/commands';
import { openEditor } from '../../platform/editors';
import { notify } from '../../platform/notifications';
import { getSetting, updateSetting } from '../../platform/settings';
import { getBridge, unwrap } from '../../services/ipc';

/**
 * Crash reporting in the workbench (spec 10): errors here are sent to main (sanitized there);
 * after a crash, the next start offers a sanitized report the user reviews and files on
 * GitHub themselves. Nothing is sent anywhere without that.
 */
const MAX_REPORTED = 10;

export function startErrorCapture(): () => void {
  let reported = 0;
  const send = (message: string, stack: string | undefined): void => {
    if (reported >= MAX_REPORTED) return;
    reported += 1;
    void unwrap(
      getBridge().crash.reportError({
        message: message.slice(0, 4000),
        ...(stack === undefined ? {} : { stack: stack.slice(0, 20_000) }),
      }),
    ).catch(() => undefined);
  };
  const onError = (event: ErrorEvent): void => {
    // Benign browser noise, not an app error.
    if (/ResizeObserver loop/.test(event.message)) return;
    const error: unknown = event.error;
    send(
      error instanceof Error ? `${error.name}: ${error.message}` : event.message,
      error instanceof Error ? error.stack : undefined,
    );
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason: unknown = event.reason;
    // Expected failures (a refused permission, a failed query) are reported to the user already.
    if (reason instanceof AppError) return;
    send(
      reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
      reason instanceof Error ? reason.stack : undefined,
    );
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

export async function copyCrashReport(): Promise<void> {
  const report = await unwrap(getBridge().crash.report());
  await unwrap(getBridge().shell.writeClipboard({ text: `# ${report.title}\n\n${report.body}` }));
  await unwrap(getBridge().crash.dismiss());
  notify({
    severity: 'info',
    message: 'Crash report copied (sanitized).',
    source: 'Crash Reporting',
  });
}

/** On start: offer to report the last session's crash (`crashReporting.mode: "ask"`). */
export async function offerCrashReport(): Promise<void> {
  if (getSetting('crashReporting.mode') !== 'ask') return;
  let pending;
  try {
    pending = await unwrap(getBridge().crash.pending());
  } catch {
    return;
  }
  if (!pending.unclean && pending.records.length === 0) return;
  notify({
    severity: 'warning',
    message: pending.unclean
      ? 'Raml KQL closed unexpectedly. Report the problem?'
      : 'Raml KQL ran into errors last time. Report the problem?',
    detail:
      'You see the report first. It is sanitized: IDs, names, e-mail addresses, IPs, tokens and query text are removed.',
    source: 'Crash Reporting',
    actions: [
      {
        label: 'Preview & Report on GitHub',
        run: () => {
          openEditor('crashReport');
        },
      },
      { label: 'Copy Report', run: () => void copyCrashReport().catch(() => undefined) },
      {
        label: "Don't Ask Again",
        run: () => {
          void updateSetting('crashReporting.mode', 'off');
          void unwrap(getBridge().crash.dismiss()).catch(() => undefined);
        },
      },
    ],
  });
}

export function registerDiagnosticsCommands(): () => void {
  const disposers = [
    registerCommand({
      id: 'developer.showNetworkActivity',
      title: 'Show Network Activity',
      category: 'Developer',
      icon: 'radio-tower',
      run: () => {
        openEditor('networkActivity');
      },
    }),
    registerCommand({
      id: 'developer.showCrashReport',
      title: 'Show Crash Report',
      category: 'Developer',
      icon: 'bug',
      run: () => {
        openEditor('crashReport');
      },
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
