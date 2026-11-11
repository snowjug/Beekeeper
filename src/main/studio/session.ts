import type { StudioSource } from '@shared/ipc/types';
import type { Settings } from '@shared/settings';
import type { DisplayInfo } from './platform';

/** The settings the Studio reads, read again for every capture. */
export interface StudioSettings {
  capture: Settings['capture'];
  /** Azure OpenAI is configured. */
  aiAvailable: boolean;
}

/** An error whose message is written for the user and may be shown as it is. */
export class StudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudioError';
  }
}

/** Everything Capture Studio keeps in memory about the screenshot that is open. */
export interface SessionRecord {
  id: string;
  /** The captured image as PNG, at native resolution. */
  png: Buffer;
  width: number;
  height: number;
  scaleFactor: number;
  source: StudioSource;
  createdAt: number;
  display: DisplayInfo;
  /** File of the capture itself: saved automatically, or by the command that took the screenshot. */
  originalPath: string | null;
  /** File of the edited version, created the first time the user saves or shares an edit. */
  editedPath: string | null;
  /** The session was sent to the page (before that, `studio:getSession` has nothing to return). */
  published: boolean;
}

/** What the actions need from the controller that owns the session. */
export interface SessionAccess {
  /** The open session, or a StudioError when `sessionId` is not it any more. */
  require(sessionId: string): SessionRecord;
  /** The user did something: restarts the auto-dismiss timer. */
  activity(): void;
}
