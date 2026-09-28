import {
  filterQuickPickItems,
  showInputBox,
  showQuickPick,
  type QuickPickItem,
} from '../../platform/quickinput/quick-input';
import { useSetting } from '../../platform/settings';
import { Codicon } from '../../workbench/common/Codicon';
import {
  TIME_PRESET_LABELS,
  TIME_PRESETS,
  type TimePreset,
  type TimeRange,
} from '../query/query-docs';
import {
  formatDateTime,
  parseDateTime,
  timeRangeLabel,
  type DisplayZone,
} from '../query/time-range';

const CUSTOM_ID = 'custom';

/** Ask for a custom start and end, like the portal's custom range (spec 05). */
function pickCustomRange(
  current: TimeRange,
  zone: DisplayZone,
  onChange: (range: TimeRange) => void,
): void {
  const zoneName = zone === 'utc' ? 'UTC' : 'local time';
  const now = new Date();
  const start =
    current.kind === 'custom' ? new Date(current.start) : new Date(now.getTime() - 86_400_000);
  const end = current.kind === 'custom' ? new Date(current.end) : now;
  const validate = (value: string): string | undefined =>
    parseDateTime(value, zone) === undefined
      ? 'Use the format YYYY-MM-DD HH:mm, e.g. 2026-01-31 08:00.'
      : undefined;

  showInputBox({
    placeholder: 'YYYY-MM-DD HH:mm',
    prompt: `Start of the time range (${zoneName})`,
    value: formatDateTime(start, zone),
    validate,
    onAccept: (startText) => {
      const startDate = parseDateTime(startText, zone);
      if (startDate === undefined) return;
      showInputBox({
        placeholder: 'YYYY-MM-DD HH:mm',
        prompt: `End of the time range (${zoneName})`,
        value: formatDateTime(end, zone),
        validate: (value) => {
          const error = validate(value);
          if (error !== undefined) return error;
          const endDate = parseDateTime(value, zone);
          return endDate !== undefined && endDate <= startDate
            ? 'The end must be after the start.'
            : undefined;
        },
        onAccept: (endText) => {
          const endDate = parseDateTime(endText, zone);
          if (endDate === undefined) return;
          onChange({ kind: 'custom', start: startDate.toISOString(), end: endDate.toISOString() });
        },
      });
    },
  });
}

export function showTimeRangePicker(
  current: TimeRange,
  zone: DisplayZone,
  onChange: (range: TimeRange) => void,
): void {
  const items: QuickPickItem[] = [
    ...TIME_PRESETS.map((preset) => ({
      id: preset,
      label: TIME_PRESET_LABELS[preset],
      icon: current.kind === 'preset' && current.preset === preset ? 'check' : 'blank',
    })),
    {
      id: CUSTOM_ID,
      label: 'Custom…',
      icon: current.kind === 'custom' ? 'check' : 'blank',
      description: current.kind === 'custom' ? timeRangeLabel(current, zone) : undefined,
    },
  ];
  showQuickPick({
    placeholder: 'Select a time range',
    getItems: (filter) => filterQuickPickItems(items, filter),
    onAccept: (item) => {
      if (item === undefined) return;
      if (item.id === CUSTOM_ID) pickCustomRange(current, zone, onChange);
      else onChange({ kind: 'preset', preset: item.id as TimePreset });
    },
  });
}

/** The toolbar button next to Run. Shows "Set in query" when the query filters on time itself. */
export function TimeRangePicker({
  value,
  setInQuery,
  onChange,
}: {
  value: TimeRange;
  setInQuery: boolean;
  onChange: (range: TimeRange) => void;
}): React.JSX.Element {
  const zone = useSetting('time.displayZone');
  const label = setInQuery ? 'Set in query' : timeRangeLabel(value, zone);
  return (
    <button
      type="button"
      className="query-time-range"
      aria-label={`Time range: ${label}`}
      title={
        setInQuery
          ? 'The query filters on TimeGenerated itself, so no time range is sent.'
          : 'Time range'
      }
      disabled={setInQuery}
      onClick={() => {
        showTimeRangePicker(value, zone, onChange);
      }}
    >
      <Codicon name="history" />
      <span>{label}</span>
      {setInQuery ? null : <Codicon name="chevron-down" />}
    </button>
  );
}
