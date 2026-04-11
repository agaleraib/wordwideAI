/**
 * Generic SSE hook for the playground. Subscribes to a typed event union and
 * dispatches each event into a caller-provided handler.
 *
 * Written from scratch — the archived `packages/web/`'s useSSE was specific
 * to the content pipeline and intentionally not reused here.
 */

import { useEffect, useRef } from "react";

interface SSEHandlers<T extends { type: string }> {
  onEvent: (event: T) => void;
  onError?: (err: Event) => void;
}

/**
 * Open an EventSource on the given URL whenever it changes.
 * Pass `url = null` to keep the connection closed.
 *
 * Each known event type from the union must be subscribed individually
 * because EventSource dispatches by `event:` name (not by the default
 * `message` event when a name is set).
 */
export function useSSE<T extends { type: string }>(
  url: string | null,
  eventTypes: ReadonlyArray<T["type"]>,
  handlers: SSEHandlers<T>,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!url) return;

    const source = new EventSource(url);

    const listeners: Array<{ name: string; fn: (e: MessageEvent) => void }> = [];

    for (const name of eventTypes) {
      const fn = (e: MessageEvent): void => {
        try {
          const parsed = JSON.parse(e.data) as T;
          handlersRef.current.onEvent(parsed);
        } catch (err) {
          // Surface parse errors to the console — should never happen if the
          // backend stays in sync with the frontend type union.
          // eslint-disable-next-line no-console
          console.error("[useSSE] failed to parse event", name, err);
        }
      };
      source.addEventListener(name, fn);
      listeners.push({ name, fn });
    }

    source.onerror = (err) => {
      handlersRef.current.onError?.(err);
    };

    return () => {
      for (const { name, fn } of listeners) {
        source.removeEventListener(name, fn);
      }
      source.close();
    };
  }, [url, eventTypes]);
}
