import { MicError, toMicError, type MicSession } from '@renderer/lib/voice/mic';

export type OpenMic = (deviceId: string) => Promise<MicSession>;

export function asMicError(error: unknown): MicError {
  return error instanceof MicError ? error : toMicError(error);
}

async function openOnce(open: OpenMic, deviceId: string): Promise<MicSession> {
  try {
    return await open(deviceId);
  } catch (error) {
    throw asMicError(error);
  }
}

/**
 * Opens the saved microphone; when that device has been unplugged since, falls back to the system
 * default once instead of reporting "no microphone". Always rejects with a `MicError`.
 */
export async function openWithFallback(open: OpenMic, deviceId: string): Promise<MicSession> {
  try {
    return await openOnce(open, deviceId);
  } catch (error) {
    const failure = asMicError(error);
    if (failure.kind === 'no-device' && deviceId !== 'default') return openOnce(open, 'default');
    throw failure;
  }
}
