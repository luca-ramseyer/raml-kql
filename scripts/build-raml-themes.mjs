#!/usr/bin/env node
/**
 * Builds the Raml Light and Raml Dark colour themes from the Raml brand palette
 * (https://luca-ramseyer.github.io/brand/style-guide.html): cream paper, ink type, hairline
 * rules and one sparing Swiss Red accent.
 *
 * The palette lives here, in one place; the theme files are generated from it so the two
 * variants stay consistent. The script fails if a text colour misses WCAG AA (4.5:1).
 *
 * Usage: node scripts/build-raml-themes.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../apps/desktop/src/renderer/platform/theme/builtin',
);

/** The brand palette, verbatim from the style guide. */
const BRAND = {
  cream: '#F4EFE4', // Subtle Cream: primary surface, paper
  ivory: '#FBF8F1', // Ivory: elevated panels, cards
  ink: '#211F1C', // Ink: wordmark, headings
  graphite: '#423D37', // Graphite: body text
  stone: '#857E72', // Stone: captions, secondary (not for essential text)
  red: '#C0473A', // Swiss Red: the accent, used sparingly
  hairline: '#DAD2C4', // Hairline: rules, borders
};

/**
 * Each variant: surfaces, text, lines and the accent, plus syntax colours. Colours not in the
 * brand palette are derived from it (tints and shades of the same warm neutrals), except the
 * syntax hues, which are muted, warm-leaning companions so KQL stays readable.
 */
const VARIANTS = [
  {
    id: 'raml-light',
    label: 'Raml Light',
    uiTheme: 'vs',
    p: {
      editor: BRAND.cream,
      chrome: '#EEE8DB', // activity bar, side bar, tabs, status bar: a shade under the paper
      elevated: BRAND.ivory, // menus, widgets, inputs, notifications
      line: BRAND.hairline,
      strongLine: '#C9BFAE',
      fg: BRAND.graphite,
      strongFg: BRAND.ink,
      mutedFg: '#6E675C', // Stone darkened to pass AA for the UI text that must stay readable
      faint: BRAND.stone,
      accent: BRAND.red,
      accentHover: '#A83D31',
      onAccent: BRAND.ivory,
      link: '#A83D31',
      hover: '#E6DFD0',
      selection: '#DCD0BC',
      selectionInactive: '#E6DDCD',
      listActive: '#E0D6C4',
      findMatch: '#E9C46A99',
      findMatchOther: '#E9C46A55',
      wordHighlight: '#211F1C14',
      error: '#B3261E',
      warning: '#8A5A00',
      info: '#3D5A6C',
      added: '#5E7A3A',
      modified: '#8A6A2A',
      shadow: '#211F1C29',
      syntax: {
        comment: '#6E675C',
        keyword: '#9E3B2F',
        function: '#2F5D6B',
        string: '#5A6827',
        number: '#8A5418',
        type: '#5B4A7A',
        parameter: '#7A4E2D',
        variable: BRAND.graphite,
      },
    },
  },
  {
    id: 'raml-dark',
    label: 'Raml Dark',
    uiTheme: 'vs-dark',
    p: {
      editor: BRAND.ink,
      chrome: '#1A1816',
      elevated: '#2A2724',
      line: '#36322D',
      strongLine: '#4A453E',
      fg: '#E8E1D3', // cream, a touch down so large blocks of text don't glare
      strongFg: BRAND.cream,
      mutedFg: '#A39B8E',
      faint: '#8C8478',
      accent: BRAND.red,
      accentHover: '#CF5A4C',
      onAccent: BRAND.ivory,
      link: '#E08377',
      hover: '#2E2B27',
      selection: '#4A4035',
      selectionInactive: '#3A342D',
      listActive: '#38332D',
      findMatch: '#B8872E88',
      findMatchOther: '#B8872E44',
      wordHighlight: '#F4EFE414',
      error: '#F08A7E',
      warning: '#E0B070',
      info: '#8FB8C4',
      added: '#8FA866',
      modified: '#C9A45C',
      shadow: '#00000066',
      syntax: {
        comment: '#948C7F',
        keyword: '#E5877B',
        function: '#8FBAC6',
        string: '#BAC47E',
        number: '#E3B272',
        type: '#BCAAD8',
        parameter: '#E6BC9C',
        variable: '#E8E1D3',
      },
    },
  },
];

