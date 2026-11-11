import type { MicErrorKind } from '@renderer/lib/voice/mic';

/** Where the microphone test is. `heard` keeps the mic open for a moment, then it is released. */
export type MicTestState =
  | { status: 'idle' | 'requesting' | 'listening' | 'heard' | 'silent' }
  | { status: 'error'; kind: MicErrorKind };
