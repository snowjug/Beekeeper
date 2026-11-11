import { describe, expect, it } from 'vitest';
import { detectLocale } from '@main/commands/hindi/detect';
import { glossUtterance } from '@main/commands/hindi/gloss';
import {
  lookupLoanword,
  lookupPhrase,
  lookupWord,
  VOCABULARY_COLLISIONS,
} from '@main/commands/hindi/lexicon';
import { romanize, romanKey, skeleton } from '@main/commands/hindi/romanize';
import {
  cleanScript,
  finalVowelVariant,
  hasDevanagari,
  lightKey,
  tokenize,
} from '@main/commands/hindi/script';
import { Utterance } from '@main/commands/hindi/utterance';

describe('the vocabulary', () => {
  it('gives no spelling to two different concepts', () => {
    expect(VOCABULARY_COLLISIONS).toEqual([]);
  });
});

describe('romaniser', () => {
  it.each([
    ['क्रोम', 'krom'],
    ['मौसम', 'mausam'],
    ['खोलो', 'kholo'],
    ['कमरा', 'kamra'],
    ['नमक', 'namak'],
    ['हिंदी', 'hindi'],
    ['पांच', 'panch'],
    ['चाँद', 'chand'],
    ['ज्ञान', 'gyan'],
    ['ज़रूर', 'zarur'],
    ['लिए', 'liye'],
    ['सिंह', 'sinh'],
    ['पत्र', 'patr'],
  ])('%s is written as %s', (word, latin) => {
    expect(romanize(word)).toBe(latin);
  });

  it('writes ड़ and ढ़ the way Hinglish is typed when building keys', () => {
    expect(romanize('बढ़ाओ')).toBe('barhao');
    expect(romanize('बढ़ाओ', true)).toBe('badhao');
  });

  it('leaves Latin text, digits and punctuation alone', () => {
    expect(romanize('open क्रोम now 5!')).toBe('open krom now 5!');
  });
});

describe('phonetic keys', () => {
  it('give the recognition variants of one word the same key', () => {
    const key = (word: string): string => romanKey(romanize(word, true));
    expect(key('मौसम')).toBe(key('मोसम'));
    expect(key('मौसम')).toBe(romanKey('mausam'));
    expect(key('खोलो')).toBe(romanKey('kholo'));
    expect(key('खोलिये')).toBe(key('खोलिए'));
    expect(key('पाँच')).toBe(key('पांच'));
    expect(key('कैलकुलेटर')).toBe(romanKey('kelkuletar'));
  });

  it('keeps different words apart', () => {
    expect(romanKey('kal')).not.toBe(romanKey('kam'));
    expect(romanKey('baje')).not.toBe(romanKey('badhao'));
  });

  it('reduces English words written in Devanagari to the skeleton of the English word', () => {
    expect(skeleton(romanize('क्रोम', true))).toBe(skeleton('chrome'));
    expect(skeleton(romanize('स्क्रीनशॉट', true))).toBe(skeleton('screenshot'));
    expect(skeleton(romanize('ऑफिस', true))).toBe(skeleton('office'));
    expect(skeleton('')).toBe('');
    expect(skeleton('123')).toBe('');
  });
});

describe('script helpers', () => {
  it('recognises Devanagari text', () => {
    expect(hasDevanagari('यूट्यूब खोलो')).toBe(true);
    expect(hasDevanagari('open youtube')).toBe(false);
    expect(hasDevanagari('open यूट्यूब')).toBe(true);
  });

  it('cleans digits, zero-width characters, dandas and hyphens', () => {
    expect(cleanScript('५ मिनट\u200b का। टाइमर-लगाओ')).toBe('5 मिनट का  टाइमर लगाओ');
    expect(cleanScript('lo-fi')).toBe('lo fi');
  });

  it('ignores the slips of speech recognisers when comparing words', () => {
    expect(lightKey('मोसम')).toBe('मोसम');
    expect(lightKey('बाजी')).toBe(lightKey('बाजि'));
    expect(lightKey('ज़रूर')).toBe(lightKey('जरुर'));
    expect(lightKey('पाँच')).toBe(lightKey('पांच'));
    expect(lightKey('कॉफी')).toBe(lightKey('कोफि'));
  });

  it('swaps the vowel at the end of a word', () => {
    expect(finalVowelVariant('बजै')).toBe('बजे');
    expect(finalVowelVariant('बजे')).toBe('बजै');
    expect(finalVowelVariant('खोलो')).toBe('खोलौ');
    expect(finalVowelVariant('खोलौ')).toBe('खोलो');
    expect(finalVowelVariant('मौसम')).toBeNull();
    expect(finalVowelVariant('')).toBeNull();
  });

  it('splits an utterance into words, numbers, addresses and operators', () => {
    const tokens = tokenize('5 मिनट का timer 7:30 github.com 1,000 2.5 + ×');
    expect(tokens.map((token) => [token.kind, token.text])).toEqual([
      ['num', '5'],
      ['dev', 'मिनट'],
      ['dev', 'का'],
      ['lat', 'timer'],
      ['num', '7:30'],
      ['url', 'github.com'],
      ['num', '1000'],
      ['num', '2.5'],
      ['sym', '+'],
      ['sym', '×'],
    ]);
  });
});