function colors(p, dark) {
  return {
    // Base
    foreground: p.fg,
    descriptionForeground: p.mutedFg,
    disabledForeground: p.faint,
    errorForeground: p.error,
    focusBorder: p.accent,
    'icon.foreground': p.fg,
    'widget.border': p.line,
    'widget.shadow': p.shadow,
    'selection.background': p.selection,
    'sash.hoverBorder': p.accent,
    'textLink.foreground': p.link,
    'textLink.activeForeground': p.accent,
    'textSeparator.foreground': p.line,
    'textBlockQuote.background': p.chrome,
    'textBlockQuote.border': p.line,
    'textCodeBlock.background': p.chrome,
    'textPreformat.foreground': p.strongFg,
    'textPreformat.background': p.hover,
    'progressBar.background': p.accent,
    'toolbar.hoverBackground': p.hover,
    'toolbar.activeBackground': p.selection,

    // Title bar
    'titleBar.activeBackground': p.chrome,
    'titleBar.activeForeground': p.strongFg,
    'titleBar.inactiveBackground': p.chrome,
    'titleBar.inactiveForeground': p.mutedFg,
    'titleBar.border': p.line,

    // Activity bar: one red hairline marks the active view
    'activityBar.background': p.chrome,
    'activityBar.foreground': p.strongFg,
    'activityBar.inactiveForeground': p.faint,
    'activityBar.activeBorder': p.accent,
    'activityBar.border': p.line,
    'activityBarBadge.background': p.accent,
    'activityBarBadge.foreground': p.onAccent,
    'badge.background': dark ? p.strongLine : p.line,
    'badge.foreground': p.strongFg,

    // Side bar
    'sideBar.background': p.chrome,
    'sideBar.foreground': p.fg,
    'sideBar.border': p.line,
    'sideBarTitle.foreground': p.strongFg,
    'sideBarSectionHeader.background': p.chrome,
    'sideBarSectionHeader.foreground': p.strongFg,
    'sideBarSectionHeader.border': p.line,

    // Lists and trees
    'list.hoverBackground': p.hover,
    'list.activeSelectionBackground': p.listActive,
    'list.activeSelectionForeground': p.strongFg,
    'list.activeSelectionIconForeground': p.strongFg,
    'list.inactiveSelectionBackground': p.selectionInactive,
    'list.inactiveSelectionForeground': p.strongFg,
    'list.focusOutline': p.accent,
    'list.focusAndSelectionOutline': p.accent,
    'list.highlightForeground': p.accent,
    'list.focusHighlightForeground': p.accent,
    'list.dropBackground': p.selection,
    'list.errorForeground': p.error,
    'list.warningForeground': p.warning,
    'tree.indentGuidesStroke': p.strongLine,

    // Editor groups and tabs: a red hairline tops the active tab
    'editorGroup.border': p.line,
    'editorGroupHeader.tabsBackground': p.chrome,
    'editorGroupHeader.tabsBorder': p.line,
    'editorGroupHeader.noTabsBackground': p.editor,
    'tab.activeBackground': p.editor,
    'tab.activeForeground': p.strongFg,
    'tab.activeBorder': p.editor,
    'tab.activeBorderTop': p.accent,
    'tab.selectedBackground': p.editor,
    'tab.selectedForeground': p.strongFg,
    'tab.selectedBorderTop': p.accent,
    'tab.inactiveBackground': p.chrome,
    'tab.inactiveForeground': p.mutedFg,
    'tab.hoverBackground': p.editor,
    'tab.unfocusedHoverBackground': p.chrome,
    'tab.unfocusedActiveBorder': p.editor,
    'tab.unfocusedActiveBorderTop': p.strongLine,
    'tab.border': p.line,
    'tab.lastPinnedBorder': p.strongLine,

    // Editor
    'editor.background': p.editor,
    'editor.foreground': p.fg,
    'editorLineNumber.foreground': p.faint,
    'editorLineNumber.activeForeground': p.strongFg,
    'editorCursor.foreground': p.accent,
    'editor.selectionBackground': p.selection,
    'editor.inactiveSelectionBackground': p.selectionInactive,
    'editor.selectionHighlightBackground': p.selectionInactive,
    'editor.wordHighlightBackground': p.wordHighlight,
    'editor.wordHighlightStrongBackground': p.selectionInactive,
    'editor.findMatchBackground': p.findMatch,
    'editor.findMatchHighlightBackground': p.findMatchOther,
    'editor.lineHighlightBackground': dark ? '#F4EFE408' : '#211F1C08',
    'editor.lineHighlightBorder': '#00000000',
    'editor.rangeHighlightBackground': p.findMatchOther,
    'editorBracketMatch.background': p.selectionInactive,
    'editorBracketMatch.border': p.strongLine,
    'editorWhitespace.foreground': p.strongLine,
    'editorIndentGuide.background1': p.line,
    'editorIndentGuide.activeBackground1': p.faint,
    'editorRuler.foreground': p.line,
    'editorLink.activeForeground': p.link,
    'editorError.foreground': p.error,
    'editorWarning.foreground': p.warning,
    'editorInfo.foreground': p.info,
    'editorOverviewRuler.border': p.line,
    'editorGutter.addedBackground': p.added,
    'editorGutter.modifiedBackground': p.modified,
    'editorGutter.deletedBackground': p.error,
    'editorBracketHighlight.foreground1': p.syntax.number,
    'editorBracketHighlight.foreground2': p.syntax.type,
    'editorBracketHighlight.foreground3': p.syntax.function,
    'editorWidget.background': p.elevated,
    'editorWidget.foreground': p.fg,
    'editorWidget.border': p.line,
    'editorSuggestWidget.background': p.elevated,
    'editorSuggestWidget.border': p.line,
    'editorSuggestWidget.foreground': p.fg,
    'editorSuggestWidget.selectedBackground': p.listActive,
    'editorSuggestWidget.selectedForeground': p.strongFg,
    'editorSuggestWidget.highlightForeground': p.accent,
    'editorSuggestWidget.focusHighlightForeground': p.accent,
    'editorHoverWidget.background': p.elevated,
    'editorHoverWidget.border': p.line,
    'peekView.border': p.accent,
    'peekViewEditor.background': p.editor,
    'peekViewResult.background': p.chrome,
    'peekViewTitle.background': p.chrome,
    'peekViewEditor.matchHighlightBackground': p.findMatch,
    'peekViewResult.matchHighlightBackground': p.findMatch,
    'diffEditor.insertedTextBackground': dark ? '#8FA86626' : '#5E7A3A22',
    'diffEditor.removedTextBackground': dark ? '#F08A7E26' : '#B3261E1C',
    'diffEditor.unchangedRegionBackground': p.chrome,
    'scrollbar.shadow': p.shadow,
    'scrollbarSlider.background': dark ? '#F4EFE41F' : '#211F1C1F',
    'scrollbarSlider.hoverBackground': dark ? '#F4EFE433' : '#211F1C33',
    'scrollbarSlider.activeBackground': dark ? '#F4EFE44D' : '#211F1C4D',

    // Panel
    'panel.background': p.chrome,
    'panel.border': p.line,
    'panelTitle.activeBorder': p.accent,
    'panelTitle.activeForeground': p.strongFg,
    'panelTitle.inactiveForeground': p.mutedFg,
    'panelInput.border': p.line,
    'panelSection.border': p.line,

    // Status bar: quiet, the same shade as the chrome
    'statusBar.background': p.chrome,
    'statusBar.foreground': p.fg,
    'statusBar.border': p.line,
    'statusBar.focusBorder': p.accent,
    'statusBar.noFolderBackground': p.chrome,
    'statusBar.debuggingBackground': p.accent,
    'statusBar.debuggingForeground': p.onAccent,
    'statusBar.inactiveBackground': p.chrome,
    'statusBarItem.hoverBackground': p.hover,
    'statusBarItem.hoverForeground': p.strongFg,
    'statusBarItem.compactHoverBackground': p.hover,
    'statusBarItem.focusBorder': p.accent,
    'statusBarItem.prominentBackground': p.hover,
    'statusBarItem.remoteBackground': p.chrome,
    'statusBarItem.remoteForeground': p.fg,
    'statusBarItem.errorBackground': p.accent,
    'statusBarItem.errorForeground': p.onAccent,

    // Buttons: the primary button is the one red control
    'button.background': p.accent,
    'button.foreground': p.onAccent,
    'button.hoverBackground': p.accentHover,
    'button.border': '#00000000',
    'button.separator': '#FBF8F166',
    'button.secondaryBackground': p.elevated,
    'button.secondaryForeground': p.strongFg,
    'button.secondaryHoverBackground': p.hover,

    // Inputs
    'input.background': p.elevated,
    'input.foreground': p.strongFg,
    'input.border': p.line,
    'input.placeholderForeground': p.mutedFg,
    'inputOption.activeBackground': p.selectionInactive,
    'inputOption.activeBorder': p.accent,
    'inputOption.activeForeground': p.strongFg,
    'inputValidation.errorBackground': p.elevated,
    'inputValidation.errorBorder': p.error,
    'inputValidation.warningBackground': p.elevated,
    'inputValidation.warningBorder': p.warning,
    'inputValidation.infoBackground': p.elevated,
    'inputValidation.infoBorder': p.info,
    'dropdown.background': p.elevated,
    'dropdown.listBackground': p.elevated,
    'dropdown.foreground': p.strongFg,
    'dropdown.border': p.line,
    'checkbox.background': p.elevated,
    'checkbox.border': p.strongLine,
    'checkbox.foreground': p.strongFg,
    'keybindingLabel.foreground': p.strongFg,
    'keybindingLabel.background': p.hover,
    'keybindingLabel.border': p.line,
    'keybindingLabel.bottomBorder': p.strongLine,

    // Menus, quick input, notifications
    'menu.background': p.elevated,
    'menu.foreground': p.fg,
    'menu.border': p.line,
    'menu.selectionBackground': p.listActive,
    'menu.selectionForeground': p.strongFg,
    'menu.separatorBackground': p.line,
    'quickInput.background': p.elevated,
    'quickInput.foreground': p.fg,
    'quickInputList.focusBackground': p.listActive,
    'quickInputList.focusForeground': p.strongFg,
    'quickInputList.focusIconForeground': p.strongFg,
    'quickInputTitle.background': p.chrome,
    'pickerGroup.border': p.line,
    'pickerGroup.foreground': p.accent,
    'notifications.background': p.elevated,
    'notifications.foreground': p.fg,
    'notifications.border': p.line,
    'notificationCenterHeader.background': p.chrome,
    'notificationCenterHeader.foreground': p.strongFg,
    'notificationsErrorIcon.foreground': p.error,
    'notificationsWarningIcon.foreground': p.warning,
    'notificationsInfoIcon.foreground': p.info,
    'notificationLink.foreground': p.link,

    // Settings editor
    'settings.headerForeground': p.strongFg,
    'settings.modifiedItemIndicator': p.accent,
    'settings.dropdownBackground': p.elevated,
    'settings.dropdownBorder': p.line,
    'settings.textInputBorder': p.line,
    'settings.numberInputBorder': p.line,
    'settings.checkboxBorder': p.strongLine,
    'settings.focusedRowBackground': p.hover,
    'settings.rowHoverBackground': p.hover,

    // Terminal-style ANSI colours (used by output views), from the syntax palette
    'terminal.foreground': p.fg,
    'terminalCursor.foreground': p.accent,
    'terminal.ansiBlack': dark ? '#1A1816' : BRAND.ink,
    'terminal.ansiRed': p.error,
    'terminal.ansiGreen': p.added,
    'terminal.ansiYellow': p.syntax.number,
    'terminal.ansiBlue': p.syntax.function,
    'terminal.ansiMagenta': p.syntax.type,
    'terminal.ansiCyan': p.info,
    'terminal.ansiWhite': dark ? p.fg : BRAND.stone,

    // Charts, from the syntax palette so series stay on brand
    'charts.foreground': p.fg,
    'charts.lines': p.line,
    'charts.red': p.error,
    'charts.blue': p.syntax.function,
    'charts.yellow': p.syntax.number,
    'charts.orange': p.syntax.parameter,
    'charts.green': p.added,
    'charts.purple': p.syntax.type,

    // Keys whose VS Code defaults are blue: brought onto the palette
    'editor.hoverHighlightBackground': p.selectionInactive,
    'editor.snippetTabstopHighlightBackground': p.findMatchOther,
    'editor.snippetFinalTabstopHighlightBorder': p.strongLine,
    'editorLightBulbAutoFix.foreground': p.syntax.number,
    'editorOverviewRuler.incomingContentForeground': p.syntax.function,
    'merge.incomingContentBackground': dark ? '#8FBAC626' : '#2F5D6B1F',
    'merge.incomingHeaderBackground': dark ? '#8FBAC655' : '#2F5D6B44',
    'editorGroup.dropBackground': dark ? '#C0473A2E' : '#C0473A22',
    'sideBar.dropBackground': dark ? '#C0473A2E' : '#C0473A22',
    'panelSection.dropBackground': dark ? '#C0473A2E' : '#C0473A22',
    'tab.activeModifiedBorder': p.accent,
    'tab.inactiveModifiedBorder': p.faint,
    'tab.unfocusedActiveModifiedBorder': p.faint,
    'tab.unfocusedInactiveModifiedBorder': p.strongLine,
    'chart.line': p.syntax.function,

    'welcomePage.tileBackground': p.elevated,
    'welcomePage.tileHoverBackground': p.hover,
    'welcomePage.tileBorder': p.line,
    'welcomePage.progress.foreground': p.accent,
  };
}

