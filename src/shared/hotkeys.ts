/**
 * Accelerator helpers shared by the main process (registration) and the settings UI
 * (recording, conflict messages). Accelerators are stored in a friendly form such as
 * "Ctrl+Shift+Space" and converted to Electron's syntax when registering.
 */

/** Own-property lookup, so words such as "constructor" are not mistaken for keys. */
function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Win'] as const;
export type Modifier = (typeof MODIFIER_ORDER)[number];

const MODIFIER_ALIASES: Record<string, Modifier> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  win: 'Win',
  windows: 'Win',
  super: 'Win',
  meta: 'Win',
  cmd: 'Win',
};

const NAMED_KEYS: Record<string, string> = {
  space: 'Space',
  spacebar: 'Space',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  plus: 'Plus',
  minus: 'Minus',
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  esc: 'Escape',
  escape: 'Escape',
};

export interface ParsedAccelerator {
  modifiers: Modifier[];
  key: string;
}

function normalizeKey(raw: string): string | null {
  const lower = raw.toLowerCase();
  const named = lookup(NAMED_KEYS, lower);
  if (named) return named;
  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower.toUpperCase();
  if (/^[a-z0-9]$/.test(lower)) return lower.toUpperCase();
  if (raw.length === 1 && /[,./\\;'`[\]=-]/.test(raw)) return raw;
  return null;
}

/** Parses "ctrl+shift+space" style strings. Requires at least one modifier and exactly one key. */
export function parseAccelerator(input: string): ParsedAccelerator | null {
  const parts = input.split('+').map((part) => part.trim());
  if (parts.length < 2 || parts.some((part) => part.length === 0)) return null;

  const modifiers = new Set<Modifier>();
  let key: string | null = null;
  for (const part of parts) {
    const modifier = lookup(MODIFIER_ALIASES, part.toLowerCase());
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    if (key !== null) return null;
    key = normalizeKey(part);
    if (key === null) return null;
  }
  if (key === null || modifiers.size === 0) return null;
  return { modifiers: MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key };
}

/** Canonical display form: modifiers in a fixed order then the key ("Ctrl+Shift+Space"). */
export function formatAccelerator(parsed: ParsedAccelerator): string {
  return [...parsed.modifiers, parsed.key].join('+');
}

export function normalizeAccelerator(input: string): string | null {
  const parsed = parseAccelerator(input);
  return parsed ? formatAccelerator(parsed) : null;
}

/** Electron's accelerator syntax ("Control+Shift+Space"). */
export function toElectronAccelerator(input: string): string | null {
  const parsed = parseAccelerator(input);
  if (!parsed) return null;
  const modifiers = parsed.modifiers.map((modifier) =>
    modifier === 'Ctrl' ? 'Control' : modifier === 'Win' ? 'Super' : modifier,
  );
  return [...modifiers, parsed.key].join('+');
}

/** Keys that must never be used on their own with only Shift (they would break typing). */
export function isTypingCombo(parsed: ParsedAccelerator): boolean {
  const onlyShift = parsed.modifiers.length === 1 && parsed.modifiers[0] === 'Shift';
  return onlyShift && /^[A-Z0-9]$/.test(parsed.key);
}

const MODIFIER_KEY_NAMES: Record<Modifier, string> = {
  Ctrl: 'Control',
  Alt: 'Alt',
  Shift: 'Shift',
  Win: 'Meta',
};

const NAMED_KEY_CODES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Escape: 'Escape',
  Plus: 'Equal',
  Minus: 'Minus',
};

/** KeyboardEvent.code for the main key of an accelerator (letters, digits, F-keys, named keys). */
export function keyCodeFor(key: string): string | null {
  if (/^[A-Z]$/.test(key)) return `Key${key}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(key)) return key;
  return lookup(NAMED_KEY_CODES, key) ?? null;
}

const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
};

const MODIFIER_CODE = /^(Control|Shift|Alt|Meta|OS)(Left|Right)$/;

export interface CapturedKeys {
  modifiers: Modifier[];
  /** Main key in accelerator spelling, or null while only modifiers are held (or the key is unsupported). */
  key: string | null;
}

/** Reads a keydown event into accelerator parts (for the "press a shortcut" recorder). */
export function captureAccelerator(event: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): CapturedKeys {
  const held: Record<Modifier, boolean> = {
    Ctrl: event.ctrlKey,
    Alt: event.altKey,
    Shift: event.shiftKey,
    Win: event.metaKey,
  };
  const modifiers = MODIFIER_ORDER.filter((modifier) => held[modifier]);
  if (MODIFIER_CODE.test(event.code)) return { modifiers, key: null };

  let key: string | null = null;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(event.code)) key = event.code;
  else key = lookup(CODE_TO_KEY, event.code) ?? null;
  return { modifiers, key };
}

/**
 * True when a keyup event releases the hotkey: either its main key or one of its modifiers.
 * Used for push-to-talk, where letting go of the hotkey sends the utterance.
 */
export function releasesAccelerator(
  event: { code: string; key: string },
  parsed: ParsedAccelerator,
): boolean {
  if (parsed.modifiers.some((modifier) => MODIFIER_KEY_NAMES[modifier] === event.key)) return true;
  const code = keyCodeFor(parsed.key);
  return code !== null && event.code === code;
}

const ALTERNATIVES: readonly string[] = [
  'Ctrl+Alt+Space',
  'Ctrl+Shift+B',
  'Alt+Shift+Space',
  'Ctrl+Alt+B',
  'Ctrl+Shift+F9',
  'Ctrl+Alt+F10',
];

/** First alternative combination that is not already taken (case-insensitive, normalised). */
export function suggestAlternative(taken: readonly string[]): string | null {
  const takenSet = new Set(taken.map((entry) => normalizeAccelerator(entry) ?? entry));
  return ALTERNATIVES.find((candidate) => !takenSet.has(candidate)) ?? null;
}
