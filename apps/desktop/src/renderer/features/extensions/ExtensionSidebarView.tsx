import { useEffect, useRef, useState } from 'react';

import { getBridge, unwrap } from '../../services/ipc';

import { ExtensionFrame } from './ExtensionFrame';
import { reportExtensionError } from './extensions-store';
import { onWebviewPost } from './webview-bus';

/**
 * A sidebar view contributed by an extension (spec 07, `contributes.views.sidebar`): its UI in
 * a sandboxed iframe, relayed to and from its worker through main (`ramlKql.webview`).
 */
export function ExtensionSidebarView({
  extensionId,
  viewId,
  ui,
  title,
}: {
  extensionId: string;
  viewId: string;
  ui: string;
  title: string;
}): React.JSX.Element {
  const post = useRef<((message: unknown) => void) | undefined>(undefined);
  const queue = useRef<unknown[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const stop = onWebviewPost(viewId, (message) => {
      if (post.current === undefined) queue.current.push(message);
      else post.current({ type: 'message', message });
    });
    unwrap(getBridge().extensions.resolveView({ viewId })).catch((error: unknown) => {
      setFailed(true);
      reportExtensionError(error, `${title} could not start.`);
    });
    return stop;
  }, [viewId, title]);

  if (failed) return <p className="panel-empty">{title} could not start.</p>;
  return (
    <ExtensionFrame
      extensionId={extensionId}
      path={ui}
      title={title}
      onReady={(target) => {
        post.current = target;
        for (const message of queue.current.splice(0)) target({ type: 'message', message });
      }}
      onMessage={(message) => {
        void unwrap(
          getBridge().extensions.webviewMessage({ viewId, message: message as never }),
        ).catch(() => undefined);
      }}
    />
  );
}
