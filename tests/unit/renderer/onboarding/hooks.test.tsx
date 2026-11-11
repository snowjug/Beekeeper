import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SpeechState, VoiceModelState } from '@shared/ipc/types';
import { useAppearance } from '@renderer/onboarding/hooks/useAppearance';
import { useSettings, DEFAULT_VOICE_PREFS } from '@renderer/onboarding/hooks/useSettings';
import { useSpeechPacks } from '@renderer/onboarding/hooks/useSpeechPacks';
import { useVoiceModel } from '@renderer/onboarding/hooks/useVoiceModel';
import { BEST_PACKS } from '@renderer/onboarding/packFormat';
import {
  APP_INFO,
  createFakeBridge,
  modelState,
  readyPack,
  settingsView,
  speechState,
} from './testUtils';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every pending promise callback (and the state updates they trigger) run. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('useVoiceModel', () => {
  it('reads the status once and follows progress events', async () => {
    const fake = createFakeBridge();
    const { result, unmount } = renderHook(() => useVoiceModel(fake.bridge));
    expect(result.current.state).toBeNull();
    await flush();
    expect(result.current.state?.state).toBe('missing');
    expect(fake.inputsOf('voice:modelStatus')).toHaveLength(1);
    act(() =>
      fake.emit('voice:modelProgress', modelState({ state: 'downloading', receivedBytes: 7 })),
    );
    expect(result.current.state).toMatchObject({ state: 'downloading', receivedBytes: 7 });
    unmount();
    expect(fake.listenerCount('voice:modelProgress')).toBe(0);
  });

  it('prefers a progress event over an older status reply', async () => {
    const fake = createFakeBridge();
    const status = deferred<VoiceModelState>();
    fake.handle('voice:modelStatus', () => status.promise);
    const { result } = renderHook(() => useVoiceModel(fake.bridge));
    act(() => fake.emit('voice:modelProgress', modelState({ state: 'downloading' })));
    status.resolve(modelState({ state: 'missing' }));
    await flush();
    expect(result.current.state?.state).toBe('downloading');
  });

  it('shows the download as started at once and ignores a stale error in the reply', async () => {
    const fake = createFakeBridge();
    const failed = modelState({
      state: 'error',
      receivedBytes: 10,
      message: 'No internet connection',
    });
    fake.handle('voice:modelStatus', () => failed);
    const ensure = deferred<VoiceModelState>();
    fake.handle('voice:modelEnsure', () => ensure.promise);
    const { result } = renderHook(() => useVoiceModel(fake.bridge));
    await flush();
    expect(result.current.state?.state).toBe('error');

    act(() => result.current.start());
    expect(result.current.state).toMatchObject({ state: 'downloading', receivedBytes: 10 });
    expect(result.current.state?.message).toBeUndefined();
    ensure.resolve(failed);
    await flush();
    expect(result.current.state?.state).toBe('downloading');
    expect(result.current.error).toBeNull();
  });

  it('applies the reply of a download that is already complete', async () => {
    const fake = createFakeBridge();
    fake.handle('voice:modelEnsure', () => modelState({ state: 'ready' }));
    const { result } = renderHook(() => useVoiceModel(fake.bridge));
    await flush();
    act(() => result.current.start());
    await flush();
    expect(result.current.state?.state).toBe('ready');
  });

  it('puts the state back and reports a friendly error when starting fails', async () => {
    const fake = createFakeBridge();
    fake.handle('voice:modelEnsure', () => {
      throw new Error('ipc down');
    });
    const { result } = renderHook(() => useVoiceModel(fake.bridge));
    await flush();
    act(() => result.current.start());
    await flush();
    expect(result.current.state?.state).toBe('missing');
    expect(result.current.error).toBe('Couldn’t start the download. Please try again.');
    act(() => result.current.start());
    expect(result.current.error).toBeNull();
  });

  it('reports a status that cannot be read', async () => {
    const fake = createFakeBridge();
    fake.handle('voice:modelStatus', () => {
      throw new Error('ipc down');
    });
    const { result } = renderHook(() => useVoiceModel(fake.bridge));
    await flush();
    expect(result.current.state).toBeNull();
    expect(result.current.error).toBe('Couldn’t check the voice model right now.');
  });

  it('pauses: the reply is applied and the replayed cancellation does not become an error', async () => {
    const fake = createFakeBridge();
    const { result } = renderHook(() => useVoiceModel(fake.bridge));
    act(() =>
      fake.emit(
        'voice:modelProgress',
        modelState({ state: 'downloading', receivedBytes: 4_000_000 }),
      ),
    );
    act(() => result.current.pause());
    expect(result.current.paused).toBe(true);
    await flush();
    expect(result.current.state?.state).toBe('partial');
    act(() =>
      fake.emit(
        'voice:modelProgress',
        modelState({
          state: 'error',
          receivedBytes: 4_000_000,
          message: 'The download was cancelled — it will resume next time',
        }),
      ),
    );
    expect(result.current.state?.state).toBe('partial');
    act(() => result.current.start());
    expect(result.current.paused).toBe(false);
  });

  it('reports a pause that failed', async () => {
    const fake = createFakeBridge();
    fake.handle('voice:modelCancel', () => {
      throw new Error('ipc down');
    });
    const { result } = renderHook(() => useVoiceModel(fake.bridge));
    await flush();
    act(() => result.current.pause());
    await flush();
    expect(result.current.error).toBe('Couldn’t pause the download.');
  });
});