function tokenColors(s) {
  const rule = (name, scope, foreground, fontStyle) => ({
    name,
    scope,
    settings: fontStyle === undefined ? { foreground } : { foreground, fontStyle },
  });
  return [
    rule('Comments', ['comment', 'punctuation.definition.comment'], s.comment, 'italic'),
    rule('Strings', ['string', 'string.quoted'], s.string),
    rule('Numbers and constants', ['constant.numeric', 'constant', 'constant.language'], s.number),
    rule('Keywords and query operators', ['keyword', 'keyword.control', 'storage'], s.keyword),
    rule('Directives', ['keyword.control.directive', 'meta.preprocessor'], s.keyword),
    rule('Operators', ['keyword.operator'], s.variable),
    rule('Functions', ['entity.name.function', 'support.function'], s.function),
    rule('Types', ['storage.type', 'support.type'], s.type),
    rule('Tables and classes', ['entity.name.type', 'support.class', 'entity.name.class'], s.type),
    rule('Parameters', ['variable.parameter'], s.parameter),
    rule('Variables and columns', ['variable', 'variable.other.property'], s.variable),
    rule('Invalid', ['invalid'], s.keyword),
    rule('Markup headings', ['markup.heading', 'entity.name.section'], s.keyword),
    rule('Markup bold', ['markup.bold'], s.variable, 'bold'),
    rule('Markup italic', ['markup.italic'], s.variable, 'italic'),
    rule('Markup code', ['markup.inline.raw', 'markup.fenced_code'], s.string),
    rule('Markup links', ['markup.underline.link'], s.function),
  ];
}