describe('word lookup', () => {
  it.each([
    ['मौसम', 'dev', 'WEATHER'],
    ['मोसम', 'dev', 'WEATHER'],
    ['mausam', 'lat', 'WEATHER'],
    ['खोलिए', 'dev', 'OPEN'],
    ['kholiye', 'lat', 'OPEN'],
    ['बजै', 'dev', 'BAJE'],
    ['टाइमर', 'dev', 'TIMER'],
    ['वॉल्यूम', 'dev', 'VOLUME'],
    ['आवाज', 'dev', 'VOLUME'],
    ['अलारम', 'dev', 'ALARM'],
    ['बेटरी', 'dev', 'BATTERY'],
    ['मेरै', 'dev', 'MY'],
    ['सै', 'dev', 'FROM'],
    ['क्या', 'dev', 'WHAT'],
    ['kya', 'lat', 'WHAT'],
  ] as const)('%s is %s', (word, script, symbol) => {
    expect(lookupWord(word, script)?.sym).toBe(symbol);
  });

  it('does not invent a meaning for unknown words', () => {
    expect(lookupWord('xyzzy', 'lat')).toBeNull();
    expect(lookupWord('गुज़रा', 'dev')).toBeNull();
    expect(lookupWord('', 'lat')).toBeNull();
  });

  it('finds phrases that are one concept', () => {
    expect(lookupPhrase(['कौन', 'सा'])?.sym).toBe('WHICH');
    expect(lookupPhrase(['के', 'लिए'])?.sym).toBe('FOR');
    expect(lookupPhrase(['सर्कल', 'टू', 'सर्च'])?.sym).toBe('CIRCLETOSEARCH');
    expect(lookupPhrase(['गुड', 'मॉर्निंग'])?.sym).toBe('GREET');
    expect(lookupPhrase(['फिर', 'से'])?.sym).toBe('AGAIN');
    expect(lookupPhrase(['कुछ', 'और', 'बात'])).toBeNull();
    expect(lookupPhrase([])).toBeNull();
  });
});

describe('English app names written in Devanagari', () => {
  it.each([
    [['व्हाट्सएप'], 'whatsapp'],
    [['कैलकुलेटर'], 'calculator'],
    [['विज़ुअल', 'स्टूडियो', 'कोड'], 'visual studio code'],
    [['नोटपैड'], 'notepad'],
    [['नोटपेड'], 'notepad'],
    [['स्पोटिफाई'], 'spotify'],
  ])('%j is %s', (words, name) => {
    expect(lookupLoanword(words)).toEqual({ sym: 'APP', payload: name });
  });

  it('does not take a Hindi word for an app', () => {
    expect(lookupLoanword(['मौसम'])).toBeNull();
    expect(lookupLoanword(['कंप्यूटर'])).toBeNull();
    expect(lookupLoanword(['ओपन'])).toBeNull();
    expect(lookupLoanword(['कुछ', 'भी', 'बोलो'])).toBeNull();
  });
});

describe('language detection', () => {
  it.each([
    ['नमस्ते', 'hi'],
    ['kya haal hai', 'hi'],
    ['volume badha do', 'hi'],
    ['screenshot lo', 'hi'],
    ['band karo', 'hi'],
    ['haan', 'hi'],
    ['open chrome', 'en'],
    ['play lo-fi', 'en'],
    ['hello', 'en'],
    ['', 'en'],
  ] as const)('%j is %s', (text, locale) => {
    expect(detectLocale(text)).toBe(locale);
  });
});

describe('code-switched sentences', () => {
  const gloss = (text: string): string | null => glossUtterance(Utterance.from(text));

  it.each([
    ['set a timer for पाँच मिनट', 'set a timer for 5 minutes'],
    ['volume बढ़ाओ', 'volume up'],
    ['open क्रोम', 'open chrome'],
    ['turn on डार्क मोड', 'turn on dark mode'],
  ])('%s -> %s', (text, english) => {
    expect(gloss(text)).toBe(english);
  });

  it('has nothing to say about a sentence that is entirely one language', () => {
    expect(gloss('पाँच मिनट')).toBeNull();
    expect(gloss('volume up')).toBeNull();
    expect(gloss('set a timer for 5 minutes')).toBeNull();
  });

  it('does not guess when the sentence is a negation', () => {
    expect(gloss('volume मत बढ़ाओ')).toBeNull();
  });
});
