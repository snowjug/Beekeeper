/** IPC channel allow-lists of Capture Studio and pinned screenshots (zod-free). */
import type { WindowRole } from '../../windows';

type Roles = readonly WindowRole[];

export const STUDIO_INVOKE = {
  /** Start a capture of the display under the cursor (the Studio opens when it succeeds). */
  'capture:start': ['assistant', 'settings', 'studio'],

  'studio:getSession': ['studio'],
  'studio:ready': ['studio'],
  /** The user is working (or has a menu/editor open): restarts or pauses the auto-dismiss timer. */
  'studio:activity': ['studio'],
  'studio:copy': ['studio'],
  /** Text found by Photo assist; the Studio window has no generic clipboard or browser access. */
  'studio:copyText': ['studio'],
  'studio:searchText': ['studio'],
  'studio:save': ['studio'],
  'studio:pin': ['studio'],
  'studio:wallpaper': ['studio'],
  'studio:share': ['studio'],
  'studio:assist': ['studio'],
  'studio:delete': ['studio'],
  'studio:openFolder': ['studio'],
  'studio:close': ['studio'],

  'pin:getInfo': ['pin'],
  'pin:action': ['pin'],
} as const satisfies Record<string, Roles>;

export const STUDIO_EVENTS = {
  'studio:session': ['studio'],
  'studio:cancel': ['studio'],
  'pin:update': ['pin'],
} as const satisfies Record<string, Roles>;