describe('useSpeechPacks', () => {
  it('reads the status once and follows speech:state events', async () => {
    const fake = createFakeBridge();
    const { result, unmount } = renderHook(() => useSpeechPacks(fake.bridge, BEST_PACKS));
    expect(result.current.state).toBeNull();
    await flush();
    expect(result.current.state?.packs['whisper-small'].state).toBe('missing');
    expect(fake.inputsOf('speech:status')).toHaveLength(1);
    act(() => fake.emit('speech:state', speechState({ 'supertonic-3': { state: 'downloading' } })));
    expect(result.current.state?.packs['supertonic-3'].state).toBe('downloading');
    unmount();
    expect(fake.listenerCount('speech:state')).toBe(0);
  });

  it('prefers a speech:state event over an older status reply', async () => {
    const fake = createFakeBridge();
    const status = deferred<SpeechState>();
    fake.handle('speech:status', () => status.promise);
    const { result } = renderHook(() => useSpeechPacks(fake.bridge, BEST_PACKS));
    act(() =>
      fake.emit('speech:state', speechState({ 'whisper-small': { state: 'downloading' } })),
    );
    status.resolve(speechState());
    await flush();
    expect(result.current.state?.packs['whisper-small'].state).toBe('downloading');
  });

  it('reports a status that cannot be read', async () => {
    const fake = createFakeBridge();
    fake.handle('speech:status', () => {
      throw new Error('ipc down');
    });
    const { result } = renderHook(() => useSpeechPacks(fake.bridge, BEST_PACKS));
    await flush();
    expect(result.current.state).toBeNull();
    expect(result.current.error).toBe('Couldn’t check the downloads right now.');
    expect(fake.inputsOf('app:log')).toHaveLength(1);
  });

  it('starts only what is missing, showing the downloads as started at once', async () => {
    const fake = createFakeBridge();
    fake.handle('speech:status', () => speechState({ 'supertonic-3': readyPack('supertonic-3') }));
    const { result } = renderHook(() => useSpeechPacks(fake.bridge, BEST_PACKS));
    await flush();
    act(() => result.current.start());
    expect(result.current.started).toBe(true);
    expect(result.current.state?.packs['whisper-small'].state).toBe('downloading');
    expect(result.current.state?.packs['supertonic-3'].state).toBe('ready');
    await flush();
    expect(fake.inputsOf('speech:ensurePack')).toEqual([{ pack: 'whisper-small' }]);
    expect(result.current.error).toBeNull();
  });

  it('ignores a stale error in the reply of a restarted download', async () => {
    const fake = createFakeBridge();
    const stale = () =>
      speechState({
        'whisper-small': { state: 'error', message: 'No internet connection' },
        'supertonic-3': readyPack('supertonic-3'),
      });
    fake.handle('speech:status', stale);
    fake.handle('speech:ensurePack', stale);
    const { result } = renderHook(() => useSpeechPacks(fake.bridge, BEST_PACKS));
    await flush();
    act(() => result.current.start());
    await flush();
    expect(fake.inputsOf('speech:ensurePack')).toEqual([{ pack: 'whisper-small' }]);
    expect(result.current.state?.packs['whisper-small'].state).toBe('downloading');
  });

  it('puts the state back and reports a friendly error when starting fails', async () => {
    const fake = createFakeBridge();
    fake.handle('speech:ensurePack', () => {
      throw new Error('speech is not available');
    });
    const { result } = renderHook(() => useSpeechPacks(fake.bridge, BEST_PACKS));
    await flush();
    act(() => result.current.start());
    await flush();
    expect(result.current.error).toBe('Couldn’t start the download. Please try again.');
    expect(result.current.started).toBe(false);
    expect(result.current.state?.packs['whisper-small'].state).toBe('missing');
    expect(result.current.state?.packs['supertonic-3'].state).toBe('missing');
  });

  it('pauses only the packs that are moving, and applies the reply', async () => {
    const fake = createFakeBridge();
    fake.handle('speech:status', () =>
      speechState({
        'whisper-small': { state: 'downloading', receivedBytes: 5 },
        'supertonic-3': readyPack('supertonic-3'),
      }),
    );
    fake.handle('speech:cancelPack', () =>
      speechState({
        'whisper-small': {
          state: 'error',
          receivedBytes: 5,
          message: 'The download was cancelled',
        },
        'supertonic-3': readyPack('supertonic-3'),
      }),
    );
    const { result } = renderHook(() => useSpeechPacks(fake.bridge, BEST_PACKS));
    await flush();
    act(() => result.current.pause());
    expect(result.current.paused).toBe(true);
    await flush();
    expect(fake.inputsOf('speech:cancelPack')).toEqual([{ pack: 'whisper-small' }]);
    expect(result.current.state?.packs['whisper-small'].state).toBe('error');
    expect(result.current.error).toBeNull();
  });

  it('reports a pause that failed, and a new start clears the pause', async () => {
    const fake = createFakeBridge();
    fake.handle('speech:status', () => speechState({ 'whisper-small': { state: 'downloading' } }));
    fake.handle('speech:cancelPack', () => {
      throw new Error('nothing to cancel');
    });
    const { result } = renderHook(() => useSpeechPacks(fake.bridge, BEST_PACKS));
    await flush();
    act(() => result.current.pause());
    await flush();
    expect(result.current.error).toBe('Couldn’t pause the download.');

    act(() => result.current.start());
    expect(result.current.paused).toBe(false);
    expect(result.current.error).toBeNull();
    await flush();
  });
});

