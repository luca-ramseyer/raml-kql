import { z } from 'zod';

/**
 * The grid's view of a result table (spec 06): sort, column filters and quick search. The
 * filter shapes are the subset of AG Grid's filter model the grid uses, so the grid's model is
 * sent as is and evaluated in the main process, next to the data.
 */

const TextType = z.enum([
  'contains',
  'notContains',
  'equals',
  'notEqual',
  'startsWith',
  'endsWith',
  'blank',
  'notBlank',
]);
const RangeType = z.enum([
  'equals',
  'notEqual',
  'lessThan',
  'lessThanOrEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'inRange',
  'blank',
  'notBlank',
]);

export const TextConditionSchema = z.object({
  filterType: z.literal('text'),
  type: TextType,
  filter: z.string().max(10_000).nullish(),
});
export const NumberConditionSchema = z.object({
  filterType: z.literal('number'),
  type: RangeType,
  filter: z.number().nullish(),
  filterTo: z.number().nullish(),
});
export const DateConditionSchema = z.object({
  filterType: z.literal('date'),
  type: RangeType,
  /** AG Grid's format: `YYYY-MM-DD hh:mm:ss`. */
  dateFrom: z.string().max(40).nullish(),
  dateTo: z.string().max(40).nullish(),
});
/** "Filter to / exclude this value" from the context menu (exact match on the raw value). */
export const ValuesConditionSchema = z.object({
  filterType: z.literal('values'),
  mode: z.enum(['include', 'exclude']),
  values: z.array(z.json()).max(1000),
});

export const ConditionSchema = z.discriminatedUnion('filterType', [
  TextConditionSchema,
  NumberConditionSchema,
  DateConditionSchema,
  ValuesConditionSchema,
]);
export type FilterCondition = z.infer<typeof ConditionSchema>;

const CombinedSchema = z.object({
  filterType: z.enum(['text', 'number', 'date']),
  operator: z.enum(['AND', 'OR']),
  conditions: z.array(ConditionSchema).min(1).max(10),
});
export const ColumnFilterSchema = z.union([ConditionSchema, CombinedSchema]);
export type ColumnFilter = z.infer<typeof ColumnFilterSchema>;

export const ViewStateSchema = z.object({
  /** By column index. */
  sort: z
    .array(z.object({ column: z.number().int().nonnegative(), direction: z.enum(['asc', 'desc']) }))
    .max(20)
    .default([]),
  /** Column index (as string) → filter. */
  filters: z.record(z.string().regex(/^\d+$/), ColumnFilterSchema).default({}),
  quickSearch: z.string().max(1000).default(''),
  /** "Filter to / Exclude this value" from the cell context menu, on top of column filters. */
  valueFilters: z
    .array(
      z.object({
        column: z.number().int().nonnegative(),
        mode: z.enum(['include', 'exclude']),
        values: z.array(z.json()).max(1000),
      }),
    )
    .max(50)
    .default([]),
});
export type ViewState = z.infer<typeof ViewStateSchema>;
export type ViewStateInput = z.input<typeof ViewStateSchema>;

export const ViewRequestSchema = z
  .object({
    runId: z.string().min(1).max(100),
    tableIndex: z.number().int().nonnegative().max(1000),
    view: ViewStateSchema,
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(10_000),
  })
  .strict();
export type ViewRequest = z.input<typeof ViewRequestSchema>;

export const ViewPageSchema = z.object({
  /** Rows in view order; each row's position in the unfiltered table is in `positions`. */
  rows: z.array(z.array(z.json())),
  positions: z.array(z.number().int().nonnegative()),
  /** Rows matching the view (filtered count). */
  rowCount: z.number().int().nonnegative(),
  /** Rows in the table. */
  totalRows: z.number().int().nonnegative(),
});
export type ViewPage = z.infer<typeof ViewPageSchema>;

export function isViewActive(view: ViewState): boolean {
  return (
    view.sort.length > 0 ||
    Object.keys(view.filters).length > 0 ||
    view.valueFilters.length > 0 ||
    view.quickSearch.trim() !== ''
  );
}
