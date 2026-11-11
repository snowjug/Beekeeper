import { describe, expect, it } from 'vitest';
import { normalizeUtterance } from '@main/commands/hindi';
import { understand } from './support';

/** English commands and chat: the normaliser must hand them back byte for byte. */
const ENGLISH = [
  'set a timer for 5 minutes',
  "what's the weather like in Tokyo tomorrow",
  'Open Chrome!',
  'What time is it?',
  'calculate 15% of 2400',
  'convert 10 km to miles',
  'volume up',
  'turn on dark mode',
  'take a screenshot',
  'good morning',
  'show my notes',
  'remind me at 6 pm to call mom',
  'play lo-fi beats on YouTube',
  'play lofi on youtube',
  'what is the meaning of life',
  'tell me a joke',
  'who is the prime minister of India',
  'shut down my pc',
  'what can you do',
  'yes',
  'no thanks',
  'hello',
  'Hey Beekeeper, what is 2 + 2?',
  'search for the best yoga mat',
  'set an alarm for 7:30 am',
  'wake me up at six',
  "don't turn off the computer",
  'open the Visual Studio Code app',
  'increase brightness by 20',
  'how much battery do I have left',
  'what day is it today',
  'cancel all timers',
  'tomorrow at 9 am',
  'x',
  '',
  '   ',
  '12345',
  '!!!',
  '😀 ok 👍',
  'Open Microsoft Edge and search Mumbai local train timings',
] as const;

describe('English input', () => {
  it.each(ENGLISH)('%j is returned untouched', (text) => {
    const result = normalizeUtterance(text);
    expect(result).toStrictEqual({ text, locale: 'en', changed: false, original: text });
  });

  it('keeps the very same string, not a copy with different spacing or case', () => {
    const text = '  Set A Timer   For 5 MINUTES  ';
    expect(normalizeUtterance(text).text).toBe(text);
  });
});

describe('unusual input', () => {
  it('does not throw and leaves non-text alone', () => {
    for (const text of ['।', '॥ ॥', '\u200b\u200d', '०००', 'a'.repeat(5000), 'क'.repeat(3000)]) {
      expect(() => normalizeUtterance(text)).not.toThrow();
    }
    expect(normalizeUtterance('।')).toMatchObject({ locale: 'en', changed: false });
    expect(normalizeUtterance('०००')).toMatchObject({ locale: 'hi' });
  });

  it('keeps an utterance that has nothing to translate as it was said', () => {
    const result = normalizeUtterance('मुझे नींद आ रही है');
    expect(result).toStrictEqual({
      text: 'मुझे नींद आ रही है',
      locale: 'hi',
      changed: false,
      original: 'मुझे नींद आ रही है',
    });
  });

  it('always returns the original text it was given', () => {
    expect(normalizeUtterance('५ मिनट का टाइमर लगाओ').original).toBe('५ मिनट का टाइमर लगाओ');
  });
});

