import { parseAccelerator } from '@shared/hotkeys';

const KEY_LABELS: Record<string, string> = {
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: 'Del',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Plus: '+',
  Minus: '−',
};

/** "Ctrl+Shift+Space" -> ["Ctrl", "Shift", "Space"]; arrows and long names get short cap labels. */
export function keyCapsFor(accelerator: string): string[] {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) {
    return accelerator
      .split('+')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  return [...parsed.modifiers, parsed.key].map(
    (key) => (Object.hasOwn(KEY_LABELS, key) ? KEY_LABELS[key] : undefined) ?? key,
  );
}

/** Spoken form of a shortcut: "Ctrl + Shift + Space". */
export function describeShortcut(accelerator: string): string {
  return keyCapsFor(accelerator).join(' + ');
}
