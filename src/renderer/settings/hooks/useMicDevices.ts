import { useCallback, useEffect, useRef, useState } from 'react';
import { toMicError, type MicError } from '@renderer/lib/voice/mic';
import type { DeviceLike } from '../lib/devices';

export interface MicDevices {
  devices: readonly DeviceLike[];
  /** True after the first enumeration finished (successfully or not). */
  loaded: boolean;
  supported: boolean;
  requesting: boolean;
  /** Why asking for microphone access failed, if it did. */
  permissionError: MicError | null;
  /** Briefly opens the microphone so Windows reveals device names, then releases it again. */
  requestNames: () => Promise<void>;
}

function canEnumerate(): boolean {
  return typeof navigator.mediaDevices?.enumerateDevices === 'function';
}

/** Lists audio inputs, refreshing whenever a device is plugged in or removed. */
export function useMicDevices(): MicDevices {
  const [devices, setDevices] = useState<readonly DeviceLike[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [permissionError, setPermissionError] = useState<MicError | null>(null);
  const alive = useRef(true);
  const supported = canEnumerate();

  const refresh = useCallback(async (): Promise<void> => {
    if (!supported) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      if (alive.current) {
        setDevices(list.map(({ deviceId, kind, label }) => ({ deviceId, kind, label })));
      }
    } catch {
      // An unreadable list is shown as "no microphones found".
    }
    if (alive.current) setLoaded(true);
  }, [supported]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    if (!supported) {
      return () => {
        alive.current = false;
      };
    }
    const media = navigator.mediaDevices;
    const onChange = (): void => void refresh();
    media.addEventListener('devicechange', onChange);
    return () => {
      alive.current = false;
      media.removeEventListener('devicechange', onChange);
    };
  }, [refresh, supported]);

  const requestNames = useCallback(async (): Promise<void> => {
    setRequesting(true);
    setPermissionError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      await refresh();
    } catch (error) {
      if (alive.current) setPermissionError(toMicError(error));
    } finally {
      if (alive.current) setRequesting(false);
    }
  }, [refresh]);

  return { devices, loaded, supported, requesting, permissionError, requestNames };
}
