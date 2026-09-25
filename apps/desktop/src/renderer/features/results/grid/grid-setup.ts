import {
  CellStyleModule,
  ClientSideRowModelModule,
  ColumnAutoSizeModule,
  DateFilterModule,
  InfiniteRowModelModule,
  ModuleRegistry,
  NumberFilterModule,
  RowSelectionModule,
  TextFilterModule,
  themeQuartz,
  TooltipModule,
  ValidationModule,
} from 'ag-grid-community';

/**
 * AG Grid Community (spec 06): only the modules the results grid uses, and a theme built from
 * the workbench's `--vscode-*` colours so the grid follows every VS Code theme.
 */
let registered = false;

export function registerGridModules(): void {
  if (registered) return;
  registered = true;
  ModuleRegistry.registerModules([
    InfiniteRowModelModule,
    ClientSideRowModelModule,
    TextFilterModule,
    NumberFilterModule,
    DateFilterModule,
    RowSelectionModule,
    TooltipModule,
    ColumnAutoSizeModule,
    CellStyleModule,
    ...(import.meta.env.DEV ? [ValidationModule] : []),
  ]);
}

export const gridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--vscode-panel-background, var(--vscode-editor-background))',
  foregroundColor: 'var(--vscode-foreground)',
  textColor: 'var(--vscode-foreground)',
  headerBackgroundColor: 'var(--vscode-panel-background, var(--vscode-editor-background))',
  headerTextColor: 'var(--vscode-foreground)',
  headerFontWeight: 600,
  borderColor: 'var(--vscode-panel-border, rgba(128, 128, 128, 0.35))',
  rowBorder: { color: 'var(--vscode-tree-tableColumnsBorder, rgba(128, 128, 128, 0.2))' },
  rowHoverColor: 'var(--vscode-list-hoverBackground)',
  selectedRowBackgroundColor: 'var(--vscode-list-inactiveSelectionBackground)',
  accentColor: 'var(--vscode-focusBorder)',
  chromeBackgroundColor: 'var(--vscode-editorWidget-background)',
  inputBackgroundColor: 'var(--vscode-input-background)',
  inputTextColor: 'var(--vscode-input-foreground)',
  inputBorder: { color: 'var(--vscode-input-border, transparent)' },
  menuBackgroundColor: 'var(--vscode-editorWidget-background)',
  menuTextColor: 'var(--vscode-editorWidget-foreground, var(--vscode-foreground))',
  tooltipBackgroundColor: 'var(--vscode-editorHoverWidget-background)',
  tooltipTextColor: 'var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground))',
  fontFamily: 'var(--vscode-font-family)',
  fontSize: 12,
  cellFontFamily: 'var(--vscode-editor-font-family, monospace)',
  rowHeight: 22,
  headerHeight: 26,
  spacing: 4,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  oddRowBackgroundColor: 'transparent',
  columnBorder: { color: 'var(--vscode-tree-tableColumnsBorder, rgba(128, 128, 128, 0.2))' },
});
