import type { Parameter } from '@raml-kql/pack-schema/schemas';

import { parseInput, type QueryParameters } from './parameters';
import { useQueryDocs, updateQueryDoc } from './query-docs';

import './ParameterBar.css';

const PLACEHOLDERS: Partial<Record<Parameter['type'], string>> = {
  datetime: '2026-01-31T00:00:00Z',
  timespan: '1d, 4h, 30m',
  stringList: 'a, b, c',
  dynamic: '{"key": "value"}',
};

function setInput(editorId: string, name: string, text: string): void {
  const current = useQueryDocs.getState().docs[editorId]?.parameters;
  if (current === undefined) return;
  updateQueryDoc(editorId, {
    parameters: { ...current, inputs: { ...current.inputs, [name]: text } },
  });
}

function ParameterInput({
  editorId,
  parameter,
  input,
}: {
  editorId: string;
  parameter: Parameter;
  input: string;
}): React.JSX.Element {
  const parsed = parseInput(parameter, input);
  const error = 'error' in parsed ? parsed.error : undefined;
  const title = [`${parameter.name} (${parameter.type})`, parameter.description, error]
    .filter((line) => line !== undefined && line !== '')
    .join('\n');
  const common = {
    'data-parameter': parameter.name,
    'aria-label': parameter.name,
    'aria-invalid': error === undefined ? undefined : true,
    title,
  };
  let control: React.JSX.Element;
  if (parameter.type === 'bool') {
    control = (
      <input
        type="checkbox"
        className="checkbox"
        checked={input === 'true'}
        onChange={(event) => {
          setInput(editorId, parameter.name, event.target.checked ? 'true' : 'false');
        }}
        {...common}
      />
    );
  } else if (parameter.type === 'enum') {
    control = (
      <select
        className="select parameter-select"
        value={input}
        onChange={(event) => {
          setInput(editorId, parameter.name, event.target.value);
        }}
        {...common}
      >
        {(parameter.values ?? []).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    );
  } else {
    const numeric = ['int', 'long', 'real'].includes(parameter.type);
    control = (
      <input
        type="text"
        className={`input parameter-input${error === undefined ? '' : ' invalid'}`}
        value={input}
        spellCheck={false}
        placeholder={PLACEHOLDERS[parameter.type] ?? ''}
        size={Math.min(40, Math.max(numeric ? 6 : 12, input.length + 1))}
        onChange={(event) => {
          setInput(editorId, parameter.name, event.target.value);
        }}
        {...common}
      />
    );
  }
  return (
    <label className={`parameter${error === undefined ? '' : ' invalid'}`} title={title}>
      <span className="parameter-name">{parameter.name}</span>
      {control}
    </label>
  );
}

/**
 * The parameter bar above a query with parameters (spec 08), like the portal's parameter pills.
 * Values belong to the tab and are injected as `let` statements when the query runs.
 */
export function ParameterBar({
  editorId,
  parameters,
}: {
  editorId: string;
  parameters: QueryParameters;
}): React.JSX.Element {
  return (
    <div className="parameter-bar" role="group" aria-label="Query parameters">
      {parameters.definitions.map((parameter) => (
        <ParameterInput
          key={parameter.name}
          editorId={editorId}
          parameter={parameter}
          input={parameters.inputs[parameter.name] ?? ''}
        />
      ))}
    </div>
  );
}
