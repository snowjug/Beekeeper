import { describe, expect, it } from 'vitest';
import { allCommands, createCommandEngine } from '@main/commands';
import { normalizeUtterance } from '@main/commands/hindi';
import { NOW } from '../helpers';

/**
 * Hindi, Hinglish, code-switched and Devanagari-transliterated English phrases run through the real
 * command engine: each must reach the right command with the right slots. Many are written the way
 * Whisper-small misspells Hindi (short/long vowels, missing nasals, ै for े).
 */
const engine = createCommandEngine({ modules: allCommands });

/** Calendar time relative to NOW (Tuesday 10 Nov 2026, 15:42). */
const at = (dayOffset: number, hour: number, minute = 0): number =>
  new Date(2026, 10, 10 + dayOffset, hour, minute).getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Slots = Record<string, unknown>;
type Case = readonly [phrase: string, command: string, slots?: Slots];

/** Every case checked above; the spelling-slip tests at the end replay them with typos. */
const CASES: Case[] = [];

function understand(phrase: string) {
  const normalized = normalizeUtterance(phrase);
  const intent = engine.parse(normalized.text, { now: NOW, turns: [] });
  return { normalized, intent };
}

function check(cases: readonly Case[]): void {
  CASES.push(...cases);
  const rows = cases.map(([phrase, command, slots]): [string, string, Slots | undefined] => [
    phrase,
    command,
    slots,
  ]);
  it.each(rows)('%s', (phrase, command, slots) => {
    const { normalized, intent } = understand(phrase);
    expect(normalized.locale).toBe('hi');
    expect(intent?.command.id, `"${phrase}" -> "${normalized.text}"`).toBe(command);
    if (slots !== undefined) expect(intent?.slots).toMatchObject(slots);
  });
}

describe('open an app or website', () => {
  check([
    ['यूट्यूब खोलो', 'open-app', { query: 'youtube' }],
    ['ओपन क्रोम', 'open-app', { query: 'chrome' }],
    ['क्रोम खोलो', 'open-app', { query: 'chrome' }],
    ['गूगल क्रोम खोलो', 'open-app', { query: 'chrome' }],
    ['नोटपैड खोलो', 'open-app', { query: 'notepad' }],
    ['कैलकुलेटर खोलो', 'open-app', { query: 'calculator' }],
    ['कैलकुलेटर खोलिए', 'open-app', { query: 'calculator' }],
    ['व्हाट्सएप खोलो', 'open-app', { query: 'whatsapp' }],
    ['वाट्सऐप चालू करो', 'open-app', { query: 'whatsapp' }],
    ['स्पॉटिफाई खोलो', 'open-app', { query: 'spotify' }],
    ['टास्क मैनेजर खोलो', 'open-app', { query: 'task manager' }],
    ['विज़ुअल स्टूडियो कोड खोलो', 'open-app', { query: 'visual studio code' }],
    ['वीएस कोड खोलो', 'open-app', { query: 'visual studio code' }],
    ['चैट जीपीटी खोलो', 'open-app', { query: 'chatgpt' }],
    ['एक्सेल खोलो', 'open-app', { query: 'excel' }],
    ['पावरपॉइंट खोलो', 'open-app', { query: 'powerpoint' }],
    ['डिस्कॉर्ड खोलो', 'open-app', { query: 'discord' }],
    ['ज़ूम खोलो', 'open-app', { query: 'zoom' }],
    ['फेसबुक खोलो', 'open-app', { query: 'facebook' }],
    ['इंस्टाग्राम खोलो', 'open-app', { query: 'instagram' }],
    ['जीमेल खोलो', 'open-app', { query: 'gmail' }],
    ['फाइल एक्सप्लोरर खोलो', 'open-app', { query: 'file explorer' }],
    ['यूट्यूब ओपन करो', 'open-app', { query: 'youtube' }],
    ['youtube kholo', 'open-app', { query: 'youtube' }],
    ['chrome kholo', 'open-app', { query: 'chrome' }],
    ['notepad kholo', 'open-app', { query: 'notepad' }],
    ['whatsapp khol do', 'open-app', { query: 'whatsapp' }],
    ['calculator chalao', 'open-app', { query: 'calculator' }],
    ['open क्रोम', 'open-app', { query: 'chrome' }],
    ['github.com खोलो', 'open-website', { host: 'github.com' }],
    ['गूगल डॉट कॉम खोलो', 'open-website', { host: 'google.com' }],
  ]);
});

describe('close an app', () => {
  check([
    ['क्रोम बंद करो', 'close-app', { query: 'chrome' }],
    ['क्रोम को बंद कर दो', 'close-app', { query: 'chrome' }],
    ['नोटपैड बंद करो', 'close-app', { query: 'notepad' }],
    ['स्पॉटिफाई बंद कर दो', 'close-app', { query: 'spotify' }],
    ['क्लोज़ क्रोम', 'close-app', { query: 'chrome' }],
    ['chrome band karo', 'close-app', { query: 'chrome' }],
    ['notepad band kar do', 'close-app', { query: 'notepad' }],
    ['spotify close karo', 'close-app', { query: 'spotify' }],
  ]);
});

