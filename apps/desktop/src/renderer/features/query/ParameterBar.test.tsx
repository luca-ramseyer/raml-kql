import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ParameterBar } from './ParameterBar';
import { initialParameters } from './parameters';
import { createQueryDoc, useQueryDocs } from './query-docs';

function Bar({ id }: { id: string }): React.JSX.Element | null {
  const parameters = useQueryDocs((s) => s.docs[id]?.parameters);
  return parameters === undefined ? null : <ParameterBar editorId={id} parameters={parameters} />;
}

describe('ParameterBar', () => {
  afterEach(() => {
    useQueryDocs.setState({ docs: {} });
  });

  it('edits the tab’s parameter inputs by type and flags invalid values', () => {
    createQueryDoc('q1', 'print 1', {
      parameters: initialParameters([
        { name: 'MinFailures', type: 'long', default: 10, description: 'Minimum failures' },
        { name: 'Severity', type: 'enum', values: ['High', 'Low'], default: 'High' },
        { name: 'OnlyClicked', type: 'bool', default: false },
      ]),
    });
    render(<Bar id="q1" />);
    const group = screen.getByRole('group', { name: 'Query parameters' });
    expect(group).toBeInTheDocument();

    const min = screen.getByRole('textbox', { name: 'MinFailures' });
    expect(min).toHaveValue('10');
    fireEvent.change(min, { target: { value: 'ten' } });
    expect(min).toHaveAttribute('aria-invalid', 'true');
    expect(useQueryDocs.getState().docs['q1']?.parameters?.inputs['MinFailures']).toBe('ten');
    fireEvent.change(min, { target: { value: '25' } });
    expect(min).not.toHaveAttribute('aria-invalid');

    fireEvent.change(screen.getByRole('combobox', { name: 'Severity' }), {
      target: { value: 'Low' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'OnlyClicked' }));
    expect(useQueryDocs.getState().docs['q1']?.parameters?.inputs).toEqual({
      MinFailures: '25',
      Severity: 'Low',
      OnlyClicked: 'true',
    });
  });
});