describe('useSettings', () => {
  it('sends a choice that changes several voice settings as one save, and rolls all of it back', async () => {
    const fake = createFakeBridge();
    const { result } = renderHook(() => useSettings(fake.bridge));
    await flush();
    act(() => result.current.setVoicePref({ sttEngine: 'offline', ttsEngine: 'system' }));
    expect(result.current.voice).toMatchObject({ sttEngine: 'offline', ttsEngine: 'system' });
    expect(fake.inputsOf('settings:update')).toEqual([
      { voice: { sttEngine: 'offline', ttsEngine: 'system' } },
    ]);
    await flush();
    expect(result.current.voice).toMatchObject({ sttEngine: 'offline', ttsEngine: 'system' });

    fake.handle('settings:update', () => {
      throw new Error('disk is full');
    });
    act(() =>
      result.current.setVoicePref({ sttEngine: 'whisper', ttsEngine: 'natural', language: 'hi' }),
    );
    expect(result.current.voice).toMatchObject({ sttEngine: 'whisper', language: 'hi' });
    await flush();
    expect(result.current.voice).toMatchObject({
      sttEngine: 'offline',
      ttsEngine: 'system',
      language: 'auto',
    });
    expect(result.current.error).toBe('Couldn’t save that setting. Please try again.');
  });

  it('reads the language and engines from the settings', async () => {
    const fake = createFakeBridge();
    fake.handle('settings:get', () =>
      settingsView({ voice: { language: 'hi', sttEngine: 'offline', whisperModel: 'base' } }),
    );
    const { result } = renderHook(() => useSettings(fake.bridge));
    await flush();
    expect(result.current.voice).toMatchObject({
      language: 'hi',
      sttEngine: 'offline',
      whisperModel: 'base',
      ttsEngine: 'natural',
    });
  });
  it('shows the schema defaults until the real settings arrive', async () => {
    const fake = createFakeBridge();
    fake.handle('settings:get', () => ({
      ...settingsView({ voice: { wakeWord: true, micDeviceId: 'usb-1' } }),
      hotkeys: {
        assistant: 'Ctrl+Alt+Space',
        circle: 'Alt+Shift+C',
        capture: 'Alt+Shift+S',
        dictation: 'Alt+Shift+D',
      },
    }));
    const { result } = renderHook(() => useSettings(fake.bridge));
    expect(result.current.voice).toEqual(DEFAULT_VOICE_PREFS);
    expect(result.current.hotkeys).toEqual({
      assistant: 'Ctrl+Shift+Space',
      circle: 'Alt+Shift+C',
      capture: 'Alt+Shift+S',
      dictation: 'Alt+Shift+D',
    });
    await flush();
    expect(result.current.voice).toMatchObject({ wakeWord: true, micDeviceId: 'usb-1' });
    expect(result.current.hotkeys.assistant).toBe('Ctrl+Alt+Space');
  });

  it('keeps the defaults when the settings cannot be read', async () => {
    const fake = createFakeBridge();
    fake.handle('settings:get', () => {
      throw new Error('ipc down');
    });
    const { result } = renderHook(() => useSettings(fake.bridge));
    await flush();
    expect(result.current.voice).toEqual(DEFAULT_VOICE_PREFS);
    expect(result.current.error).toBeNull();
  });

  it('prefers a settings:changed event over an older settings:get reply', async () => {
    const fake = createFakeBridge();
    const initial = deferred<ReturnType<typeof settingsView>>();
    fake.handle('settings:get', () => initial.promise);
    const { result } = renderHook(() => useSettings(fake.bridge));
    act(() => fake.emit('settings:changed', settingsView({ voice: { pushToTalk: true } })));
    initial.resolve(settingsView());
    await flush();
    expect(result.current.voice.pushToTalk).toBe(true);
  });

  it('applies a switch at once and keeps it when saving succeeds', async () => {
    const fake = createFakeBridge();
    const saved = deferred<ReturnType<typeof settingsView>>();
    fake.handle('settings:update', () => saved.promise);
    const { result } = renderHook(() => useSettings(fake.bridge));
    await flush();
    act(() => result.current.setVoicePref({ wakeWord: true }));
    expect(result.current.voice.wakeWord).toBe(true);
    expect(fake.inputsOf('settings:update')).toEqual([{ voice: { wakeWord: true } }]);
    saved.resolve(settingsView({ voice: { wakeWord: true } }));
    await flush();
    expect(result.current.voice.wakeWord).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('rolls a switch back and reports the problem when saving fails, then recovers', async () => {
    const fake = createFakeBridge();
    const { result } = renderHook(() => useSettings(fake.bridge));
    await flush();
    fake.handle('settings:update', () => {
      throw new Error('disk is full');
    });
    act(() => result.current.setVoicePref({ ttsEnabled: false }));
    expect(result.current.voice.ttsEnabled).toBe(false);
    await flush();
    expect(result.current.voice.ttsEnabled).toBe(true);
    expect(result.current.error).toBe('Couldn’t save that setting. Please try again.');

    fake.handle('settings:update', () => settingsView({ voice: { ttsEnabled: false } }));
    act(() => result.current.setVoicePref({ ttsEnabled: false }));
    expect(result.current.error).toBeNull();
    await flush();
    expect(result.current.voice.ttsEnabled).toBe(false);
  });

  it('keeps a switch on while its own save is still running, even if another save finishes', async () => {
    const fake = createFakeBridge();
    const first = deferred<ReturnType<typeof settingsView>>();
    const second = deferred<ReturnType<typeof settingsView>>();
    const queue = [first, second];
    fake.handle('settings:update', () => queue.shift()?.promise);
    const { result } = renderHook(() => useSettings(fake.bridge));
    await flush();
    act(() => result.current.setVoicePref({ wakeWord: true }));
    act(() => result.current.setVoicePref({ pushToTalk: true }));
    first.resolve(settingsView({ voice: { wakeWord: true } }));
    await flush();
    expect(result.current.voice).toMatchObject({ wakeWord: true, pushToTalk: true });
    second.resolve(settingsView({ voice: { wakeWord: true, pushToTalk: true } }));
    await flush();
    expect(result.current.voice).toMatchObject({ wakeWord: true, pushToTalk: true });
    expect(result.current.error).toBeNull();
  });
});

describe('useAppearance', () => {
  it('assumes a transparent page over the OS theme until app:info answers', async () => {
    const fake = createFakeBridge();
    const info = deferred<typeof APP_INFO>();
    fake.handle('app:info', () => info.promise);
    const { result } = renderHook(() => useAppearance(fake.bridge));
    expect(result.current.material).toBe('mica');
    expect(document.documentElement.dataset['theme']).toBe(result.current.theme);
    info.resolve({ ...APP_INFO, theme: 'light', material: 'acrylic' });
    await flush();
    expect(result.current).toEqual({ theme: 'light', material: 'acrylic' });
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('does not let a late app:info overwrite a newer theme:changed', async () => {
    const fake = createFakeBridge();
    const info = deferred<typeof APP_INFO>();
    fake.handle('app:info', () => info.promise);
    const { result } = renderHook(() => useAppearance(fake.bridge));
    act(() => fake.emit('theme:changed', { theme: 'light' }));
    info.resolve({ ...APP_INFO, theme: 'dark', material: 'none' });
    await flush();
    expect(result.current).toEqual({ theme: 'light', material: 'none' });
  });
});
