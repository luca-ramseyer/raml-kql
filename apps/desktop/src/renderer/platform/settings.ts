import { create } from 'zustand';

import type { SettingsSnapshot } from '../../shared/config/config-snapshots';
import {
  defaultSettingValues,
  type SettingKey,
  type SettingValue,
  type SettingValues,
} from '../../shared/settings/registry';
import { getBridge, unwrap } from '../services/ipc';

import { notify } from './notifications';

interface SettingsState {
  /** Valid values from settings.jsonc (what the user set). */
  user: SettingsSnapshot['values'];
  problems: SettingsSnapshot['problems'];
  /** Effective values: defaults overlaid with the user's values. */
  values: SettingValues;
}

export const useSettings = create<SettingsState>(() => ({
  user: {},
  problems: [],
  values: defaultSettingValues(),
}));

let lastProblemsSignature = '';

export function applySettingsSnapshot(snapshot: SettingsSnapshot): void {
  useSettings.setState({
    user: snapshot.values,
    problems: snapshot.problems,
    values: { ...defaultSettingValues(), ...snapshot.values },
  });

  // "settings.jsonc has errors (line 12) — Open" (spec 09), once per distinct set of problems.
  const signature = JSON.stringify(snapshot.problems);
  if (signature !== lastProblemsSignature) {
    lastProblemsSignature = signature;
    const [first] = snapshot.problems;
    if (first !== undefined) {
      notify({
        key: 'settings-problems',
        severity: 'error',
        message:
          first.line > 0
            ? `${first.file} has errors (line ${String(first.line)}). The last valid settings stay in effect.`
            : `${first.file}: ${first.message}`,
        detail: snapshot.problems.map((p) => `Line ${String(p.line)}: ${p.message}`).join('\n'),
        actions: [
          {
            label: 'Open settings.jsonc',
            run: () => void getBridge().shell.openConfigFile({ file: 'settings' }),
          },
        ],
      });
    }
  }
}

export function getSetting<K extends SettingKey>(key: K): SettingValue<K> {
  return useSettings.getState().values[key];
}

export function useSetting<K extends SettingKey>(key: K): SettingValue<K> {
  return useSettings((state) => state.values[key]);
}

function reportWriteError(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Could not save the setting.';
  notify({
    severity: 'error',
    message,
    actions: [
      {
        label: 'Open settings.jsonc',
        run: () => void getBridge().shell.openConfigFile({ file: 'settings' }),
      },
    ],
  });
}

/**
 * Show the new value at once (controls stay responsive), then reconcile with what the main
 * process actually wrote. On failure, restore the previous state.
 */
async function writeSetting(
  request: Parameters<ReturnType<typeof getBridge>['settings']['update']>[0],
  optimisticUser: SettingsSnapshot['values'],
): Promise<void> {
  const previous = useSettings.getState();
  useSettings.setState({
    user: optimisticUser,
    values: { ...defaultSettingValues(), ...optimisticUser },
  });
  try {
    applySettingsSnapshot(await unwrap(getBridge().settings.update(request)));
  } catch (error) {
    useSettings.setState({ user: previous.user, values: previous.values });
    reportWriteError(error);
  }
}

export function updateSetting<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
  const user = { ...useSettings.getState().user, [key]: value };
  return writeSetting({ action: 'set', key, value: value as never }, user);
}

export function resetSetting(key: SettingKey): Promise<void> {
  const user = Object.fromEntries(
    Object.entries(useSettings.getState().user).filter(([k]) => k !== key),
  );
  return writeSetting({ action: 'reset', key }, user);
}
