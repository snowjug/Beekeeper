import { describe, expect, it } from 'vitest';
import { translateFailure, translatePhrase } from '@main/commands/hindi/localize/phrases';

/** Fixed English sentences of the commands, and the Hindi they are answered with. */
const SENTENCES: ReadonlyArray<readonly [english: string, hindi: string]> = [
  ['Searching the web for ताजमहल', 'वेब पर "ताजमहल" खोज रहा हूँ'],
  ['Searching Bing for weather', 'Bing पर "weather" खोज रहा हूँ'],
  ['Opening Display settings', 'डिस्प्ले सेटिंग्स खोल रहा हूँ'],
  ['Opening Sound settings', 'साउंड सेटिंग्स खोल रहा हूँ'],
  ['Opening Notepad', 'Notepad खोल रहा हूँ'],
  ['Closed Notepad', 'Notepad बंद कर दिया'],
  ["Notepad didn't close", 'Notepad बंद नहीं हुआ'],
  ["Notepad isn't running", 'Notepad चल नहीं रहा है'],
  ['Did you mean Chrome?', 'क्या आपका मतलब Chrome से है?'],
  ['Which one did you mean?', 'आपका मतलब कौन सा है?'],
  ['"chrom" is close to one app on this PC', '"chrom" इस पीसी के एक ऐप से मिलता-जुलता है'],
  ['"x" is close to a few apps on this PC', '"x" इस पीसी के कुछ ऐप्स से मिलता-जुलता है'],
  ['I couldn\'t find "zzz"', 'मुझे "zzz" नहीं मिला'],
  ['Open Chrome', 'Chrome खोलें'],
  ['Open', 'खोलें'],
  ['Show in folder', 'फ़ोल्डर में दिखाएँ'],
  ["I don't know the time zone for Atlantis", 'मुझे Atlantis का टाइम ज़ोन नहीं पता'],
  ["I couldn't find a place called Atlantis", 'मुझे Atlantis नाम की कोई जगह नहीं मिली'],
  ["I couldn't reach the weather service", 'मैं मौसम सेवा से नहीं जुड़ सका'],
  ["I couldn't find that timer", 'मुझे वह टाइमर नहीं मिला'],
  ['That alarm just finished', 'वह अलार्म अभी-अभी पूरा हुआ'],
  ["You don't have any alarms to cancel", 'रद्द करने के लिए आपका कोई अलार्म नहीं है'],
  ['Cancelled your reminder', 'आपका रिमाइंडर रद्द कर दिया'],
  ['Cancelled 2 reminders', '2 रिमाइंडर रद्द कर दिए'],
  ['All 3 alarms cancelled', 'सभी 3 अलार्म रद्द कर दिए'],
  ['Timer cancelled', 'टाइमर रद्द कर दिया'],
  ['In 5 minutes', '5 मिनट बाद'],
  ['In 1 hour 30 minutes', '1 घंटा 30 मिनट बाद'],
  ['Deleted all 4 notes', 'सभी 4 नोट्स हटा दिए'],
  ['Delete your note? Say yes to confirm', 'क्या आपका नोट हटा दूँ? पुष्टि के लिए "हाँ" कहिए'],
  ['I found no notes about milk', 'मुझे milk के बारे में कोई नोट नहीं मिला'],
  ['No notes about "milk"', '"milk" के बारे में कोई नोट नहीं'],
  ['You have one note: milk', 'आपके पास एक नोट है: milk'],
  ['I found 3 notes about milk', 'मुझे milk के बारे में 3 नोट मिले'],
  ['Volume 30%', 'आवाज़ 30%'],
  ['The volume is at 30%', 'आवाज़ 30% पर है'],
  ['Unmuted. Volume 30 percent', 'आवाज़ चालू कर दी। आवाज़ 30 प्रतिशत है'],
  ['Brightness 40%', 'ब्राइटनेस 40%'],
  ['Brightness 40 percent', 'ब्राइटनेस 40 प्रतिशत है'],
  ['Light mode on', 'लाइट मोड चालू'],
  ['Sound is back on', 'आवाज़ फिर चालू हो गई'],
  [
    'Your PC shuts down 10 seconds after you confirm. You can cancel during the countdown',
    'पुष्टि करने के 10 सेकंड बाद आपका पीसी बंद हो जाएगा। उलटी गिनती के दौरान आप इसे रद्द कर सकते हैं',
  ],
  [
    'Your PC restarts 10 seconds after you confirm. You can cancel during the countdown',
    'पुष्टि करने के 10 सेकंड बाद आपका पीसी रीस्टार्ट हो जाएगा। उलटी गिनती के दौरान आप इसे रद्द कर सकते हैं',
  ],
  [
    'Your PC goes to sleep 10 seconds after you confirm. You can cancel during the countdown',
    'पुष्टि करने के 10 सेकंड बाद आपका पीसी स्लीप में चला जाएगा। उलटी गिनती के दौरान आप इसे रद्द कर सकते हैं',
  ],
  ['Shut down', 'बंद करें'],
  ['Restart', 'रीस्टार्ट करें'],
  ['Sleep', 'स्लीप में डालें'],
  ["That doesn't have a real answer", 'इसका कोई वास्तविक उत्तर नहीं है'],
  ['That number is too large for me to work out', 'यह संख्या मेरे हिसाब लगाने के लिए बहुत बड़ी है'],
  ["I couldn't understand that calculation", 'मैं यह हिसाब समझ नहीं सका'],
  ["That's below absolute zero", 'यह परम शून्य से भी नीचे है'],
  ["I can't convert kilometers to miles", 'मैं किलोमीटर को मील में नहीं बदल सकता'],
  [
    'kilometers measure length, while degrees Celsius measure temperature',
    'किलोमीटर लंबाई की इकाई है, जबकि डिग्री सेल्सियस तापमान की इकाई है',
  ],
  ['I couldn\'t find a definition for "xyz"', 'मुझे "xyz" की परिभाषा नहीं मिली'],
  ['A timer needs some time', 'टाइमर के लिए कुछ समय बताइए'],
  ["That's too long for a timer", 'टाइमर के लिए यह बहुत लंबा है'],
  ['That time has already passed', 'वह समय बीत चुका है'],
  ['What should I remind you about?', 'मैं आपको किस बारे में याद दिलाऊँ?'],
  ['When should I remind you?', 'मैं आपको कब याद दिलाऊँ?'],
  ['No alarms set', 'कोई अलार्म सेट नहीं है'],
  ['No reminders scheduled', 'कोई रिमाइंडर तय नहीं है'],
  ['That note is too long', 'यह नोट बहुत लंबा है'],
  ['Undo', 'पूर्ववत करें'],
  ['Check your connection', 'अपना इंटरनेट कनेक्शन जाँचिए'],
  ['Something went wrong', 'कुछ गड़बड़ हो गई'],
];