describe('web search and YouTube', () => {
  check([
    [
      'गूगल पर बिरयानी की रेसिपी सर्च करो',
      'web-search',
      { engine: 'google', query: 'बिरयानी की रेसिपी' },
    ],
    ['सर्च करो पायथन ट्यूटोरियल', 'web-search', { query: 'पायथन ट्यूटोरियल' }],
    ['बिंग पर इलेक्ट्रॉन डॉक्स सर्च करो', 'web-search', { engine: 'bing' }],
    ['पायथन के बारे में सर्च करो', 'web-search', { query: 'पायथन' }],
    ['google par best pizza search karo', 'web-search', { engine: 'google', query: 'best pizza' }],
    ['यूट्यूब पर लोफी म्यूजिक चलाओ', 'youtube', { query: 'लोफी म्यूजिक' }],
    ['यूट्यूब पर अरिजीत सिंह के गाने खोजो', 'youtube', { query: 'अरिजीत सिंह के गाने' }],
    ['यूट्यूब पर बिल्ली के वीडियो सर्च करो', 'youtube', { query: 'बिल्ली के वीडियो' }],
    ['यूट्यूब पर पुराने गाने लगाओ', 'youtube', { query: 'पुराने गाने' }],
    ['youtube par lofi chalao', 'youtube', { query: 'lofi' }],
  ]);
});

describe('time and date', () => {
  check([
    ['समय क्या हुआ है', 'datetime', { focus: 'time' }],
    ['टाइम क्या हुआ है', 'datetime', { focus: 'time' }],
    ['अभी क्या समय हुआ है', 'datetime', { focus: 'time' }],
    ['अभी कितने बजे हैं', 'datetime', { focus: 'time' }],
    ['क्या बजा है', 'datetime', { focus: 'time' }],
    ['टाइम बताओ', 'datetime', { focus: 'time' }],
    ['समय बताइए', 'datetime', { focus: 'time' }],
    ['अभी का समय बताओ', 'datetime', { focus: 'time' }],
    ['आज की तारीख', 'datetime', { focus: 'date' }],
    ['आज की तारीख क्या है', 'datetime', { focus: 'date' }],
    ['तारीख बताओ', 'datetime', { focus: 'date' }],
    ['आज कितनी तारीख है', 'datetime', { focus: 'date' }],
    ['आज की डेट बताओ', 'datetime', { focus: 'date' }],
    ['आज कौन सा दिन है', 'datetime', { focus: 'day' }],
    ['आज क्या वार है', 'datetime', { focus: 'day' }],
    ['आज कौनसा दिन है', 'datetime', { focus: 'day' }],
    ['टोक्यो में समय क्या हुआ है', 'datetime', { focus: 'time', place: 'tokyo' }],
    ['लंदन में कितने बजे हैं', 'datetime', { focus: 'time', place: 'london' }],
    ['न्यूयॉर्क का समय बताओ', 'datetime', { focus: 'time', place: 'new york' }],
    ['दुबई में टाइम क्या हुआ है', 'datetime', { focus: 'time', place: 'dubai' }],
    ['abhi kitne baje hain', 'datetime', { focus: 'time' }],
    ['time kya hua hai', 'datetime', { focus: 'time' }],
    ['samay batao', 'datetime', { focus: 'time' }],
    ['aaj ki tarikh batao', 'datetime', { focus: 'date' }],
    ['aaj kaun sa din hai', 'datetime', { focus: 'day' }],
  ]);
});

describe('weather', () => {
  check([
    ['मौसम कैसा है', 'weather', { day: 0, question: 'general' }],
    ['मोसम कैसा है', 'weather', { day: 0 }],
    ['आज का मौसम', 'weather', { day: 0 }],
    ['आज मौसम कैसा रहेगा', 'weather', { day: 0 }],
    ['मौसम की जानकारी दो', 'weather', { day: 0 }],
    ['मुंबई में मौसम कैसा है', 'weather', { place: 'mumbai', day: 0 }],
    ['दिल्ली का मौसम बताओ', 'weather', { place: 'delhi' }],
    ['बेंगलुरु में आज मौसम कैसा रहेगा', 'weather', { place: 'bengaluru', day: 0 }],
    ['कल का मौसम कैसा रहेगा', 'weather', { day: 1 }],
    ['कल बारिश होगी क्या', 'weather', { day: 1, question: 'rain' }],
    ['कल दिल्ली में बारिश होगी क्या', 'weather', { day: 1, question: 'rain', place: 'delhi' }],
    ['क्या आज बारिश होगी', 'weather', { day: 0, question: 'rain' }],
    ['आज बारिश होने की संभावना है', 'weather', { day: 0, question: 'rain' }],
    ['आज रात बारिश होगी क्या', 'weather', { question: 'rain' }],
    ['कितनी गर्मी है', 'weather', { question: 'temperature' }],
    ['आज कितनी ठंड है', 'weather', { question: 'temperature' }],
    ['तापमान कितना है', 'weather', { question: 'temperature' }],
    ['आज का तापमान क्या है', 'weather', { question: 'temperature' }],
    ['छाता ले जाना चाहिए', 'weather', { question: 'rain' }],
    ['परसों बारिश होगी क्या', 'weather', { day: 2, question: 'rain' }],
    ['mausam kaisa hai', 'weather', { day: 0 }],
    ['aaj ka mausam batao', 'weather', { day: 0 }],
    ['mumbai mein mausam kaisa hai', 'weather', { place: 'mumbai' }],
    ['kal barish hogi kya', 'weather', { day: 1, question: 'rain' }],
    ['kitni garmi hai', 'weather', { question: 'temperature' }],
  ]);
});

