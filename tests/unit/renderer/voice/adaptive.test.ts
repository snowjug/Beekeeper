import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Speaker, SpeakOptions } from '@renderer/assistant/voice/tts';

const hoisted = vi.hoisted(() => ({
  naturalSpeak: vi.fn(),
  naturalCancel: vi.fn(),
}));

vi.mock('@renderer/assistant/voice/natural', () => ({
  NaturalSpeaker: class {
    speak = hoisted.naturalSpeak;
    cancel = hoisted.naturalCancel;
  },
}));

const { AdaptiveSpeaker } = await import('@renderer/assistant/voice/adaptive');

function options(engine: 'natural' | 'system' | 'elevenlabs' | 'azure') {
  return {
    engine,
    voiceUri: 'voice-1',
    rate: 1.1,
    onStart: vi.fn(),
    onBoundary: vi.fn(),
    onEnd: vi.fn(),
  } satisfies SpeakOptions & { engine: string };
}

function fakeSystem() {
  const speak = vi.fn(() => Promise.resolve());
  const cancel = vi.fn();
  return { speaker: { speak, cancel } as unknown as Speaker, speak, cancel };
}

beforeEach(() => {
  hoisted.naturalSpeak.mockReset().mockResolvedValue(undefined);
  hoisted.naturalCancel.mockReset();
});

describe('AdaptiveSpeaker', () => {
  it('uses the natural voice when it is selected', async () => {
    const system = fakeSystem();
    const speaker = new AdaptiveSpeaker({ invoke: vi.fn() }, system.speaker);
    await speaker.speak('Hello there', options('natural'));
    expect(hoisted.naturalSpeak).toHaveBeenCalledTimes(1);
    expect(system.speak).not.toHaveBeenCalled();
  });

  it('falls back to the Windows voice when the natural voice fails', async () => {
    hoisted.naturalSpeak.mockRejectedValue(new Error('not installed'));
    const system = fakeSystem();
    const speaker = new AdaptiveSpeaker({ invoke: vi.fn() }, system.speaker);
    const given = options('elevenlabs');
    await speaker.speak('Hello there', given);
    expect(system.speak).toHaveBeenCalledWith('Hello there', given);
  });

  it('goes straight to the Windows voice when that is what the user chose', async () => {
    const system = fakeSystem();
    const speaker = new AdaptiveSpeaker({ invoke: vi.fn() }, system.speaker);
    await speaker.speak('Hello there', options('system'));
    expect(hoisted.naturalSpeak).not.toHaveBeenCalled();
    expect(system.speak).toHaveBeenCalledTimes(1);
  });

  it('stops both voices on cancel', () => {
    const system = fakeSystem();
    const speaker = new AdaptiveSpeaker({ invoke: vi.fn() }, system.speaker);
    speaker.cancel();
    expect(hoisted.naturalCancel).toHaveBeenCalled();
    expect(system.cancel).toHaveBeenCalled();
  });
});