describe('fixed sentences', () => {
  it.each(SENTENCES)('%s', (english, hindi) => {
    expect(translatePhrase(english)).toBe(hindi);
  });

  it('adds the danda where the English sentence ends with a full stop', () => {
    expect(translatePhrase('Note saved.')).toBe('नोट सेव हो गया।');
    expect(translatePhrase('Searching Bing for weather.')).toBe('Bing पर "weather" खोज रहा हूँ।');
    expect(translatePhrase("I didn't catch that. Try saying or typing it again.")).toBe(
      'मुझे यह समझ नहीं आया, क्या आप दोबारा कह सकते हैं?',
    );
  });

  it('keeps a question mark as it is', () => {
    expect(translatePhrase('Empty the Recycle Bin?')).toBe('क्या रीसायकल बिन खाली कर दूँ?');
  });

  it('translates each sentence of a longer text and keeps the ones it does not know', () => {
    expect(translatePhrase('Note saved. Nobody wrote this one.')).toBe(
      'नोट सेव हो गया। Nobody wrote this one.',
    );
  });

  it('does not let one pattern swallow two sentences', () => {
    expect(
      translatePhrase("I couldn't find a place called Oz. Try another spelling or a nearby city."),
    ).toBe('मुझे Oz नाम की कोई जगह नहीं मिली। दूसरी स्पेलिंग या पास के किसी शहर का नाम आज़माइए।');
  });

  it('has nothing for text it does not know', () => {
    expect(translatePhrase('The quick brown fox')).toBeNull();
    expect(translatePhrase('')).toBeNull();
    expect(translatePhrase('One. Two.')).toBeNull();
  });
});

describe('things that could not be done', () => {
  it.each([
    ["I couldn't open Chrome", 'मैं Chrome नहीं खोल सका'],
    [
      "Sorry, I couldn't open the Wi-Fi settings.",
      'माफ़ कीजिए, मैं वाई-फ़ाई सेटिंग्स नहीं खोल सका।',
    ],
    ["I couldn't close Notepad", 'मैं Notepad बंद नहीं कर सका'],
    ["Sorry, I couldn't change the volume.", 'माफ़ कीजिए, मैं आवाज़ नहीं बदल सका।'],
    ["I couldn't take a screenshot", 'मैं स्क्रीनशॉट नहीं ले सका'],
    ["I couldn't read the battery status", 'मैं बैटरी की स्थिति नहीं पढ़ सका'],
    ["I couldn't open your browser", 'मैं आपका ब्राउज़र नहीं खोल सका'],
  ])('%s', (english, hindi) => {
    expect(translateFailure(english)).toBe(hindi);
  });

  it('has nothing for actions it does not know', () => {
    expect(translateFailure("I couldn't dance")).toBeNull();
    expect(translateFailure('I did it')).toBeNull();
  });
});