describe('battery and system information', () => {
  check([
    ['बैटरी कितनी बची है', 'battery', { focus: 'level' }],
    ['बैटरी कितने प्रतिशत है', 'battery', { focus: 'level' }],
    ['बैटरी का स्टेटस', 'battery', { focus: 'level' }],
    ['बैटरी चेक करो', 'battery', { focus: 'level' }],
    ['क्या लैपटॉप चार्ज हो रहा है', 'battery', { focus: 'charging' }],
    ['battery kitni bachi hai', 'battery', { focus: 'level' }],
    ['सिस्टम की जानकारी दिखाओ', 'system-info', { focus: 'overview' }],
    ['कितनी रैम है', 'system-info', { focus: 'ram' }],
    ['सीपीयू उपयोग कितना है', 'system-info', { focus: 'cpu' }],
    ['डिस्क में कितनी जगह बची है', 'system-info', { focus: 'disk' }],
    ['कंप्यूटर कब से चालू है', 'system-info', { focus: 'uptime' }],
  ]);
});

describe('calculator and converter', () => {
  check([
    ['5 गुणा 6 कितना होता है', 'calculate', { source: '5 times 6' }],
    ['पाँच गुणा सात कितना होता है', 'calculate', { source: '5 times 7' }],
    ['दस जमा बीस', 'calculate', { source: '10 plus 20' }],
    ['20 भाग 4 कितना होगा', 'calculate', { source: '20 divided by 4' }],
    ['100 घटा 30', 'calculate', { source: '100 minus 30' }],
    ['2400 का 15 प्रतिशत', 'calculate', { source: '15% of 2400' }],
    ['144 का वर्गमूल निकालो', 'calculate', { source: 'square root of 144' }],
    ['5 का वर्ग', 'calculate', { source: '5 squared' }],
    ['2 की घात 8', 'calculate', { source: '2 to the power of 8' }],
    ['10 में से 3 घटाओ', 'calculate', { source: '10 minus 3' }],
    ['5 और 3 जोड़ो', 'calculate', { source: '5 plus 3' }],
    ['20 को 4 से भाग दो', 'calculate', { source: '20 divided by 4' }],
    ['5 guna 6 kitna hota hai', 'calculate', { source: '5 times 6' }],
    ['10 plus 5 kitna hota hai', 'calculate', { source: '10 plus 5' }],
    ['10 किलोमीटर कितने मील हैं', 'convert', { value: 10, from: 'km', to: 'mi' }],
    ['5 किलो कितने पाउंड होते हैं', 'convert', { value: 5, from: 'kg', to: 'lb' }],
    ['100 फ़ारेनहाइट को सेल्सियस में बदलो', 'convert', { value: 100, from: 'f', to: 'c' }],
    ['1 मील में कितने किलोमीटर होते हैं', 'convert', { value: 1, from: 'mi', to: 'km' }],
    ['2 मीटर कितने फीट हैं', 'convert', { value: 2, from: 'm', to: 'ft' }],
    ['3 जीबी कितने एमबी होते हैं', 'convert', { value: 3, from: 'gb', to: 'mb' }],
    ['आधा किलो कितने ग्राम होता है', 'convert', { value: 0.5, from: 'kg', to: 'g' }],
    ['serendipity का मतलब क्या है', 'define', { word: 'serendipity' }],
    ['ephemeral का मतलब बताओ', 'define', { word: 'ephemeral' }],
  ]);
});