/** Everyday Hindi and Hinglish that is not a request to the assistant. */
const CHAT = [
  'मेरा कंप्यूटर बंद हो गया',
  'कंप्यूटर बंद हो जाएगा',
  'मेरा लैपटॉप स्लो चल रहा है',
  'कंप्यूटर क्यों बंद नहीं हो रहा',
  'क्या मैं कंप्यूटर बंद कर सकता हूँ',
  'पापा ने कंप्यूटर बंद कर दिया',
  'कंप्यूटर बंद करने का तरीका बताओ',
  'कंप्यूटर कैसे बंद करें',
  'कंप्यूटर बंद करने से क्या होता है',
  'लैपटॉप कब बंद करना है',
  'कंप्यूटर बंद करना मत भूलना',
  'शटडाउन क्या होता है',
  'रीस्टार्ट का मतलब क्या है',
  'मैं सोने जा रहा हूँ',
  'अब मैं सो जाता हूँ',
  'चलो कंप्यूटर बंद करते हैं',
  'लाइट बंद करो',
  'पंखा बंद करो',
  'टीवी बंद करो',
  'गाना बंद करो',
  'मेरी बैटरी खत्म हो गई',
  'फोन की बैटरी कितनी है',
  'मौसम बहुत अच्छा है',
  'आज बहुत गर्मी है',
  'कल मेरी परीक्षा है',
  'कल सुबह मुझे जल्दी उठना है',
  'मुझे घर जाना है',
  'मैं ऑफिस जा रहा हूँ',
  'दरवाज़ा बंद कर दो',
  'दरवाज़ा लॉक कर दो',
  'दरवाज़ा खोलो',
  'खिड़की खोलो',
  'ताला लगा दो',
  'खिड़की बंद करो',
  'पानी बंद करो',
  'नल बंद करो',
  'गैस बंद करो',
  'एसी बंद करो',
  'एसी चालू करो',
  'टीवी चालू करो',
  'गाना चलाओ',
  'कोई अच्छा सा गाना चलाओ',
  'अरिजीत सिंह का गाना सुनाओ',
  'मुझे एक कहानी सुनाओ',
  'एक चुटकुला सुनाओ',
  'आज क्या खाना बनाऊँ',
  'मुझे भूख लगी है',
  'तुम्हारा नाम क्या है',
  'तुम कौन हो',
  'तुम्हें किसने बनाया',
  'क्या तुम हिंदी बोल सकते हो',
  'क्या तुम मुझे सुन सकते हो',
  'धन्यवाद',
  'शुक्रिया',
  'नमस्ते',
  'कैसे हो',
  'क्या हाल है',
  'आप कैसे हैं',
  'मेरा मन नहीं लग रहा',
  'भारत की राजधानी क्या है',
  'ताजमहल कहाँ है',
  'दो और दो कितने होते हैं',
  'पाँच रुपये दे दो',
  'सौ रुपये की किताब',
  'एक कप चाय बनाओ',
  'मेरा फोन खो गया',
  'फोन करो',
  'मम्मी को फोन करो',
  'व्हाट्सएप पर मैसेज भेजो',
  'ईमेल भेजो',
  'मेरी फोटो खींचो',
  'आवाज़ बहुत तेज़ है',
  'आवाज़ साफ़ नहीं आ रही',
  'ब्राइटनेस बहुत ज़्यादा है',
  'स्क्रीन टूट गई',
  'कंप्यूटर हैंग हो गया',
  'इंटरनेट नहीं चल रहा',
  'वाईफाई काम नहीं कर रहा',
  'यह टाइमर कब बजेगा',
  'मेरा अलार्म नहीं बजा',
  'अलार्म क्यों नहीं बजा',
  'रिमाइंडर क्या होता है',
  'नोट्स कहाँ रखे हैं',
  'मेरे नोट्स गायब हो गए',
  'मैंने कल एक नोट लिखा था',
  'कैलकुलेटर कैसे इस्तेमाल करें',
  'कल मौसम खराब था',
  'कल बारिश हुई थी',
  'मैं कल दिल्ली जा रहा हूँ',
  'सोमवार को स्कूल बंद है',
  'दुकान सुबह नौ बजे खुलती है',
  'मीटिंग शाम को पाँच बजे है',
  'ट्रेन रात दस बजे की है',
  'अलार्म मत लगाओ',
  'टाइमर बंद मत करना',
  'कंप्यूटर को बंद मत करो',
  'kya haal hai',
  'mujhe bhookh lagi hai',
  'kal meri exam hai',
  'tum kaise ho',
  'aaj ka din accha tha',
  'darwaza band karo',
  'pankha band karo',
  'mera computer band ho gaya',
  'computer kyun band nahi ho raha',
  'mujhe neend aa rahi hai',
  'gaana chalao',
  'ek joke sunao',
] as const;

