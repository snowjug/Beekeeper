import { describe, expect, it } from 'vitest';
import type { AudioFacts } from '@main/dictation/audio';
import { isHallucination, postProcess } from '@main/dictation/postProcess';

const ON = { spokenPunctuation: true } as const;
const OFF = { spokenPunctuation: false } as const;

/** A blip or near-silent clip: Whisper has nothing real to hear. */
const QUIET: AudioFacts = { durationMs: 1200, voicedMs: 100, peakRms: 0.02 };
/** A normal sentence. */
const SPOKEN: AudioFacts = { durationMs: 3000, voicedMs: 1800, peakRms: 0.2 };

describe('postProcess: whitespace and capitals', () => {
  it.each([
    ['  hello   world  ', 'Hello world'],
    ['hello world', 'Hello world'],
    ['Hello world.', 'Hello world.'],
    ['\u200bHello\u00a0world', 'Hello world'],
    ['hello\nworld', 'Hello world'],
    ['i think so', 'I think so'],
    ['iPhone is great', 'iPhone is great'],
    ['github.com is down', 'github.com is down'],
    ['hello@example.com works', 'hello@example.com works'],
    ['e.g. this one', 'e.g. this one'],
    ['3 apples', '3 apples'],
    ['"hello there" she said', '"Hello there" she said'],
    ['', ''],
    ['   ', ''],
  ])('%j -> %j', (input, expected) => {
    expect(postProcess(input, ON)).toBe(expected);
  });
});

describe('postProcess: fillers', () => {
  it.each([
    ['Um, hello there', 'Hello there'],
    ['I think, um, that works', 'I think, that works'],
    ['uh hello', 'Hello'],
    ['Hello uhh world', 'Hello world'],
    ['Hmm, let me think', 'Let me think'],
    ['erm I was saying', 'I was saying'],
    ['This is umm good', 'This is good'],
    ['We went to the UM campus', 'We went to the UM campus'],
    ['uh-huh, sure', 'Uh-huh, sure'],
    ['humble hummus', 'Humble hummus'],
    ['The summer was hot', 'The summer was hot'],
    ['He would err on the side of caution', 'He would err on the side of caution'],
    ['um', ''],
    ['Um, uh, hmm.', ''],
    ['अं मैं घर जा रहा हूँ', 'मैं घर जा रहा हूँ'],
    ['मैं उम कल आऊँगा', 'मैं कल आऊँगा'],
    ['हम्म ठीक है', 'ठीक है'],
    ['अंदर आओ', 'अंदर आओ'],
    ['उम्र क्या है', 'उम्र क्या है'],
    ['हम सब यहाँ हैं', 'हम सब यहाँ हैं'],
  ])('%j -> %j', (input, expected) => {
    expect(postProcess(input, ON)).toBe(expected);
  });
});

describe('postProcess: Whisper hallucinations', () => {
  it.each([
    'Thank you.',
    'Thanks for watching!',
    'you',
    'You',
    'Bye.',
    'Thank you. Thank you.',
    'Thank you for watching, please subscribe',
    'धन्यवाद',
    'शुक्रिया।',
    'थैंक यू',
    'okay',
  ])('drops %j when the clip is quiet', (text) => {
    expect(postProcess(text, { ...ON, audio: QUIET })).toBe('');
  });

  it('drops a stock phrase when the loudest sound is too weak to be speech', () => {
    const faint: AudioFacts = { durationMs: 4000, voicedMs: 2000, peakRms: 0.002 };
    expect(postProcess('Thank you.', { ...ON, audio: faint })).toBe('');
  });

  it.each([
    '.',
    '...',
    '[Music]',
    '(applause)',
    '*laughs*',
    '♪♪',
    '[BLANK_AUDIO]',
    '[Music] [Applause]',
    'Subtitles by the Amara.org community',
    'Subtitled by Jane',
    'Transcribed by volunteers',
    'सबटाइटल्स बाय विभा',
  ])('always drops the artefact %j', (text) => {
    expect(postProcess(text, { ...ON, audio: SPOKEN })).toBe('');
    expect(postProcess(text, ON)).toBe('');
  });

  it.each([
    ['Thank you.', undefined, 'Thank you.'],
    ['Thank you.', SPOKEN, 'Thank you.'],
    ['धन्यवाद', SPOKEN, 'धन्यवाद'],
    ['Thank you for the gift', QUIET, 'Thank you for the gift'],
    ['(555) 123-4567', QUIET, '(555) 123-4567'],
    ['Bye for now my friend', QUIET, 'Bye for now my friend'],
  ])('keeps %j (audio %#)', (text, audio, expected) => {
    expect(postProcess(text, { ...ON, ...(audio ? { audio } : {}) })).toBe(expected);
  });

  it('exposes the guard for logging and tests', () => {
    expect(isHallucination('Thank you.', QUIET)).toBe(true);
    expect(isHallucination('Thank you.', SPOKEN)).toBe(false);
    expect(isHallucination('[Music]')).toBe(true);
  });
});

