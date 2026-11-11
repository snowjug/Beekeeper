import { describe, expect, it } from 'vitest';
import { resolveEngines, type EngineAvailability } from '@shared/voiceEngines';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { SPEECH_PACKS, SPEECH_PACK_IDS, whisperPackFor } from '@shared/speech/packs';
import { NATURAL_VOICES, naturalVoiceSid } from '@shared/speech/voices';

const nothing: EngineAvailability = {
  packs: [],
  voskReady: false,
  azureSpeechConfigured: false,
  elevenLabsConfigured: false,
};

const voice = DEFAULT_SETTINGS.voice;

describe('resolveEngines', () => {
  it('falls back to the system voice and no recognition when nothing is installed', () => {
    expect(resolveEngines(voice, nothing)).toEqual({
      stt: 'none',
      whisperModel: null,
      tts: 'system',
      sttFallback: true,
      ttsFallback: true,
    });
  });

  it('uses Whisper and the natural voice when their packs are ready', () => {
    const result = resolveEngines(voice, { ...nothing, packs: ['whisper-small', 'supertonic-3'] });
    expect(result).toEqual({
      stt: 'whisper',
      whisperModel: 'small',
      tts: 'natural',
      sttFallback: false,
      ttsFallback: false,
    });
  });

  it('steps in with the other Whisper model while the chosen one downloads', () => {
    const result = resolveEngines(voice, { ...nothing, packs: ['whisper-base'] });
    expect(result.stt).toBe('whisper');
    expect(result.whisperModel).toBe('base');
    expect(result.sttFallback).toBe(true);
  });

  it('uses the offline Vosk model while Whisper is missing', () => {
    const result = resolveEngines(voice, { ...nothing, voskReady: true });
    expect(result.stt).toBe('offline');
    expect(result.sttFallback).toBe(true);
  });

  it('honours an explicit offline choice even when Whisper is installed', () => {
    const result = resolveEngines(
      { ...voice, sttEngine: 'offline' },
      { ...nothing, voskReady: true, packs: ['whisper-small'] },
    );
    expect(result.stt).toBe('offline');
    expect(result.sttFallback).toBe(false);
  });

  it('only picks cloud engines that are configured', () => {
    const cloud = { ...voice, sttEngine: 'azure', ttsEngine: 'elevenlabs' } as const;
    expect(resolveEngines(cloud, nothing)).toMatchObject({ stt: 'none', tts: 'system' });
    expect(
      resolveEngines(cloud, {
        ...nothing,
        azureSpeechConfigured: true,
        elevenLabsConfigured: true,
      }),
    ).toMatchObject({ stt: 'azure', tts: 'elevenlabs', sttFallback: false, ttsFallback: false });
  });

  it('prefers the natural voice over the system one when a cloud voice is not configured', () => {
    const result = resolveEngines(
      { ...voice, ttsEngine: 'elevenlabs' },
      { ...nothing, packs: ['supertonic-3'] },
    );
    expect(result.tts).toBe('natural');
    expect(result.ttsFallback).toBe(true);
  });

  it('keeps the system voice when the user chose it', () => {
    const result = resolveEngines(
      { ...voice, ttsEngine: 'system' },
      { ...nothing, packs: ['supertonic-3'] },
    );
    expect(result.tts).toBe('system');
    expect(result.ttsFallback).toBe(false);
  });
});

describe('speech packs', () => {
  it('pins every download by size and SHA-256', () => {
    for (const id of SPEECH_PACK_IDS) {
      const pack = SPEECH_PACKS[id];
      expect(pack.id).toBe(id);
      const entries = pack.archive ? [pack.archive] : (pack.files ?? []);
      expect(entries.length).toBeGreaterThan(0);
      let total = 0;
      for (const entry of entries) {
        expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.url.startsWith('https://')).toBe(true);
        expect(entry.bytes).toBeGreaterThan(0);
        total += entry.bytes;
      }
      expect(pack.sizeBytes).toBe(total);
    }
  });

  it('maps the Whisper model setting to its pack', () => {
    expect(whisperPackFor('small')).toBe('whisper-small');
    expect(whisperPackFor('base')).toBe('whisper-base');
  });
});

describe('natural voices', () => {
  it('has ten distinct speakers and falls back to the first for unknown ids', () => {
    expect(new Set(NATURAL_VOICES.map((entry) => entry.sid)).size).toBe(10);
    expect(new Set(NATURAL_VOICES.map((entry) => entry.id)).size).toBe(10);
    expect(naturalVoiceSid('rohan')).toBe(7);
    expect(naturalVoiceSid('nobody')).toBe(0);
  });
});