describe('Hindi chat is not a command', () => {
  it.each(CHAT)('%s', (text) => {
    const { spoken, intent } = understand(text);
    expect(spoken.locale).toBe('hi');
    expect(intent?.command.id, `"${text}" -> "${spoken.text}"`).toBeUndefined();
  });
});

/** Mentions of the machine that must never reach a command that shuts something down or deletes. */
const DESTRUCTIVE = ['power', 'lock', 'close-app', 'recycle-bin'];

describe('nothing destructive comes out of loose talk', () => {
  const LOOSE = [
    'क्या कंप्यूटर बंद करना चाहिए',
    'कंप्यूटर बंद करने की जरूरत नहीं',
    'कंप्यूटर बंद है',
    'मैंने कंप्यूटर रीस्टार्ट किया था',
    'पीसी लॉक है',
    'लैपटॉप बंद पड़ा है',
    'ताला खोलो',
    'दरवाज़ा लॉक करो',
    'सिस्टम को बंद मत करना',
    'क्रोम बंद है',
    'क्रोम बंद नहीं हो रहा',
    'क्रोम को क्यों बंद करूँ',
    'रीसायकल बिन खाली है',
    'रीसायकल बिन में क्या है',
    'कचरा कहाँ है',
    'मेरे सारे नोट्स कहाँ हैं',
    'नोट्स कैसे डिलीट करते हैं',
  ];

  it.each(LOOSE)('%s', (text) => {
    const { intent } = understand(text);
    expect(DESTRUCTIVE).not.toContain(intent?.command.id);
    if (intent?.command.id === 'notes') {
      expect(intent.slots).not.toMatchObject({ action: 'delete-last' });
      expect(intent.slots).not.toMatchObject({ action: 'clear' });
    }
  });
});

describe('speed', () => {
  const SAMPLE = [
    '5 मिनट का टाइमर लगाओ',
    'कल सुबह सात बजे का अलार्म लगाओ',
    'मुंबई में मौसम कैसा है',
    'ओपन विज़ुअल स्टूडियो कोड',
    'volume badha do',
    'मुझे शाम 6 बजे दूध लाने की याद दिलाना',
    'गूगल पर बिरयानी की रेसिपी सर्च करो',
    'मुझे नींद आ रही है और मैं कल सुबह जल्दी उठना चाहता हूँ',
    'set a timer for पाँच मिनट',
    'kal subah saat baje alarm laga do',
  ];

  /** Milliseconds per utterance over `rounds` passes through `texts`. */
  function perUtterance(texts: readonly string[], rounds = 1): number {
    const start = performance.now();
    for (let round = 0; round < rounds; round += 1) {
      for (const text of texts) normalizeUtterance(text);
    }
    return (performance.now() - start) / (rounds * texts.length);
  }

  /** The fastest of a few runs: a busy machine slows a run down, it never speeds one up. */
  function fastest(runs: number, run: () => number): number {
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index < runs; index += 1) best = Math.min(best, run());
    return best;
  }

  it('rewrites an utterance in a few milliseconds at most', () => {
    perUtterance(SAMPLE, 20);
    // Measured at 0.1-1 ms; the bound leaves room for coverage instrumentation and a busy machine.
    expect(fastest(5, () => perUtterance(CHAT))).toBeLessThan(5);
  });

  it('does not spend time on an utterance too long to be a command', () => {
    const long = 'कंप्यूटर बंद करने का तरीका बताओ '.repeat(100);
    expect(fastest(3, () => perUtterance([long]))).toBeLessThan(100);
    expect(normalizeUtterance(long)).toMatchObject({ locale: 'hi', changed: false, text: long });
  });

  it('still reads a long command', () => {
    const reminder = `मुझे शाम 6 बजे ${'दूध और ब्रेड और अंडे '.repeat(12)}लाने की याद दिलाना`;
    expect(reminder.length).toBeLessThan(400);
    expect(fastest(3, () => perUtterance([reminder]))).toBeLessThan(300);
    expect(normalizeUtterance(reminder).text).toMatch(/^remind me at 6 pm to दूध/);
  });
});
