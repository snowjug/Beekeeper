import { describe, expect, it } from 'vitest';
import {
  cleanForSpeech,
  detectLanguage,
  speechChunks,
  splitScriptRuns,
  splitSentences,
} from '@shared/speech/text';

describe('detectLanguage', () => {
  it('detects Hindi by script and defaults to English', () => {
    expect(detectLanguage('आज मौसम कैसा है')).toBe('hi');
    expect(detectLanguage('What is the weather today')).toBe('en');
    expect(detectLanguage('12345')).toBe('en');
    expect(detectLanguage('Open Chrome खोलो')).toBe('en');
    expect(detectLanguage('मेरा laptop slow है')).toBe('hi');
  });
});

describe('cleanForSpeech', () => {
  it('removes markdown, links, code and emoji', () => {
    const text = '## Weather\n- **Sunny** in [Mumbai](https://example.com) \u2600\uFE0F\n`code` ok';
    const clean = cleanForSpeech(text);
    expect(clean).not.toMatch(/[#*`[\]()]/);
    expect(clean).not.toContain('https');
    expect(clean).not.toContain('\u2600');
    expect(clean).toContain('Sunny in Mumbai');
    expect(clean).toContain('code ok');
  });

  it('speaks units and symbols', () => {
    expect(cleanForSpeech('It is 23\u00B0C and 60% humid')).toBe(
      'It is 23 degrees Celsius and 60 percent humid',
    );
    expect(cleanForSpeech('Tom & Jerry')).toBe('Tom and Jerry');
    expect(cleanForSpeech('see https://example.com/a?b=1 now')).toBe('see link now');
  });

  it('uses Hindi words for Hindi text', () => {
    expect(cleanForSpeech('तापमान 30% है')).toContain('प्रतिशत');
  });

  it('turns line breaks into pauses without doubling punctuation', () => {
    expect(cleanForSpeech('First line.\nSecond line')).toBe('First line. Second line');
    expect(cleanForSpeech('First line\nSecond line')).toBe('First line. Second line');
  });
});

describe('splitSentences', () => {
  it('splits on English and Hindi sentence ends', () => {
    expect(splitSentences('It is sunny today. Take an umbrella anyway! Really?')).toEqual([
      'It is sunny today.',
      'Take an umbrella anyway!',
      'Really?',
    ]);
    expect(splitSentences('आज मौसम साफ़ है। आपके दो रिमाइंडर हैं।')).toEqual([
      'आज मौसम साफ़ है।',
      'आपके दो रिमाइंडर हैं।',
    ]);
  });

  it('merges fragments that are too short to be spoken alone', () => {
    expect(splitSentences('Hi. Good morning to you all today.')).toEqual([
      'Hi. Good morning to you all today.',
    ]);
  });

  it('wraps very long sentences at word boundaries', () => {
    const long = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');
    const parts = splitSentences(long, 100);
    expect(parts.length).toBeGreaterThan(3);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(100);
    expect(parts.join(' ')).toBe(long);
  });

  it('returns nothing for blank input', () => {
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('splitScriptRuns', () => {
  it('splits mixed Hindi and English into runs of one language', () => {
    expect(splitScriptRuns('मेरा laptop बहुत slow है')).toEqual([
      { text: 'मेरा ', lang: 'hi' },
      { text: 'laptop ', lang: 'en' },
      { text: 'बहुत ', lang: 'hi' },
      { text: 'slow ', lang: 'en' },
      { text: 'है', lang: 'hi' },
    ]);
  });

  it('keeps digits and punctuation with the run before them', () => {
    expect(splitScriptRuns('Timer set for 5 minutes.')).toEqual([
      { text: 'Timer set for 5 minutes.', lang: 'en' },
    ]);
    expect(splitScriptRuns('5 मिनट')).toEqual([{ text: '5 मिनट', lang: 'hi' }]);
  });
});

describe('speechChunks', () => {
  it('produces one chunk per sentence and language run', () => {
    const chunks = speechChunks('It is sunny. आज मौसम साफ़ है।');
    expect(chunks.map((chunk) => chunk.lang)).toEqual(['en', 'hi']);
  });

  it('forces a language when asked to', () => {
    const chunks = speechChunks('Namaste, aap kaise hain?', { forceLang: 'hi' });
    expect(chunks).toEqual([{ text: 'Namaste, aap kaise hain?', lang: 'hi' }]);
  });

  it('drops chunks without anything to say', () => {
    expect(speechChunks('... \u2600\uFE0F ...')).toEqual([]);
  });

  it('speaks a tiny Latin fragment inside Hindi with the Hindi voice', () => {
    const chunks = speechChunks('आप का OK कहना ठीक है');
    expect(chunks.every((chunk) => chunk.lang === 'hi')).toBe(true);
  });
});
