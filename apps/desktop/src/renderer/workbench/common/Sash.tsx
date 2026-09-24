import { useCallback, useRef, useState } from 'react';

/**
 * A draggable divider between parts (VS Code's "sash"): 4px hit area, highlighted with
 * `sash.hoverBorder` while hovered or dragged. Reports the drag delta from the start position.
 */
export function Sash({
  orientation,
  onDragStart,
  onDrag,
  onReset,
  label,
}: {
  orientation: 'vertical' | 'horizontal';
  onDragStart: () => void;
  onDrag: (delta: number) => void;
  /** Double click, like VS Code's "reset size". */
  onReset?: () => void;
  label: string;
}): React.JSX.Element {
  const [active, setActive] = useState(false);
  const start = useRef(0);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = orientation === 'vertical' ? event.clientX : event.clientY;
      setActive(true);
      onDragStart();
    },
    [onDragStart, orientation],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!active) return;
      const position = orientation === 'vertical' ? event.clientX : event.clientY;
      onDrag(position - start.current);
    },
    [active, onDrag, orientation],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setActive(false);
  }, []);

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      className={`sash sash-${orientation}${active ? ' active' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onReset}
    />
  );
}
