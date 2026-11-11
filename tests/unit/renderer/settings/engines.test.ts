import { describe, expect, it } from 'vitest';
import { progressAnnouncement } from '@renderer/settings/lib/announce';
import { describePack, describeModel, type ModelSummary } from '@renderer/settings/lib/describe';
import {
  availabilityOf,
  describeDictationNotice,
  describeSttFallback,
  describeTtsFallback,
  dictationLanguage,
  elevenLabsConfigured,
  resolveFor,
} from '@renderer/settings/lib/engines';
import { changesOf } from '@renderer/settings/lib/patch';
import { SAMPLE_TEXT, sampleLanguage } from '@renderer/settings/lib/samples';
import { validateElevenLabsVoiceId, validateSaveFolder } from '@renderer/settings/lib/validation';
import { makeModel, makeSpeech, makeView, readyPack } from './support';
import type { SpeechPackState } from '@shared/ipc/types';

const MB = 1024 * 1024;

function pack(overrides: Partial<SpeechPackState>): SpeechPackState {
  return makeSpeech({ 'whisper-small': overrides }).packs['whisper-small'];
}

describe('describePack', () => {
  const SIZE = 100 * MB;

  it('offers a download for a missing pack', () => {
    expect(describePack(pack({}), SIZE)).toMatchObject({
      phase: 'missing',
      tone: 'neutral',
      primary: 'download',
      canCancel: false,
      canRemove: false,
      fraction: null,
    });
    expect(describePack(pack({}), SIZE).detail).toBe(
      'About 100 MB. Downloaded once, then it works offline.',
    );
  });

  it('shows speed and time left while downloading, and can cancel', () => {
    const summary = describePack(
      pack({
        state: 'downloading',
        receivedBytes: 25 * MB,
        totalBytes: SIZE,
        bytesPerSecond: 5 * MB,
        etaSeconds: 15,
        message: 'Retrying after a network error',
      }),
      SIZE,
    );
    expect(summary).toMatchObject({
      phase: 'downloading',
      fraction: 0.25,
      downloading: true,
      canCancel: true,
      primary: null,
      note: 'Retrying after a network error',
    });
    expect(summary.detail).toBe('25.0 MB of 100 MB \u00b7 5.00 MB/s \u00b7 about 15 s left');
  });

  it.each([
    ['verifying', 'Checking'],
    ['extracting', 'Unpacking'],
  ] as const)('%s is a finishing step with a full bar and no actions', (state, label) => {
    expect(
      describePack(pack({ state, receivedBytes: SIZE, totalBytes: SIZE }), SIZE),
    ).toMatchObject({
      phase: 'finishing',
      label,
      fraction: 1,
      downloading: true,
      canCancel: false,
      primary: null,
    });
  });

  it('removes a ready pack and retries a failed one with the reason', () => {
    expect(describePack(pack(readyPack('whisper-small')), SIZE)).toMatchObject({
      phase: 'ready',
      tone: 'success',
      canRemove: true,
      primary: null,
    });
    const failed = describePack(
      pack({ state: 'error', receivedBytes: 1000, message: 'Checksum did not match' }),
      SIZE,
    );
    expect(failed).toMatchObject({
      phase: 'error',
      tone: 'danger',
      primary: 'retry',
      error: 'Checksum did not match',
      canRemove: true,
    });
  });

  it('reads a cancelled download as paused (resume) or as not started', () => {
    expect(
      describePack(
        pack({ state: 'error', receivedBytes: 10 * MB, message: 'The download was cancelled' }),
        SIZE,
      ),
    ).toMatchObject({ phase: 'partial', primary: 'resume', error: null, canRemove: true });
    expect(
      describePack(pack({ state: 'error', message: 'Download cancelled' }), SIZE),
    ).toMatchObject({ phase: 'missing', primary: 'download', error: null });
  });

  it('gives the model summary the same phases', () => {
    expect(describeModel(makeModel({ state: 'partial', receivedBytes: 5 }), SIZE).phase).toBe(
      'partial',
    );
    expect(describeModel(makeModel({ state: 'downloading' }), SIZE).phase).toBe('downloading');
    expect(describeModel(makeModel(), SIZE).phase).toBe('ready');
  });
});

