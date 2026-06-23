/**
 * A tiny window-event bus for cross-cutting UI commands and transient toasts.
 *
 * Used to decouple the top bar / keyboard shortcuts from the dock and agent
 * input (e.g. ⌘K focuses Ask without threading callbacks through the tree),
 * and to surface agent-driven view changes as toasts no matter where focus is.
 */

export type UiCommand = 'focus-ask' | 'toggle-dock' | 'collapse-dock';

const CMD_EVENT = 'mito:cmd';
const TOAST_EVENT = 'mito:toast';

export function emitCommand(cmd: UiCommand): void {
  window.dispatchEvent(new CustomEvent<UiCommand>(CMD_EVENT, { detail: cmd }));
}

export function onCommand(cb: (cmd: UiCommand) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<UiCommand>).detail);
  window.addEventListener(CMD_EVENT, handler);
  return () => window.removeEventListener(CMD_EVENT, handler);
}

export interface ToastPayload {
  /** Short human label, e.g. "Coloured by Membrane Potential". */
  text: string;
  /** Icon hint so the toaster can pick an icon without coupling to lucide. */
  kind?: 'color' | 'filter' | 'cell' | 'reset' | 'grid' | 'size' | 'generic';
}

export function emitToast(payload: ToastPayload): void {
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }));
}

export function onToast(cb: (payload: ToastPayload) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<ToastPayload>).detail);
  window.addEventListener(TOAST_EVENT, handler);
  return () => window.removeEventListener(TOAST_EVENT, handler);
}
