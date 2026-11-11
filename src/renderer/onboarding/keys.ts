/** Elements that handle Enter themselves: the global "Enter = primary action" shortcut must not fire. */
const CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="link"]',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');

/** True when keyboard focus sits on (or inside) something interactive. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CONTROL_SELECTOR) !== null;
}

/** Enter without modifiers, not auto-repeating, and not already handled by a control. */
export function shouldRunPrimaryOnEnter(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' &&
    !event.repeat &&
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.metaKey &&
    !isInteractiveTarget(event.target)
  );
}
