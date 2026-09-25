import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * An extension's UI (spec 07): a sandboxed iframe (`allow-scripts`, no same-origin) from
 * `rkql-ext://<extension id>/…`, which has no network. The workbench talks to it only with
 * `postMessage`, and injects the theme's colours as CSS variables.
 */
export function themeVariables(): Record<string, string> {
  const out: Record<string, string> = {};
  const style = document.documentElement.style;
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if (name.startsWith('--vscode-')) out[name] = style.getPropertyValue(name);
  }
  return out;
}

export function ExtensionFrame({
  extensionId,
  path,
  title,
  onReady,
  onMessage,
}: {
  extensionId: string;
  path: string;
  title: string;
  /** The frame loaded: post its first message. */
  onReady: (post: (message: unknown) => void) => void;
  onMessage?: (message: unknown) => void;
}): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  const handlers = useRef({ onReady, onMessage });
  useLayoutEffect(() => {
    handlers.current = { onReady, onMessage };
  });

  useEffect(() => {
    const listener = (event: MessageEvent): void => {
      // Only messages from this frame (its origin is opaque, so compare the window).
      if (event.source !== frame.current?.contentWindow) return;
      handlers.current.onMessage?.(event.data);
    };
    window.addEventListener('message', listener);
    return () => {
      window.removeEventListener('message', listener);
    };
  }, []);

  return (
    <iframe
      ref={frame}
      className="extension-frame"
      title={title}
      sandbox="allow-scripts"
      src={`rkql-ext://${extensionId}/${path}`}
      onLoad={() => {
        const target = frame.current?.contentWindow;
        if (target === null || target === undefined) return;
        const post = (message: unknown): void => {
          // The sandboxed frame has an opaque origin: "*" is the only target that reaches it.
          target.postMessage(message, '*');
        };
        post({ type: 'theme', variables: themeVariables() });
        handlers.current.onReady(post);
      }}
    />
  );
}
