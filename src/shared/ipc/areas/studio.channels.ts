/** IPC channel allow-lists of Capture Studio and pinned screenshots (zod-free). */
import type { WindowRole } from '../../windows';

type Roles = readonly WindowRole[];

export const STUDIO_INVOKE = {
  /** Start a capture of the display under the cursor (the Studio opens when it succeeds). */
  'capture:start': ['assistant', 'settings'],

  'studio:getSession': ['studio'],
  'studio:ready': ['studio'],
  'studio:copy': ['studio'],
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