describe('timers', () => {
  check([
    ['5 मिनट का टाइमर लगाओ', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
    ['पाँच मिनट का टाइमर लगाओ', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
    ['पाच मिनट का टाइमर लगाओ', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
    ['दस मिनट का टाइमर सेट करो', 'timer', { action: 'start', durationMs: 10 * MINUTE }],
    ['10 मिनट के लिए टाइमर लगाओ', 'timer', { action: 'start', durationMs: 10 * MINUTE }],
    ['टाइमर लगाओ 10 मिनट', 'timer', { action: 'start', durationMs: 10 * MINUTE }],
    ['30 सेकंड का टाइमर चालू करो', 'timer', { action: 'start', durationMs: 30_000 }],
    ['एक घंटे का टाइमर लगा दो', 'timer', { action: 'start', durationMs: HOUR }],
    ['डेढ़ घंटे का टाइमर लगाओ', 'timer', { action: 'start', durationMs: 90 * MINUTE }],
    ['आधे घंटे का टाइमर लगाओ', 'timer', { action: 'start', durationMs: 30 * MINUTE }],
    ['ढाई मिनट का टाइमर लगाओ', 'timer', { action: 'start', durationMs: 150_000 }],
    ['एक घंटा बीस मिनट का टाइमर', 'timer', { action: 'start', durationMs: 80 * MINUTE }],
    ['सवा घंटे का टाइमर लगाओ', 'timer', { action: 'start', durationMs: 75 * MINUTE }],
    ['पौन घंटे का टाइमर लगाओ', 'timer', { action: 'start', durationMs: 45 * MINUTE }],
    ['1 घंटे 30 मिनट का टाइमर लगाओ', 'timer', { action: 'start', durationMs: 90 * MINUTE }],
    ['चाय का 5 मिनट का टाइमर लगाओ', 'timer', { action: 'start', label: 'चाय' }],
    ['टाइमर शुरू करो', 'timer', { action: 'start', durationMs: null }],
    ['टाइमर रद्द करो', 'timer', { action: 'cancel', target: { kind: 'latest' } }],
    ['टाइमर बंद करो', 'timer', { action: 'cancel' }],
    ['सारे टाइमर रद्द करो', 'timer', { action: 'cancel', target: { kind: 'all' } }],
    ['मेरे टाइमर दिखाओ', 'timer', { action: 'list' }],
    ['टाइमर में कितना समय बचा है', 'timer', { action: 'list' }],
    ['set a timer for पाँच मिनट', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
    ['सेट अ टाइमर फॉर टेन मिनट्स', 'timer', { action: 'start', durationMs: 10 * MINUTE }],
    ['सेट टाइमर फॉर फाइव मिनट्स', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
    ['5 minute ka timer lagao', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
    ['timer lagao 10 minute ke liye', 'timer', { action: 'start', durationMs: 10 * MINUTE }],
    ['ek ghante ka timer laga do', 'timer', { action: 'start', durationMs: HOUR }],
    ['paanch minute ka timer laga do', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
    ['timer cancel karo', 'timer', { action: 'cancel' }],
    ['30 second ka timer', 'timer', { action: 'start', durationMs: 30_000 }],
  ]);
});

describe('alarms', () => {
  check([
    ['कल सुबह सात बजे का अलार्म लगाओ', 'alarm', { at: at(1, 7) }],
    ['सुबह 6 बजे अलार्म लगा दो', 'alarm', { at: at(1, 6) }],
    ['अलार्म लगाओ सुबह 5:30 बजे', 'alarm', { at: at(1, 5, 30) }],
    ['शाम 6 बजे का अलार्म लगाओ', 'alarm', { at: at(0, 18) }],
    ['रात 10 बजे का अलार्म', 'alarm', { at: at(0, 22) }],
    ['सुबह साढ़े छह बजे का अलार्म लगाओ', 'alarm', { at: at(1, 6, 30) }],
    ['सुबह सवा सात बजे का अलार्म लगाओ', 'alarm', { at: at(1, 7, 15) }],
    ['सुबह पौने आठ बजे का अलार्म लगाओ', 'alarm', { at: at(1, 7, 45) }],
    ['सुबह सात बजकर तीस मिनट का अलार्म', 'alarm', { at: at(1, 7, 30) }],
    ['कल सुबह सात बजै का अलार्म लगाओ', 'alarm', { at: at(1, 7) }],
    ['मुझे सुबह 6 बजे उठा देना', 'alarm', { at: at(1, 6) }],
    ['अलार्म रद्द करो', 'alarm', { action: 'cancel' }],
    ['मेरे अलार्म दिखाओ', 'alarm', { action: 'list' }],
    ['सारे अलार्म हटाओ', 'alarm', { action: 'cancel', target: { kind: 'all' } }],
    [
      'सुबह 7 बजे का अलार्म रद्द करो',
      'alarm',
      { action: 'cancel', target: { kind: 'clock', minuteOfDay: 420 } },
    ],
    ['अलार्म लगाओ', 'alarm', { problem: 'missing-time' }],
    ['kal subah saat baje alarm laga do', 'alarm', { at: at(1, 7) }],
    ['subah 6 baje ka alarm lagao', 'alarm', { at: at(1, 6) }],
    ['alarm cancel karo', 'alarm', { action: 'cancel' }],
    ['set an alarm for कल सुबह 7 बजे', 'alarm', { at: at(1, 7) }],
    ['सेट एन अलार्म फॉर सेवन एएम', 'alarm', { at: at(1, 7) }],
  ]);
});

describe('reminders and notes', () => {
  check([
    ['मुझे शाम 6 बजे दूध लाने की याद दिलाना', 'reminder', { text: 'दूध लाना', at: at(0, 18) }],
    ['10 मिनट में मुझे चाय बनाने की याद दिलाओ', 'reminder', { text: 'चाय बनाना' }],
    ['कल सुबह 9 बजे मीटिंग की याद दिलाना', 'reminder', { text: 'मीटिंग', at: at(1, 9) }],
    ['5 मिनट बाद मुझे माँ को फोन करने की याद दिलाओ', 'reminder', { text: 'माँ को फोन करना' }],
    ['रिमाइंडर लगाओ कि दूध लाना है', 'reminder', { problem: 'missing-time' }],
    ['मेरे रिमाइंडर दिखाओ', 'reminder', { action: 'list' }],
    ['रिमाइंडर रद्द करो', 'reminder', { action: 'cancel' }],
    [
      'mujhe kal subah 9 baje meeting ki yaad dilana',
      'reminder',
      { text: 'meeting', at: at(1, 9) },
    ],
    ['नोट करो कि दूध लाना है', 'notes', { action: 'add', text: 'दूध लाना है' }],
    ['नोट करो दूध लाना', 'notes', { action: 'add', text: 'दूध लाना' }],
    ['एक नोट बनाओ दूध लाना', 'notes', { action: 'add', text: 'दूध लाना' }],
    ['दूध लाना नोट करो', 'notes', { action: 'add', text: 'दूध लाना' }],
    ['याद रखना कि कल मीटिंग है', 'notes', { action: 'add', text: 'कल मीटिंग है' }],
    ['मेरे नोट्स दिखाओ', 'notes', { action: 'list' }],
    ['नोट्स पढ़ो', 'notes', { action: 'list' }],
    ['मेरे सारे नोट्स दिखाओ', 'notes', { action: 'list' }],
    ['आख़िरी नोट हटाओ', 'notes', { action: 'delete-last' }],
    ['सारे नोट्स डिलीट करो', 'notes', { action: 'clear' }],
    ['नोट्स में दूध खोजो', 'notes', { action: 'list', query: 'दूध' }],
    ['दूध के बारे में नोट्स दिखाओ', 'notes', { action: 'list', query: 'दूध' }],
    ['note karo doodh lana hai', 'notes', { action: 'add' }],
    ['mere notes dikhao', 'notes', { action: 'list' }],
    ['last note hatao', 'notes', { action: 'delete-last' }],
    ['इसे कॉपी करो', 'copy-that'],
    ['कॉपी करो', 'copy-that'],
    ['जवाब कॉपी करो', 'copy-that'],
    ['कॉपी कर लो', 'copy-that'],
    ['copy karo', 'copy-that'],
  ]);
});

describe('volume and brightness', () => {
  check([
    ['आवाज़ बढ़ाओ', 'volume', { action: 'step', direction: 'up' }],
    ['आवाज़ कम करो', 'volume', { action: 'step', direction: 'down' }],
    ['वॉल्यूम अप', 'volume', { action: 'step', direction: 'up' }],
    ['वॉल्यूम डाउन', 'volume', { action: 'step', direction: 'down' }],
    ['आवाज़ तेज़ करो', 'volume', { action: 'step', direction: 'up' }],
    ['आवाज़ धीमी करो', 'volume', { action: 'step', direction: 'down' }],
    ['आवाज बड़ाओ', 'volume', { action: 'step', direction: 'up' }],
    ['वोल्यूम बढ़ाओ', 'volume', { action: 'step', direction: 'up' }],
    ['म्यूट करो', 'volume', { action: 'mute' }],
    ['अनम्यूट करो', 'volume', { action: 'unmute' }],
    ['आवाज़ बंद करो', 'volume', { action: 'mute' }],
    ['आवाज़ चालू करो', 'volume', { action: 'unmute' }],
    ['आवाज़ 50 करो', 'volume', { action: 'set', percent: 50 }],
    ['वॉल्यूम 30 प्रतिशत पर सेट करो', 'volume', { action: 'set', percent: 30 }],
    ['आवाज़ फुल करो', 'volume', { action: 'set', percent: 100 }],
    ['आवाज़ 10 बढ़ाओ', 'volume', { action: 'step', direction: 'up', amount: 10 }],
    ['आवाज़ थोड़ी बढ़ाओ', 'volume', { action: 'step', direction: 'up' }],
    ['आवाज़ कितनी है', 'volume', { action: 'get' }],
    ['volume badha do', 'volume', { action: 'step', direction: 'up' }],
    ['volume kam karo', 'volume', { action: 'step', direction: 'down' }],
    ['awaz badhao', 'volume', { action: 'step', direction: 'up' }],
    ['volume 40 karo', 'volume', { action: 'set', percent: 40 }],
    ['mute karo', 'volume', { action: 'mute' }],
    ['volume बढ़ाओ', 'volume', { action: 'step', direction: 'up' }],
    ['ब्राइटनेस बढ़ाओ', 'brightness', { action: 'step', direction: 'up' }],
    ['ब्राइटनेस कम करो', 'brightness', { action: 'step', direction: 'down' }],
    ['स्क्रीन की रोशनी बढ़ाओ', 'brightness', { action: 'step', direction: 'up' }],
    ['स्क्रीन की चमक कम करो', 'brightness', { action: 'step', direction: 'down' }],
    ['ब्राइटनेस 70 प्रतिशत करो', 'brightness', { action: 'set', percent: 70 }],
    ['brightness kam karo', 'brightness', { action: 'step', direction: 'down' }],
  ]);
});

describe('theme, screenshot and PC control', () => {
  check([
    ['डार्क मोड चालू करो', 'dark-mode', { mode: 'dark' }],
    ['डार्क मोड ऑन करो', 'dark-mode', { mode: 'dark' }],
    ['डार्क मोड बंद करो', 'dark-mode', { mode: 'light' }],
    ['लाइट मोड चालू करो', 'dark-mode', { mode: 'light' }],
    ['डार्क मोड लगाओ', 'dark-mode', { mode: 'dark' }],
    ['डार्क थीम चालू करो', 'dark-mode', { mode: 'dark' }],
    ['डार्क मोड बदलो', 'dark-mode', { mode: 'toggle' }],
    ['dark mode on karo', 'dark-mode', { mode: 'dark' }],
    ['स्क्रीनशॉट लो', 'screenshot'],
    ['स्क्रीनशॉट ले लो', 'screenshot'],
    ['स्क्रीन कैप्चर करो', 'screenshot'],
    ['स्क्रीन का फोटो लो', 'screenshot'],
    ['स्क्रीनशॉट खींचो', 'screenshot'],
    ['screenshot lo', 'screenshot'],
    ['कंप्यूटर लॉक करो', 'lock'],
    ['स्क्रीन लॉक करो', 'lock'],
    ['लैपटॉप लॉक कर दो', 'lock'],
    ['लॉक करो', 'lock'],
    ['कंप्यूटर बंद करो', 'power', { action: 'shutdown' }],
    ['लैपटॉप बंद कर दो', 'power', { action: 'shutdown' }],
    ['शटडाउन करो', 'power', { action: 'shutdown' }],
    ['पीसी रीस्टार्ट करो', 'power', { action: 'restart' }],
    ['कंप्यूटर रीबूट करो', 'power', { action: 'restart' }],
    ['कंप्यूटर को स्लीप मोड में डालो', 'power', { action: 'sleep' }],
    ['computer restart karo', 'power', { action: 'restart' }],
    ['रीसायकल बिन खाली करो', 'recycle-bin'],
    ['कचरा खाली करो', 'recycle-bin'],
    ['ट्रैश साफ़ करो', 'recycle-bin'],
    ['recycle bin khali karo', 'recycle-bin'],
    ['वाईफाई सेटिंग्स खोलो', 'settings-pages', { page: 'wifi' }],
    ['ब्लूटूथ सेटिंग्स खोलो', 'settings-pages', { page: 'bluetooth' }],
    ['साउंड सेटिंग्स खोलो', 'settings-pages', { page: 'sound' }],
    ['डिस्प्ले सेटिंग्स खोलो', 'settings-pages', { page: 'display' }],
    ['वाईफाई खोलो', 'settings-pages', { page: 'wifi' }],
    ['wifi settings kholo', 'settings-pages', { page: 'wifi' }],
  ]);
});

describe('the assistant itself', () => {
  check([
    ['सर्कल टू सर्च', 'circle-to-search'],
    ['स्क्रीन पर सर्च करो', 'circle-to-search'],
    ['स्क्रीन पर क्या है', 'circle-to-search'],
    ['सेटिंग्स खोलो', 'settings-and-help', { action: 'settings' }],
    ['तुम क्या कर सकते हो', 'settings-and-help', { action: 'help' }],
    ['आप क्या क्या कर सकते हैं', 'settings-and-help', { action: 'help' }],
    ['मदद करो', 'settings-and-help', { action: 'help' }],
    ['हेल्प', 'settings-and-help', { action: 'help' }],
    ['कमांड दिखाओ', 'settings-and-help', { action: 'help' }],
    ['मैं क्या बोल सकता हूँ', 'settings-and-help', { action: 'help' }],
    ['रुको', 'stop'],
    ['बंद करो', 'stop'],
    ['बस करो', 'stop'],
    ['रहने दो', 'stop'],
    ['कोई बात नहीं', 'stop'],
    ['कैंसल', 'stop'],
    ['चुप हो जाओ', 'stop'],
    ['स्टॉप', 'stop'],
    ['क्या कर सकते हो', 'settings-and-help', { action: 'help' }],
  ]);
});

describe('briefing, repeat and dictation', () => {
  check([
    ['गुड मॉर्निंग', 'briefing'],
    ['गुड मार्निंग', 'briefing'],
    ['सुप्रभात', 'briefing'],
    ['मेरी ब्रीफ़िंग सुनाओ', 'briefing'],
    ['आज की ब्रीफिंग दो', 'briefing'],
    ['मेरा दिन कैसा रहेगा', 'briefing'],
    ['आज का दिन कैसा रहेगा', 'briefing'],
    ['इसे दोहराओ', 'repeat'],
    ['फिर से बोलो', 'repeat'],
    ['दोबारा बोलो', 'repeat'],
    ['एक बार फिर से बताओ', 'repeat'],
    ['क्या कहा तुमने', 'repeat'],
    ['रिपीट करो', 'repeat'],
    ['डिक्टेशन शुरू करो', 'dictate'],
    ['डिक्टेट करो', 'dictate'],
    ['वॉइस टाइपिंग चालू करो', 'dictate'],
    ['मैं जो बोलूँ वो टाइप करो', 'dictate'],
    ['dictation shuru karo', 'dictate'],
  ]);
});

describe('phrases people really say', () => {
  check([
    ['अभी क्या टाइम हो रहा है', 'datetime', { focus: 'time' }],
    ['कितने बज गए', 'datetime', { focus: 'time' }],
    ['क्या बजा है', 'datetime', { focus: 'time' }],
    ['आज की डेट क्या है', 'datetime', { focus: 'date' }],
    ['आज क्या वार है', 'datetime', { focus: 'day' }],
    ['अभी बाहर का तापमान कितना है', 'weather', { question: 'temperature' }],
    ['क्या कल धूप निकलेगी', 'weather', { day: 1 }],
    ['आज कितनी गर्मी पड़ेगी', 'weather', { question: 'temperature' }],
    ['मौसम का हाल बताओ', 'weather', { question: 'general' }],
    ['व्हाट इज़ द वेदर टुडे', 'weather', { question: 'general' }],
    ['व्हाट्स द वेदर लाइक इन दिल्ली', 'weather', { place: 'delhi' }],
    ['वाट इज़ द टाइम', 'datetime'],
    ['कितना टाइम बचा है', 'timer', { action: 'list' }],
    ['बैटरी कितनी देर चलेगी', 'battery'],
    ['लैपटॉप चार्ज में लगा है क्या', 'battery', { focus: 'charging' }],
    ['डिस्क में कितनी जगह खाली है', 'system-info', { focus: 'disk' }],
    ['5 का 6 से गुणा करो', 'calculate', { source: '5 times 6' }],
    ['आवाज़ वापस चालू करो', 'volume', { action: 'unmute' }],
    ['कंप्यूटर को स्लीप पर डालो', 'power', { action: 'sleep' }],
    ['कंप्यूटर सुला दो', 'power', { action: 'sleep' }],
    ['ब्राइटनेस सेटिंग्स खोलो', 'settings-pages', { page: 'display' }],
    ['क्रोम ब्राउज़र खोलो', 'open-app', { query: 'chrome' }],
    ['क्रोम ब्राउज़र बंद करो', 'close-app', { query: 'chrome' }],
    ['यूट्यूब पर जाओ', 'open-app', { query: 'youtube' }],
    ['टर्न ऑन डार्क मोड', 'dark-mode', { mode: 'dark' }],
    ['टेक अ स्क्रीनशॉट', 'screenshot'],
    ['नोट करो कि कल मीटिंग है', 'notes', { action: 'add', text: 'कल मीटिंग है' }],
    ['note karo ki kal meeting hai', 'notes', { action: 'add', text: 'kal meeting hai' }],
    ['ठीक है आवाज़ बढ़ाओ', 'volume', { direction: 'up' }],
    ['जी हाँ डार्क मोड चालू करो', 'dark-mode', { mode: 'dark' }],
  ]);
});

describe('Hinglish as people type and say it', () => {
  check([
    ['paanch minute ka timer lagao', 'timer', { durationMs: 5 * MINUTE }],
    ['dedh ghante ka timer laga do', 'timer', { durationMs: 90 * MINUTE }],
    ['10 minute ke liye timer chalu karo', 'timer', { durationMs: 10 * MINUTE }],
    ['timer cancel karo', 'timer', { action: 'cancel' }],
    ['set timer 5 minute ka', 'timer', { durationMs: 5 * MINUTE }],
    ['sawa saat baje alarm laga do', 'alarm', { at: at(1, 7, 15) }],
    ['kal subah 6 baje utha dena', 'alarm', { at: at(1, 6) }],
    ['saadhe paanch baje ka alarm set karo', 'alarm'],
    ['alarm band karo', 'alarm', { action: 'cancel' }],
    ['alarm lagao kal subah 7 baje', 'alarm', { at: at(1, 7) }],
    ['shaam ko 6 baje yaad dilana ki dudh lana hai', 'reminder', { at: at(0, 18) }],
    ['mujhe 10 minute baad yaad dila dena ki chai banani hai', 'reminder'],
    ['remind me kal subah 9 baje meeting hai', 'reminder', { at: at(1, 9) }],
    ['mere reminders dikhao', 'reminder', { action: 'list' }],
    ['note kar lo ki kal bank jana hai', 'notes', { action: 'add' }],
    ['mere notes dikhao', 'notes', { action: 'list' }],
    ['last note delete karo', 'notes', { action: 'delete-last' }],
    ['aaj mumbai ka mausam batao', 'weather', { place: 'mumbai' }],
    ['kal barish hogi kya', 'weather', { question: 'rain', day: 1 }],
    ['delhi me kitni garmi hai', 'weather', { place: 'delhi' }],
    ['weather batao', 'weather'],
    ['bhai mausam batao', 'weather'],
    ['kitna time hua hai', 'datetime', { focus: 'time' }],
    ['time kya hua hai', 'datetime', { focus: 'time' }],
    ['aaj kaun sa din hai', 'datetime', { focus: 'day' }],
    ['aaj ki date kya hai', 'datetime', { focus: 'date' }],
    ['laptop charge ho raha hai kya', 'battery', { focus: 'charging' }],
    ['ram kitni use ho rahi hai', 'system-info', { focus: 'ram' }],
    ['5 plus 7 kitna hota hai', 'calculate', { source: '5 plus 7' }],
    ['100 ka 15 percent kitna hoga', 'calculate', { source: '15% of 100' }],
    ['10 kilometer kitne mile hote hain', 'convert', { value: 10 }],
    ['volume kam kar do', 'volume', { direction: 'down' }],
    ['volume 30 kar do', 'volume', { percent: 30 }],
    ['awaz band karo', 'volume', { action: 'mute' }],
    ['yaar volume thoda kam karo', 'volume', { direction: 'down' }],
    ['brightness 50 percent kar do', 'brightness', { percent: 50 }],
    ['dark mode chalu karo', 'dark-mode', { mode: 'dark' }],
    ['arre bhai screenshot le lo', 'screenshot'],
    ['screen lock kar do', 'lock'],
    ['computer shutdown karo', 'power', { action: 'shutdown' }],
    ['laptop restart karo', 'power', { action: 'restart' }],
    ['recycle bin khali karo', 'recycle-bin'],
    ['bluetooth chalu karo', 'settings-pages', { page: 'bluetooth' }],
    ['Chrome open karo', 'open-app', { query: 'chrome' }],
    ['Spotify khol do', 'open-app', { query: 'spotify' }],
    ['please chrome khol do', 'open-app', { query: 'chrome' }],
    ['calculator chalu karo', 'open-app', { query: 'calculator' }],
    ['notepad band karo', 'close-app', { query: 'notepad' }],
    ['google par biryani recipe search karo', 'web-search', { query: 'biryani recipe' }],
    ['youtube par arijit singh ke gaane chalao', 'youtube'],
    ['github.com kholo', 'open-website'],
    ['mujhe help chahiye', 'settings-and-help'],
    ['tum kya kar sakte ho', 'settings-and-help'],
    ['ise copy kar do', 'copy-that'],
    ['dobara bolo', 'repeat'],
  ]);
});

/** Typical Whisper-small spelling slips: each one changes the letters but not the word. */
const SLIPS: ReadonlyArray<readonly [name: string, slip: (text: string) => string]> = [
  [
    'no nukta',
    (text) =>
      text
        .normalize('NFD')
        .replace(/\u093C/g, '')
        .normalize('NFC'),
  ],
  ['short ि for ी', (text) => text.replace(/\u0940/g, '\u093F')],
  ['long ी for ि', (text) => text.replace(/\u093F/g, '\u0940')],
  ['short ु for ू', (text) => text.replace(/\u0942/g, '\u0941')],
  ['long ू for ु', (text) => text.replace(/\u0941/g, '\u0942')],
  ['anusvara for chandrabindu', (text) => text.replace(/\u0901/g, '\u0902')],
  ['chandrabindu for anusvara', (text) => text.replace(/\u0902/g, '\u0901')],
  ['ै at the end of a word for े', (text) => text.replace(/\u0947(?![\u0900-\u097F])/g, '\u0948')],
  ['े at the end of a word for ै', (text) => text.replace(/\u0948(?![\u0900-\u097F])/g, '\u0947')],
  ['ो for ौ', (text) => text.replace(/\u094C/g, '\u094B')],
];

describe('spelling slips', () => {
  for (const [name, slip] of SLIPS) {
    it(`${name}: the same command is understood`, () => {
      const missed: string[] = [];
      let tried = 0;
      for (const [phrase, command] of CASES) {
        const slipped = slip(phrase);
        if (slipped === phrase || !/[\u0900-\u097F]/.test(phrase)) continue;
        tried += 1;
        if (understand(slipped).intent?.command.id !== command) missed.push(slipped);
      }
      expect(tried).toBeGreaterThan(3);
      // A slip can turn a word into another real word ("ले" and "लै"), so a rare miss is fine.
      expect(missed.length, missed.join(', ')).toBeLessThanOrEqual(Math.ceil(tried * 0.01));
    });
  }
});