describe('progressAnnouncement', () => {
  function summary(
    phase: ModelSummary['phase'],
    fraction: number | null,
    error: string | null = null,
  ) {
    return { phase, fraction, error } as ModelSummary;
  }

  it('says nothing for the first snapshot or an unchanged phase', () => {
    expect(progressAnnouncement(null, summary('downloading', 0.5), 'Natural voice')).toBeNull();
    expect(
      progressAnnouncement(summary('ready', null), summary('ready', null), 'Natural voice'),
    ).toBeNull();
  });

  it.each([
    ['missing', 'downloading', 'Downloading Natural voice.'],
    ['downloading', 'finishing', 'Checking Natural voice.'],
    ['finishing', 'ready', 'Natural voice is ready.'],
    ['downloading', 'partial', 'Natural voice download paused.'],
  ] as const)('%s -> %s', (from, to, text) => {
    expect(progressAnnouncement(summary(from, 0.4), summary(to, 1), 'Natural voice')).toBe(text);
  });

  it('includes the reason of a failure and stays quiet when a download is removed', () => {
    expect(
      progressAnnouncement(
        summary('downloading', 0.4),
        summary('error', 0.4, 'No internet'),
        'Natural voice',
      ),
    ).toBe('Natural voice download failed. No internet');
    expect(
      progressAnnouncement(summary('ready', null), summary('missing', null), 'Natural voice'),
    ).toBeNull();
  });

  it('announces only the highest milestone crossed, never every tick', () => {
    const next = (before: number, after: number) =>
      progressAnnouncement(
        summary('downloading', before),
        summary('downloading', after),
        'Whisper',
      );
    expect(next(0.1, 0.2)).toBeNull();
    expect(next(0.2, 0.3)).toBe('Whisper: 25 percent downloaded.');
    expect(next(0.3, 0.8)).toBe('Whisper: 75 percent downloaded.');
    expect(next(0.5, 0.52)).toBeNull();
  });
});

describe('engine availability and fallbacks', () => {
  const view = makeView();

  it('lists the ready packs, the Vosk model and the saved keys', () => {
    const configured = makeView((v) => {
      v.ai.useAzureSpeech = true;
      v.ai.speechRegion = 'westeurope';
      v.secrets.speechKey = 'key';
      v.secrets.elevenLabsKey = 'key';
      v.voice.elevenLabsVoiceId = 'abc123';
    });
    expect(
      availabilityOf(
        configured,
        makeSpeech({
          'supertonic-3': readyPack('supertonic-3'),
          'whisper-base': { state: 'downloading' },
        }),
        makeModel(),
      ),
    ).toEqual({
      packs: ['supertonic-3'],
      voskReady: true,
      azureSpeechConfigured: true,
      elevenLabsConfigured: true,
    });
    expect(availabilityOf(view, null, null)).toEqual({
      packs: [],
      voskReady: false,
      azureSpeechConfigured: false,
      elevenLabsConfigured: false,
    });
  });

  it('ElevenLabs needs both the key and the voice ID', () => {
    expect(elevenLabsConfigured(view)).toBe(false);
    const keyOnly = makeView((v) => {
      v.secrets.elevenLabsKey = 'key';
    });
    expect(elevenLabsConfigured(keyOnly)).toBe(false);
    const both = makeView((v) => {
      v.secrets.elevenLabsKey = 'key';
      v.voice.elevenLabsVoiceId = 'abc123';
    });
    expect(elevenLabsConfigured(both)).toBe(true);
  });

  it('has no recognition note when the chosen engine is in use', () => {
    const speech = makeSpeech({ 'whisper-small': readyPack('whisper-small') });
    const resolved = resolveFor(view, speech, makeModel());
    expect(describeSttFallback(view, resolved, speech, makeModel())).toBeNull();
  });

  it('names what is used instead, and whether the download is under way', () => {
    const idle = makeSpeech();
    expect(
      describeSttFallback(view, resolveFor(view, idle, makeModel()), idle, makeModel()),
    ).toEqual({
      tone: 'info',
      text: 'Using the offline model until Whisper accurate is downloaded.',
    });
    const working = makeSpeech({ 'whisper-small': { state: 'extracting' } });
    expect(
      describeSttFallback(view, resolveFor(view, working, makeModel()), working, makeModel())?.text,
    ).toBe('Using the offline model until Whisper accurate finishes downloading.');
  });

  it('warns when nothing can recognise speech, with a different text while a download runs', () => {
    const none = makeModel({ state: 'missing' });
    const idle = makeSpeech();
    const idleNote = describeSttFallback(view, resolveFor(view, idle, none), idle, none);
    expect(idleNote?.tone).toBe('warning');
    expect(idleNote?.text).toBe(
      'No speech recognition is ready yet, so only typed commands work. Download one of the models above to use your voice.',
    );
    const working = makeSpeech({ 'whisper-small': { state: 'downloading' } });
    expect(describeSttFallback(view, resolveFor(view, working, none), working, none)?.text).toBe(
      'Whisper accurate is still downloading. Until it finishes only typed commands work.',
    );
  });

  it('explains the Azure and offline fallbacks', () => {
    const azure = makeView((v) => {
      v.voice.sttEngine = 'azure';
    });
    const speech = makeSpeech({ 'whisper-base': readyPack('whisper-base') });
    expect(describeSttFallback(azure, resolveFor(azure, speech, null), speech, null)?.text).toBe(
      'Using Whisper fast until Azure Speech is set up.',
    );

    const offline = makeView((v) => {
      v.voice.sttEngine = 'offline';
    });
    const downloading = makeModel({ state: 'downloading' });
    expect(
      describeSttFallback(offline, resolveFor(offline, speech, downloading), speech, downloading)
        ?.text,
    ).toBe('Using Whisper fast until the offline model finishes downloading.');
  });

  it('says what speaks until the natural voice is ready, and when ElevenLabs lacks setup', () => {
    const idle = makeSpeech();
    expect(describeTtsFallback(view, resolveFor(view, idle, null), idle)?.text).toBe(
      'Using the Windows voice until the natural voice is downloaded.',
    );
    const working = makeSpeech({ 'supertonic-3': { state: 'downloading' } });
    expect(describeTtsFallback(view, resolveFor(view, working, null), working)?.text).toBe(
      'Using the Windows voice until the natural voice finishes downloading.',
    );
    const eleven = makeView((v) => {
      v.voice.ttsEngine = 'elevenlabs';
    });
    const ready = makeSpeech({ 'supertonic-3': readyPack('supertonic-3') });
    expect(describeTtsFallback(eleven, resolveFor(eleven, ready, null), ready)?.text).toBe(
      'ElevenLabs needs an API key and a voice ID. Using the natural voice until you add them.',
    );
  });

  it('has no voice note for the Windows voices, nor for Azure (it has its own hint)', () => {
    const system = makeView((v) => {
      v.voice.ttsEngine = 'system';
    });
    expect(describeTtsFallback(system, resolveFor(system, null, null), null)).toBeNull();
    const azure = makeView((v) => {
      v.voice.ttsEngine = 'azure';
    });
    expect(describeTtsFallback(azure, resolveFor(azure, null, null), null)).toBeNull();
  });

  it('dictation follows the Voice language unless it has its own', () => {
    expect(dictationLanguage(view)).toBe('auto');
    const hindi = makeView((v) => {
      v.voice.language = 'hi';
    });
    expect(dictationLanguage(hindi)).toBe('hi');
    const own = makeView((v) => {
      v.voice.language = 'hi';
      v.dictation.language = 'en';
    });
    expect(dictationLanguage(own)).toBe('en');
  });

  it('dictation warns about missing or English-only recognition', () => {
    const none = makeModel({ state: 'missing' });
    expect(describeDictationNotice(view, resolveFor(view, makeSpeech(), none))?.tone).toBe(
      'warning',
    );
    expect(
      describeDictationNotice(view, resolveFor(view, makeSpeech(), makeModel()))?.text,
    ).toContain('English only');
    const english = makeView((v) => {
      v.dictation.language = 'en';
    });
    expect(
      describeDictationNotice(english, resolveFor(english, makeSpeech(), makeModel())),
    ).toBeNull();
    const ready = makeSpeech({ 'whisper-small': readyPack('whisper-small') });
    expect(describeDictationNotice(view, resolveFor(view, ready, makeModel()))).toBeNull();
  });
});

