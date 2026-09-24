import type { MatchRange } from '../../platform/fuzzy';

/** Text with fuzzy-match ranges highlighted, like VS Code's quick pick. */
export function HighlightedLabel({
  text,
  highlights = [],
  className,
}: {
  text: string;
  highlights?: readonly MatchRange[] | undefined;
  className?: string;
}): React.JSX.Element {
  const parts: React.JSX.Element[] = [];
  let pos = 0;
  highlights.forEach((range, index) => {
    if (range.start > pos)
      parts.push(<span key={`t${String(index)}`}>{text.slice(pos, range.start)}</span>);
    parts.push(
      <span key={`h${String(index)}`} className="highlight">
        {text.slice(range.start, range.end)}
      </span>,
    );
    pos = range.end;
  });
  if (pos < text.length) parts.push(<span key="rest">{text.slice(pos)}</span>);
  return <span className={className}>{parts}</span>;
}
