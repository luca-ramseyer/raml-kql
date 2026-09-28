import { useMemo, useRef, useState } from 'react';

import {
  settingDefinitions,
  type SettingDefinition,
  type SettingKey,
} from '../../../shared/settings/registry';
import { executeCommand } from '../../platform/commands';
import { resetSetting, updateSetting, useSettings } from '../../platform/settings';
import { BUILTIN_THEMES } from '../../platform/theme/builtin-themes';
import { useTheme } from '../../platform/theme/theme-service';
import { Codicon } from '../../workbench/common/Codicon';

import { descriptionParts, settingTitle } from './setting-labels';
import './SettingsEditor.css';

const COMMONLY_USED = 'Commonly Used';

function categoryPath(definition: SettingDefinition): string {
  return definition.category.join(' › ');
}

function matches(definition: SettingDefinition, query: string): boolean {
  if (query.trim() === '') return true;
  const title = settingTitle(definition.key);
  const haystack = [
    definition.key,
    title.category,
    title.label,
    definition.description,
    categoryPath(definition),
    ...(definition.tags ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
    .every((word) => haystack.includes(word));
}

function Description({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {descriptionParts(text).map((part, index) =>
        part.code ? <code key={index}>{part.text}</code> : <span key={index}>{part.text}</span>,
      )}
    </>
  );
}

function SettingControl({
  definition,
  value,
}: {
  definition: SettingDefinition;
  value: unknown;
}): React.JSX.Element {
  const key = definition.key as SettingKey;
  const userThemes = useTheme((state) => state.userThemes);
  const control = definition.control;
  const id = `setting-${definition.key}`;
  const [draft, setDraft] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const commitText = (text: string): void => {
    const next = control.kind === 'number' ? Number(text) : text;
    const parsed = definition.schema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid value');
      return;
    }
    setError(undefined);
    setDraft(undefined);
    if (parsed.data !== value) void updateSetting(key, parsed.data as never);
  };

  switch (control.kind) {
    case 'boolean':
      return (
        <label className="setting-checkbox-row" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            className="checkbox"
            checked={value === true}
            onChange={(event) => void updateSetting(key, event.target.checked as never)}
          />
          <span className="setting-description">
            <Description text={definition.description} />
          </span>
        </label>
      );
    case 'enum':
    case 'colorTheme': {
      const options =
        control.kind === 'enum'
          ? control.options.map((option, index) => ({
              value: option,
              label: option,
              title: control.optionDescriptions?.[index],
            }))
          : [...BUILTIN_THEMES, ...userThemes].map((theme) => ({
              value: theme.label,
              label: theme.label,
              title: undefined,
            }));
      if (!options.some((option) => option.value === value) && typeof value === 'string') {
        options.push({ value, label: `${value} (not installed)`, title: undefined });
      }
      return (
        <select
          id={id}
          className="dropdown"
          value={String(value)}
          aria-label={settingTitle(definition.key).label}
          onChange={(event) => void updateSetting(key, event.target.value as never)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} title={option.title}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
    case 'string':
    case 'number':
      return (
        <div className="setting-input-container">
          <input
            id={id}
            className={`input${error === undefined ? '' : ' invalid'}`}
            type={control.kind === 'number' ? 'number' : 'text'}
            aria-label={settingTitle(definition.key).label}
            aria-invalid={error !== undefined}
            value={
              draft ?? (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
            }
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onBlur={(event) => {
              if (draft !== undefined) commitText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitText(event.currentTarget.value);
              if (event.key === 'Escape') {
                setDraft(undefined);
                setError(undefined);
              }
            }}
          />
          {error === undefined ? null : <div className="setting-validation">{error}</div>}
        </div>
      );
    case 'json':
      return (
        <button
          type="button"
          className="link-button"
          onClick={() => void executeCommand('workbench.action.openSettingsJson')}
        >
          Edit in settings.jsonc
        </button>
      );
  }
}

function SettingRow({ definition }: { definition: SettingDefinition }): React.JSX.Element {
  const value = useSettings((state) => state.values[definition.key as SettingKey]);
  const modified = useSettings((state) => Object.hasOwn(state.user, definition.key));
  const title = settingTitle(definition.key);
  return (
    <div
      className={`setting-item${modified ? ' modified' : ''}`}
      data-key={definition.key}
      role="group"
      aria-label={`${title.category}: ${title.label}`}
    >
      <div className="setting-item-title">
        <span className="setting-item-category">{title.category}: </span>
        <span className="setting-item-label">{title.label}</span>
        {modified ? (
          <button
            type="button"
            className="action-item setting-reset"
            title="Reset Setting"
            aria-label={`Reset ${title.label}`}
            onClick={() => void resetSetting(definition.key as SettingKey)}
          >
            <Codicon name="discard" />
          </button>
        ) : null}
      </div>
      {definition.control.kind === 'boolean' ? null : (
        <div className="setting-description">
          <Description text={definition.description} />
        </div>
      )}
      <div className="setting-item-value">
        <SettingControl definition={definition} value={value} />
      </div>
    </div>
  );
}

/** VS Code-like settings editor (spec 05), generated from the settings registry (spec 09). */
export function SettingsEditor(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => {
    const visible = settingDefinitions.filter((d) => matches(d, query));
    const result: { name: string; settings: SettingDefinition[] }[] = [];
    if (query.trim() === '') {
      const common = visible.filter((d) => d.commonlyUsed === true);
      if (common.length > 0) result.push({ name: COMMONLY_USED, settings: common });
    }
    for (const definition of visible) {
      const name = categoryPath(definition);
      let section = result.find((s) => s.name === name);
      if (section === undefined) {
        section = { name, settings: [] };
        result.push(section);
      }
      section.settings.push(definition);
    }
    return result;
  }, [query]);

  const count = new Set(sections.flatMap((s) => s.settings.map((d) => d.key))).size;

  return (
    <div className="settings-editor">
      <div className="settings-header">
        <div className="settings-search">
          <input
            className="input settings-search-input"
            type="search"
            placeholder="Search settings"
            aria-label="Search settings"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          {query === '' ? null : (
            <span className="settings-count" aria-live="polite">
              {count === 0
                ? 'No Settings Found'
                : `${String(count)} Setting${count === 1 ? '' : 's'} Found`}
            </span>
          )}
        </div>
        <button
          type="button"
          className="action-item"
          title="Open Settings (JSON)"
          aria-label="Open Settings (JSON)"
          onClick={() => void executeCommand('workbench.action.openSettingsJson')}
        >
          <Codicon name="go-to-file" />
        </button>
      </div>
      <div className="settings-body">
        <nav className="settings-toc" aria-label="Settings categories">
          {sections.map((section) => (
            <button
              key={section.name}
              type="button"
              className="settings-toc-entry"
              onClick={() => {
                listRef.current
                  ?.querySelector(`[data-section="${CSS.escape(section.name)}"]`)
                  ?.scrollIntoView({ block: 'start' });
              }}
            >
              {section.name}
            </button>
          ))}
        </nav>
        <div className="settings-list" ref={listRef}>
          {sections.map((section) => (
            <section key={section.name} data-section={section.name} aria-label={section.name}>
              <h3 className="settings-group-title">{section.name}</h3>
              {section.settings.map((definition) => (
                <SettingRow key={`${section.name}:${definition.key}`} definition={definition} />
              ))}
            </section>
          ))}
          {count === 0 ? <p className="settings-empty">No settings match “{query}”.</p> : null}
        </div>
      </div>
    </div>
  );
}
