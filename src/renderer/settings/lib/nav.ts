import { SETTINGS_PAGES } from '@shared/ipc/schemas';
import type { IconName } from '@renderer/components/Icon';

export type SettingsPage = (typeof SETTINGS_PAGES)[number];

export interface SectionMeta {
  id: SettingsPage;
  /** Short label in the left navigation. */
  label: string;
  /** Page heading. */
  title: string;
  description: string;
  icon: IconName;
}

const GENERAL: SectionMeta = {
  id: 'general',
  label: 'General',
  title: 'General',
  description: 'Startup, appearance and where your weather comes from.',
  icon: 'sliders',
};

export const SECTIONS: readonly SectionMeta[] = [
  GENERAL,
  {
    id: 'voice',
    label: 'Voice',
    title: 'Voice',
    description: 'Language, speech recognition, the assistant’s voice and the wake word.',
    icon: 'mic',
  },
  {
    id: 'hotkeys',
    label: 'Hotkeys',
    title: 'Hotkeys',
    description: 'Global shortcuts that work from any app.',
    icon: 'keyboard',
  },
  {
    id: 'circle',
    label: 'Circle to Search',
    title: 'Circle to Search',
    description: 'Circle, scribble or tap anything on your screen.',
    icon: 'circle',
  },
  {
    id: 'capture',
    label: 'Capture Studio',
    title: 'Capture Studio',
    description: 'Screenshots with a live preview, markup, pins and sharing.',
    icon: 'screenshot',
  },
  {
    id: 'dictation',
    label: 'Dictation',
    title: 'Dictation',
    description: 'Speak and Beekeeper types for you in any app.',
    icon: 'mic',
  },
  {
    id: 'ai',
    label: 'AI',
    title: 'AI (optional Azure)',
    description: 'Bring your own Azure keys for cloud speech and smarter answers.',
    icon: 'sparkle',
  },
  {
    id: 'privacy',
    label: 'Privacy',
    title: 'Privacy',
    description: 'You decide what stays on this PC.',
    icon: 'shield',
  },
  {
    id: 'updates',
    label: 'Updates',
    title: 'Updates',
    description: 'Keep Beekeeper current.',
    icon: 'refresh',
  },
  {
    id: 'about',
    label: 'About',
    title: 'About',
    description: 'Version, licenses and links.',
    icon: 'info',
  },
];

export const DEFAULT_SECTION: SettingsPage = 'general';

/** Id of the single tab panel; every tab controls it. */
export const PANEL_ID = 'settings-panel';

export function tabId(section: SettingsPage): string {
  return `settings-tab-${section}`;
}

export function isSettingsPage(value: unknown): value is SettingsPage {
  return typeof value === 'string' && (SETTINGS_PAGES as readonly string[]).includes(value);
}

/** Reads the initial section from a `?section=<id>` query string. */
export function parseSection(search: string): SettingsPage {
  const value = new URLSearchParams(search).get('section');
  return isSettingsPage(value) ? value : DEFAULT_SECTION;
}

export function sectionMeta(section: SettingsPage): SectionMeta {
  return SECTIONS.find((entry) => entry.id === section) ?? GENERAL;
}

/** Roving-focus target for an arrow/Home/End key press in the vertical tab list, or null. */
export function nextTabIndex(index: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowUp':
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
