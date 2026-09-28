import type { UiRequest } from '../../shared/extensions/models';

/**
 * Requests from main to the workbench that need the user or the editor (spec 07): messages,
 * quick picks, input boxes, permission prompts. The workbench answers each by id; when there is
 * no window, or it closes, requests resolve to `undefined` (as if cancelled).
 */
export class UiBroker {
  private nextId = 1;
  private readonly pending = new Map<number, (value: unknown) => void>();

  /** `send` returns false when there is no window to ask. */
  constructor(
    private readonly send: (event: { requestId: number; request: UiRequest }) => boolean,
  ) {}

  request(request: UiRequest): Promise<unknown> {
    const requestId = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve);
      if (!this.send({ requestId, request })) this.respond(requestId, undefined);
    });
  }

  respond(requestId: number, value: unknown): void {
    const resolve = this.pending.get(requestId);
    this.pending.delete(requestId);
    resolve?.(value);
  }

  /** The window went away: nobody will answer. */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.respond(id, undefined);
  }
}