describe('samples', () => {
  it('speaks Hindi only when the person speaks Hindi', () => {
    expect(sampleLanguage('hi')).toBe('hi');
    expect(sampleLanguage('en')).toBe('en');
    expect(sampleLanguage('auto')).toBe('en');
  });

  it('has a sentence per language (the Hindi one in Devanagari)', () => {
    expect(SAMPLE_TEXT.en).toMatch(/^Good morning!/);
    expect(SAMPLE_TEXT.hi).toMatch(/^[\u0900-\u097F]/);
  });
});

describe('field checks', () => {
  it.each(['', 'abc123', '21m00Tcm4TlvDq8ikWAM', 'a'.repeat(40)])(
    'accepts the voice ID %j',
    (id) => {
      expect(validateElevenLabsVoiceId(id)).toBeNull();
    },
  );

  it.each(['bad-id', 'with space', 'a'.repeat(41), 'naïve', 'id!'])(
    'refuses the voice ID %j',
    (id) => {
      expect(validateElevenLabsVoiceId(id)).toContain('letters and digits only');
    },
  );

  it.each(['', 'C:\\Shots', 'D:/Pictures/Shots', '\\\\server\\share\\shots', 'C:\\My Shots\\2026'])(
    'accepts the folder %j',
    (folder) => {
      expect(validateSaveFolder(folder)).toBeNull();
    },
  );

  it.each([
    ['Screenshots', 'full path'],
    ['C:Shots', 'full path'],
    ['C:\\a|b', 'cannot contain'],
    ['C:\\what?', 'cannot contain'],
    ['C:\\' + 'x'.repeat(260), 'too long'],
  ])('refuses the folder %j', (folder, reason) => {
    expect(validateSaveFolder(folder)).toContain(reason);
  });
});

describe('changesOf', () => {
  it('keeps only the keys that change, and returns null when nothing does', () => {
    const view = makeView();
    expect(changesOf(view, 'voice', { sttEngine: 'whisper', whisperModel: 'base' })).toEqual({
      voice: { whisperModel: 'base' },
    });
    expect(changesOf(view, 'voice', { sttEngine: 'offline', whisperModel: 'base' })).toEqual({
      voice: { sttEngine: 'offline', whisperModel: 'base' },
    });
    expect(changesOf(view, 'voice', { sttEngine: 'whisper' })).toBeNull();
    expect(changesOf(view, 'capture', {})).toBeNull();
  });
});
