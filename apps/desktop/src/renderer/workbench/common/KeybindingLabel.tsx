/** Keycap-style keybinding, as shown in VS Code's command palette. */
export function KeybindingLabel({ label }: { label: string }): React.JSX.Element {
  // Split "Ctrl+Shift+P" / "⇧⌘P" / chords "⌘K ⌘S" into keycaps.
  const chords = label.split(' ');
  return (
    <span className="keybinding-label" aria-label={label}>
      {chords.map((chord, chordIndex) => {
        const keys = chord.includes('+') ? chord.split('+') : splitMacChord(chord);
        return (
          <span key={chordIndex} className="keybinding-chord">
            {keys.map((key, keyIndex) => (
              <kbd key={keyIndex} className="keybinding-key">
                {key}
              </kbd>
            ))}
          </span>
        );
      })}
    </span>
  );
}

/** "⇧⌘P" → ["⇧", "⌘", "P"]. */
function splitMacChord(chord: string): string[] {
  const keys: string[] = [];
  let rest = chord;
  while (rest.length > 0 && '⌃⌥⇧⌘'.includes(rest.charAt(0))) {
    keys.push(rest.charAt(0));
    rest = rest.slice(1);
  }
  if (rest.length > 0) keys.push(rest);
  return keys;
}
