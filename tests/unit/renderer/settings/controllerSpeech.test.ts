import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeSpeech, readyPack, startController } from './support';

describe('speech packs in the controller', () => {
  it('loads the pack status and follows speech:state events', async () => {
    const h = await startController({
      speech: makeSpeech({ 'whisper-small': readyPack('whisper-small') }),
    });
    await waitFor(() => expect(h.controller.store.getState().speech).not.toBeNull());
    expect(h.controller.store.getState().speech?.packs['whisper-small'].state).toBe('ready');
    expect(h.controller.store.getState().speechError).toBeNull();

    h.emit(
      'speech:state',
      makeSpeech({
        'supertonic-3': { state: 'downloading', receivedBytes: 1000, totalBytes: 4000 },
      }),
    );
    expect(h.controller.store.getState().speech?.packs['supertonic-3']).toMatchObject({
      state: 'downloading',
      receivedBytes: 1000,
    });
    h.stop();
  });

  it('keeps a friendly reason when the status cannot be read, and recovers on a refresh', async () => {
    let available = false;
    const h = await startController({
      handlers: {
        'speech:status': () => {
          if (!available) {
            throw new Error(
              "Error invoking remote method 'speech:status': Error: Speech is not available",
            );
          }
          return makeSpeech();
        },
      },
    });
    await waitFor(() =>
      expect(h.controller.store.getState().speechError).toBe('Speech is not available'),
    );
    expect(h.controller.store.getState().speech).toBeNull();
    expect(h.inputsOf('app:log')).toHaveLength(1);

    available = true;
    await h.controller.refreshSpeech();
    expect(h.controller.store.getState()).toMatchObject({ speechError: null });
    expect(h.controller.store.getState().speech).not.toBeNull();
    h.stop();
  });

  it('starts, cancels and removes one pack and stores the answer of the main process', async () => {
    const h = await startController({
      handlers: {
        'speech:ensurePack': () =>
          makeSpeech({ 'whisper-base': { state: 'downloading', totalBytes: 100 } }),
        'speech:cancelPack': () => makeSpeech(),
        'speech:removePack': () => makeSpeech(),
      },
    });
    await h.controller.ensurePack('whisper-base');
    expect(h.inputsOf('speech:ensurePack')).toEqual([{ pack: 'whisper-base' }]);
    expect(h.controller.store.getState().speech?.packs['whisper-base'].state).toBe('downloading');

    await h.controller.cancelPack('whisper-base');
    expect(h.inputsOf('speech:cancelPack')).toEqual([{ pack: 'whisper-base' }]);
    expect(h.controller.store.getState().speech?.packs['whisper-base'].state).toBe('missing');

    await h.controller.removePack('whisper-base');
    expect(h.inputsOf('speech:removePack')).toEqual([{ pack: 'whisper-base' }]);
    h.stop();
  });

  it('remembers a refused request per pack until the next attempt or until the pack moves', async () => {
    let refuse = true;
    const h = await startController({
      handlers: {
        'speech:ensurePack': () => {
          if (refuse) throw new Error('Natural voice is not available yet');
          return makeSpeech({ 'supertonic-3': { state: 'downloading', totalBytes: 100 } });
        },
      },
    });
    await h.controller.ensurePack('supertonic-3');
    expect(h.controller.store.getState().packErrors).toEqual({
      'supertonic-3': 'Natural voice is not available yet',
    });
    expect(h.controller.store.getState().speech?.packs['supertonic-3'].state).toBe('missing');

    refuse = false;
    await h.controller.ensurePack('supertonic-3');
    expect(h.controller.store.getState().packErrors).toEqual({});

    refuse = true;
    await h.controller.ensurePack('whisper-small');
    expect(Object.keys(h.controller.store.getState().packErrors)).toEqual(['whisper-small']);
    h.emit(
      'speech:state',
      makeSpeech({ 'whisper-small': { state: 'downloading', totalBytes: 9 } }),
    );
    expect(h.controller.store.getState().packErrors).toEqual({});
    h.stop();
  });

  it('uses a generic message when the refusal has no usable text', async () => {
    const h = await startController({
      handlers: {
        'speech:cancelPack': () => {
          throw new Error('Forbidden');
        },
      },
    });
    await h.controller.cancelPack('whisper-small');
    expect(h.controller.store.getState().packErrors['whisper-small']).toBe(
      'The download could not be cancelled.',
    );
    h.stop();
  });
});
