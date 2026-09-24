import type { ReactNode } from 'react';

export function Codicon({
  name,
  className,
  title,
}: {
  name: string;
  className?: string;
  title?: string;
}): React.JSX.Element {
  return (
    <span
      className={`codicon codicon-${name}${className === undefined ? '' : ` ${className}`}`}
      aria-hidden={title === undefined}
      title={title}
    />
  );
}

/** Render text with VS Code's `$(icon-name)` syntax, e.g. `$(beaker) Demo`. */
export function LabelWithIcons({ text }: { text: string }): React.JSX.Element {
  const parts: ReactNode[] = [];
  const pattern = /\$\(([a-z0-9-]+(?:~spin)?)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const [name = '', modifier] = (match[1] ?? '').split('~');
    parts.push(
      <Codicon
        key={match.index}
        name={name}
        className={modifier === 'spin' ? 'codicon-modifier-spin' : undefined}
      />,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
