import type { Settings, SettingsPatch, SettingsView } from '@shared/settings';

/** Settings sections a patch can touch (hotkeys have their own conflict-checked channel). */
export type PatchSection = keyof SettingsPatch;

const PATCH_SECTIONS = [
  'general',
  'voice',
  'circle',
  'capture',
  'dictation',
  'ai',
  'privacy',
  'updates',
  'onboarding',
] as const satisfies readonly PatchSection[];

function assignPatch<S extends PatchSection>(
  target: SettingsPatch,
  section: S,
  values: Partial<Settings[S]>,
): void {
  target[section] = values;
}

function assignSection<S extends PatchSection>(
  target: SettingsView,
  section: S,
  values: Partial<Settings[S]>,
): void {
  target[section] = { ...target[section], ...values };
}

/** The smallest possible patch: exactly one key of one section. */
export function patchOf<S extends PatchSection, K extends keyof Settings[S]>(
  section: S,
  key: K,
  value: Settings[S][K],
): SettingsPatch {
  const values: Partial<Settings[S]> = {};
  values[key] = value;
  const patch: SettingsPatch = {};
  assignPatch(patch, section, values);
  return patch;
}

/**
 * One patch for several keys of a section, leaving out keys that already hold the value (so a
 * choice that changes two settings at once still only sends what really changes). Null when
 * nothing changes.
 */
export function changesOf<S extends PatchSection>(
  view: SettingsView,
  section: S,
  values: Partial<Settings[S]>,
): SettingsPatch | null {
  const current: Record<string, unknown> = view[section];
  const changed: Partial<Settings[S]> = {};
  for (const key of Object.keys(values) as Array<keyof Settings[S] & string>) {
    const value = values[key];
    if (value !== undefined && !deepEqual(current[key], value)) changed[key] = value;
  }
  if (Object.keys(changed).length === 0) return null;
  const patch: SettingsPatch = {};
  assignPatch(patch, section, changed);
  return patch;
}

/** Returns a copy of `view` with the patch applied (sections are one level deep, like in main). */
export function applyPatch(view: SettingsView, patch: SettingsPatch): SettingsView {
  const next: SettingsView = { ...view };
  for (const section of PATCH_SECTIONS) {
    const values = patch[section];
    if (values) assignSection(next, section, values);
  }
  return next;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
  );
}

/** True when every value in the patch already matches `view`: nothing needs to be sent. */
export function isNoopPatch(view: SettingsView, patch: SettingsPatch): boolean {
  for (const section of PATCH_SECTIONS) {
    const values = patch[section];
    if (!values) continue;
    const current: Record<string, unknown> = view[section];
    for (const [key, value] of Object.entries(values)) {
      if (!deepEqual(current[key], value)) return false;
    }
  }
  return true;
}