describe('postProcess: spoken punctuation in English', () => {
  it.each([
    ['hello comma how are you', 'Hello, how are you'],
    ['hello comma how are you question mark', 'Hello, how are you?'],
    ['Hello, comma, how are you? Question mark.', 'Hello, how are you?'],
    ['I am fine full stop', 'I am fine.'],
    ['I am fine period', 'I am fine.'],
    ['wow exclamation mark', 'Wow!'],
    ['wow exclamation point', 'Wow!'],
    ['dear john colon', 'Dear john:'],
    ['first semicolon second', 'First; second'],
    ['first semi colon second', 'First; second'],
    ['well hyphen known', 'Well-known'],
    ['wait dash what', 'Wait - what'],
    ['see open bracket attached close bracket now', 'See (attached) now'],
    ['he said open quote go home close quote', 'He said "go home"'],
    ['open quote hello close quote', '"Hello"'],
    ['line one new line line two', 'Line one\nLine two'],
    ['paragraph one new paragraph paragraph two', 'Paragraph one\n\nParagraph two'],
    ['paragraph one next paragraph paragraph two', 'Paragraph one\n\nParagraph two'],
    ['next paragraph hello', '\n\nHello'],
    ['one newline two', 'One\nTwo'],
    ['Hello new line.', 'Hello\n'],
    ['i am done full stop how are you question mark', 'I am done. How are you?'],
    ['thanks comma bob', 'Thanks, bob'],
    ['Hello COMMA world', 'Hello, world'],
    ['Hello comma.', 'Hello,'],
    ['hello comma comma world', 'Hello, world'],
    ['done full-stop', 'Done.'],
    ['done fullstop', 'Done.'],
    ['really question-mark', 'Really?'],
    ['comma', ','],
    ['period', '.'],
    ['um hello comma uh how are you question mark', 'Hello, how are you?'],
    ['She said, open quote hi close quote.', 'She said, "hi".'],
    ['He said open quote go close quote, and left.', 'He said "go", and left.'],
    ['Um. Uh. Hello.', 'Hello.'],
    ['I think. Um. That works.', 'I think. That works.'],
    ['Wait... um... what', 'Wait... what'],
  ])('%j -> %j', (input, expected) => {
    expect(postProcess(input, ON)).toBe(expected);
  });

  it.each([
    ['the comma is a punctuation mark', 'The comma is a punctuation mark'],
    ['I came to a full stop', 'I came to a full stop'],
    ['delete that comma please', 'Delete that comma please'],
    ['my question mark key is broken', 'My question mark key is broken'],
    ['literal comma', 'Comma'],
    ['type the word literal full stop', 'Type the word full stop'],
    ['a period of time', 'A period of time'],
  ])('keeps the ordinary word in %j', (input, expected) => {
    expect(postProcess(input, ON)).toBe(expected);
  });

  it.each([
    ['hello comma how are you', 'Hello comma how are you'],
    ['done full stop', 'Done full stop'],
    ['one new line two', 'One new line two'],
  ])('leaves %j alone when spoken punctuation is off', (input, expected) => {
    expect(postProcess(input, OFF)).toBe(expected);
  });
});

describe('postProcess: spoken punctuation in Hindi', () => {
  it.each([
    ['नमस्ते कॉमा आप कैसे हैं', 'नमस्ते, आप कैसे हैं'],
    ['आप कैसे हैं प्रश्न चिह्न', 'आप कैसे हैं?'],
    ['आप कैसे हैं प्रश्नचिह्न', 'आप कैसे हैं?'],
    ['आप कैसे हैं प्रश्न चिन्ह', 'आप कैसे हैं?'],
    ['मैं ठीक हूँ पूर्ण विराम', 'मैं ठीक हूँ।'],
    ['मैं ठीक हूँ पूर्णविराम', 'मैं ठीक हूँ।'],
    ['मैं ठीक हूँ फुल स्टॉप', 'मैं ठीक हूँ।'],
    ['वाह विस्मयादिबोधक चिह्न', 'वाह!'],
    ['पहली पंक्ति नई लाइन दूसरी पंक्ति', 'पहली पंक्ति\nदूसरी पंक्ति'],
    ['पहली नयी लाइन दूसरी', 'पहली\nदूसरी'],
    ['पहला न्यू लाइन दूसरा', 'पहला\nदूसरा'],
    ['शीर्षक नया पैराग्राफ विषय', 'शीर्षक\n\nविषय'],
    ['अल्पविराम', ','],
    ['क्वेश्चन मार्क', '?'],
    ['नमस्ते, कॉमा, कैसे हो?', 'नमस्ते, कैसे हो?'],
    ['मैं घर जा रहा हूँ।', 'मैं घर जा रहा हूँ।'],
    ['रुको कोलन ठहरो', 'रुको: ठहरो'],
    ['मैं ठीक हूँ पूर्ण विराम।', 'मैं ठीक हूँ।'],
  ])('%j -> %j', (input, expected) => {
    expect(postProcess(input, ON)).toBe(expected);
  });

  it('keeps the Hindi words when spoken punctuation is off', () => {
    expect(postProcess('मैं ठीक हूँ पूर्ण विराम', OFF)).toBe('मैं ठीक हूँ पूर्ण विराम');
  });
});

describe('postProcess: Hindi and English mixed', () => {
  it.each([
    ['मैं ठीक हूँ full stop', 'मैं ठीक हूँ।'],
    ['hello कॉमा how are you', 'Hello, how are you'],
    ['I am fine पूर्ण विराम', 'I am fine.'],
    [
      'मेरा नाम राहुल है comma and I live in Delhi full stop',
      'मेरा नाम राहुल है, and I live in Delhi.',
    ],
    ['नमस्ते full stop how are you question mark', 'नमस्ते। How are you?'],
    ['ok तो comma let us start', 'Ok तो, let us start'],
    ['Meeting at 5 pm comma bring laptop', 'Meeting at 5 pm, bring laptop'],
    ['वो घर पर है question mark', 'वो घर पर है?'],
    ['umm मैं uh ठीक हूँ', 'मैं ठीक हूँ'],
  ])('%j -> %j', (input, expected) => {
    expect(postProcess(input, ON)).toBe(expected);
  });
});