// WCAG 2 contrast ratio.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const failures = [];
for (const { id, label, uiTheme, p } of VARIANTS) {
  const checks = [
    ['text on editor', p.fg, p.editor],
    ['strong text on chrome', p.strongFg, p.chrome],
    ['text on chrome', p.fg, p.chrome],
    ['muted text on chrome', p.mutedFg, p.chrome],
    ['muted text on editor', p.mutedFg, p.editor],
    ['text on elevated', p.fg, p.elevated],
    ['button text', p.onAccent, p.accent],
    ['link on editor', p.link, p.editor],
    ['error on editor', p.error, p.editor],
    ...Object.entries(p.syntax).map(([name, color]) => [`syntax ${name}`, color, p.editor]),
  ];
  for (const [what, fg, bg] of checks) {
    const ratio = contrast(fg, bg);
    if (ratio < 4.5) failures.push(`${label}: ${what} ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
  }
  const theme = {
    $comment:
      'Generated by scripts/build-raml-themes.mjs from the Raml brand palette. Do not edit by hand.',
    id,
    label,
    uiTheme,
    colors: colors(p, uiTheme === 'vs-dark'),
    tokenColors: tokenColors(p.syntax),
  };
  writeFileSync(path.join(OUT_DIR, `${id}.json`), `${JSON.stringify(theme, null, 2)}\n`);
}
if (failures.length > 0) {
  console.error(`Contrast below WCAG AA (4.5:1):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`Wrote ${VARIANTS.map((v) => v.id).join(', ')} to ${OUT_DIR}`);
