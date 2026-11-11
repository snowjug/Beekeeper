/**
 * English -> Hindi for the fixed sentences the commands answer with (titles, details, spoken
 * replies, button labels). A phrase is an exact sentence or a pattern with parts that are kept
 * (names, queries, numbers). Sentences without a translation are returned as null.
 */
import { categoryHindi, durationFromEnglish, unitHindi } from './hi';

type Build = (...parts: string[]) => string;
interface Phrase {
  pattern: RegExp;
  build: Build;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exact(english: string, hindi: string): Phrase {
  return { pattern: new RegExp(`^${escapeRegex(english)}$`), build: () => hindi };
}

function pattern(source: RegExp, build: Build): Phrase {
  return { pattern: source, build };
}

const SETTINGS_PAGES: Readonly<Record<string, string>> = {
  'Wi-Fi': 'वाई-फ़ाई',
  Bluetooth: 'ब्लूटूथ',
  Display: 'डिस्प्ले',
  Sound: 'साउंड',
};
const SCHEDULED: Readonly<Record<string, string>> = {
  timer: 'टाइमर',
  alarm: 'अलार्म',
  reminder: 'रिमाइंडर',
};

/** What "I couldn't <action>" is about: the Hindi verb phrase, "Chrome नहीं खोल सका". */
function failedAction(action: string): string | null {
  if (action === 'open your browser') return 'आपका ब्राउज़र नहीं खोल सका';
  const settings = /^open the (.+) settings$/.exec(action);
  if (settings !== null)
    return `${SETTINGS_PAGES[settings[1] ?? ''] ?? settings[1] ?? ''} सेटिंग्स नहीं खोल सका`;
  const open = /^open (.+)$/.exec(action);
  if (open !== null) return `${open[1] ?? ''} नहीं खोल सका`;
  const close = /^close (.+)$/.exec(action);
  if (close !== null) return `${close[1] ?? ''} बंद नहीं कर सका`;
  const fixed: Readonly<Record<string, string>> = {
    'look through your apps': 'आपके ऐप्स नहीं देख सका',
    'change the volume': 'आवाज़ नहीं बदल सका',
    'read the volume': 'आवाज़ का स्तर नहीं पढ़ सका',
    'change the brightness': 'ब्राइटनेस नहीं बदल सका',
    'read the brightness': 'ब्राइटनेस का स्तर नहीं पढ़ सका',
    'take a screenshot': 'स्क्रीनशॉट नहीं ले सका',
    'lock your PC': 'आपका पीसी लॉक नहीं कर सका',
    'change the theme': 'थीम नहीं बदल सका',
    'copy that': 'इसे कॉपी नहीं कर सका',
    'read the battery status': 'बैटरी की स्थिति नहीं पढ़ सका',
    'read the system information': 'सिस्टम की जानकारी नहीं पढ़ सका',
    'reach the weather service': 'मौसम सेवा से नहीं जुड़ सका',
    'reach the dictionary': 'डिक्शनरी तक नहीं पहुँच सका',
  };
  return fixed[action] ?? null;
}

const PHRASES: readonly Phrase[] = [
  // Generic
  exact('Something went wrong', 'कुछ गड़बड़ हो गई'),
  exact('I ran into a problem while handling that', 'इसे करते समय एक समस्या आ गई'),
  exact('Please try again', 'कृपया फिर कोशिश कीजिए'),
  exact('Sorry, something went wrong', 'माफ़ कीजिए, कुछ गड़बड़ हो गई'),
  exact('Something unexpected went wrong', 'कुछ अनपेक्षित गड़बड़ हो गई'),
  exact(
    "I didn't catch that. Try saying or typing it again",
    'मुझे यह समझ नहीं आया, क्या आप दोबारा कह सकते हैं?',
  ),
  exact("I didn't catch that", 'मुझे यह समझ नहीं आया'),
  exact('Try saying or typing it again', 'क्या आप दोबारा कह सकते हैं?'),
  pattern(/^Searching the web for (.+)$/, (query) => `वेब पर "${query}" खोज रहा हूँ`),
  pattern(
    /^Searching (Google|Bing|YouTube) for (.+)$/,
    (engine, query) => `${engine} पर "${query}" खोज रहा हूँ`,
  ),
  exact("I couldn't open your browser", 'मैं आपका ब्राउज़र नहीं खोल सका'),
  exact("Sorry, I couldn't open your browser", 'माफ़ कीजिए, मैं आपका ब्राउज़र नहीं खोल सका'),
  exact(
    'Check your default browser and try again',
    'अपना डिफ़ॉल्ट ब्राउज़र जाँचिए और दोबारा कोशिश कीजिए',
  ),
  exact('Search the web', 'वेब पर खोजें'),

  // Apps and websites
  pattern(
    /^Opening (Wi-Fi|Bluetooth|Display|Sound) settings$/,
    (page) => `${SETTINGS_PAGES[page] ?? page} सेटिंग्स खोल रहा हूँ`,
  ),
  exact('Opening settings', 'सेटिंग्स खोल रहा हूँ'),
  pattern(/^Opening (.+)$/, (name) => `${name} खोल रहा हूँ`),
  pattern(/^Closed (.+)$/, (name) => `${name} बंद कर दिया`),
  pattern(
    /^(.+) didn't close\. Force close it\?$/,
    (name) => `${name} बंद नहीं हुआ। क्या इसे ज़बरदस्ती बंद कर दूँ?`,
  ),
  pattern(/^(.+) didn't close$/, (name) => `${name} बंद नहीं हुआ`),
  pattern(/^(.+) isn't running$/, (name) => `${name} चल नहीं रहा है`),
  exact("I couldn't find any open windows for it", 'इसकी कोई खुली विंडो नहीं मिली'),
  exact(
    'It may be asking you to save your work. Force closing loses any unsaved changes',
    'हो सकता है यह आपसे काम सेव करने को कह रहा हो। ज़बरदस्ती बंद करने पर बिना सेव किया गया काम खो जाएगा',
  ),
  exact('Force close', 'ज़बरदस्ती बंद करें'),
  pattern(/^Did you mean (.+)\?$/, (name) => `क्या आपका मतलब ${name} से है?`),
  exact('Which one did you mean?', 'आपका मतलब कौन सा है?'),
  pattern(
    /^"(.+)" is close to one app on this PC$/,
    (query) => `"${query}" इस पीसी के एक ऐप से मिलता-जुलता है`,
  ),
  pattern(
    /^"(.+)" is close to a few apps on this PC$/,
    (query) => `"${query}" इस पीसी के कुछ ऐप्स से मिलता-जुलता है`,
  ),
  pattern(/^I couldn't find "(.+)"$/, (query) => `मुझे "${query}" नहीं मिला`),
  exact(
    "It doesn't look like an app that is installed on this PC",
    'यह इस पीसी पर इंस्टॉल किया हुआ ऐप नहीं लगता',
  ),
  exact('Open', 'खोलें'),
  exact('Show in folder', 'फ़ोल्डर में दिखाएँ'),
  pattern(/^Open (.+)$/, (name) => `${name} खोलें`),

  // Time zones and weather problems
  pattern(
    /^I don't know the time zone for (.+)$/,
    (place) => `मुझे ${place} का टाइम ज़ोन नहीं पता`,
  ),
  exact(
    'Try a major city, like Tokyo or London',
    'किसी बड़े शहर का नाम बताइए, जैसे टोक्यो या लंदन',
  ),
  exact("I couldn't reach the weather service", 'मैं मौसम सेवा से नहीं जुड़ सका'),
  exact('Check your connection', 'अपना इंटरनेट कनेक्शन जाँचिए'),
  pattern(
    /^I couldn't find a place called (.+)$/,
    (place) => `मुझे ${place} नाम की कोई जगह नहीं मिली`,
  ),
  pattern(
    /^I couldn't find (?!a place called |a definition for |that )(.+)$/,
    (query) => `मुझे ${query} नहीं मिला`,
  ),
  exact(
    'Try another spelling or a nearby city',
    'दूसरी स्पेलिंग या पास के किसी शहर का नाम आज़माइए',
  ),
  exact("I couldn't work out where you are", 'मैं आपकी लोकेशन का पता नहीं लगा सका'),
  exact(
    'Ask for a city, like "weather in Paris", or set your city in Settings',
    'किसी शहर का मौसम पूछिए, जैसे "पेरिस का मौसम", या सेटिंग्स में अपना शहर चुनिए',
  ),
  exact('Ask for a city, like weather in Paris', 'किसी शहर का मौसम पूछिए, जैसे पेरिस का मौसम'),
  exact('The weather service had a problem', 'मौसम सेवा में कोई समस्या आई'),
  exact('Please try again in a moment', 'कृपया थोड़ी देर बाद फिर कोशिश कीजिए'),

  // Battery, system and calculator problems
  exact(
    'Windows did not answer. Please try again',
    'विंडोज़ ने जवाब नहीं दिया। कृपया फिर कोशिश कीजिए',
  ),
  exact(
    "This PC doesn't have a battery. It's running on AC power",
    'इस पीसी में बैटरी नहीं है। यह एसी पावर पर चल रहा है',
  ),
  exact("This PC doesn't have a battery", 'इस पीसी में बैटरी नहीं है'),
  exact("I can't divide by zero", 'शून्य से भाग नहीं दिया जा सकता'),
  exact("That doesn't have a real answer", 'इसका कोई वास्तविक उत्तर नहीं है'),
  exact(
    'That number is too large for me to work out',
    'यह संख्या मेरे हिसाब लगाने के लिए बहुत बड़ी है',
  ),
  exact('That number is too large', 'यह संख्या बहुत बड़ी है'),
  exact("I couldn't understand that calculation", 'मैं यह हिसाब समझ नहीं सका'),
  exact('Try something like "calculate 15% of 2400"', 'कुछ ऐसा कहिए: "2400 का 15 प्रतिशत"'),
  exact('Try something like calculate 15 percent of 2400', 'कुछ ऐसा कहिए: 2400 का 15 प्रतिशत'),
  pattern(
    /^I can't convert (.+) to (.+)$/,
    (from, to) => `मैं ${unitHindi(from)} को ${unitHindi(to)} में नहीं बदल सकता`,
  ),
  pattern(
    /^(.+) measure (length|weight|temperature|data size), while (.+) measure (length|weight|temperature|data size)$/,
    (from, fromKind, to, toKind) =>
      `${unitHindi(from)} ${categoryHindi(fromKind)} की इकाई है, जबकि ${unitHindi(to)} ${categoryHindi(toKind)} की इकाई है`,
  ),
  exact("That's below absolute zero", 'यह परम शून्य से भी नीचे है'),
  exact(
    'Nothing can be colder than 0 kelvin (−273.15°C)',
    'कोई भी चीज़ 0 केल्विन (−273.15°C) से ठंडी नहीं हो सकती',
  ),
  exact("I couldn't reach the dictionary", 'मैं डिक्शनरी तक नहीं पहुँच सका'),
  exact('Check your connection and try again', 'अपना कनेक्शन जाँचिए और फिर कोशिश कीजिए'),
  pattern(/^I couldn't find a definition for (.+)$/, (word) => `मुझे ${word} की परिभाषा नहीं मिली`),
  exact('Check the spelling or try another word', 'स्पेलिंग जाँचिए या कोई दूसरा शब्द आज़माइए'),

  // Timers, alarms and reminders
  exact('How long should the timer run?', 'टाइमर कितनी देर के लिए चलाऊँ?'),
  exact('For example: "set a timer for 5 minutes"', 'जैसे: "5 मिनट का टाइमर लगाओ"'),
  exact('A timer needs some time', 'टाइमर के लिए कुछ समय बताइए'),
  exact(
    'Try a duration such as "5 minutes" or "30 seconds"',
    'कोई अवधि बताइए, जैसे "5 मिनट" या "30 सेकंड"',
  ),
  exact('A timer needs to run for at least a moment', 'टाइमर को कम से कम थोड़ी देर चलना होगा'),
  exact("That's too long for a timer", 'टाइमर के लिए यह बहुत लंबा है'),
  exact(
    'Timers can run for up to 24 hours. For longer waits, try a reminder such as "remind me in 2 days to renew the ticket"',
    'टाइमर 24 घंटे तक चल सकते हैं। इससे लंबे इंतज़ार के लिए रिमाइंडर आज़माइए, जैसे "2 दिन बाद मुझे टिकट रिन्यू करने की याद दिलाना"',
  ),
  exact('Timers can run for up to 24 hours', 'टाइमर 24 घंटे तक चल सकते हैं'),
  exact('What time should I set the alarm for?', 'अलार्म किस समय के लिए लगाऊँ?'),
  exact(
    'For example: "set an alarm for 7 am" or "wake me up at 6:30"',
    'जैसे: "सुबह 7 बजे का अलार्म लगाओ" या "मुझे सुबह 6:30 बजे उठा देना"',
  ),
  exact('That time has already passed', 'वह समय बीत चुका है'),
  exact(
    'Try a later time, or say "tomorrow at 7 am"',
    'कोई बाद का समय बताइए, या कहिए "कल सुबह 7 बजे"',
  ),
  exact(
    'Try a later time, or say "tomorrow at 9am" or "in 10 minutes"',
    'कोई बाद का समय बताइए, या कहिए "कल सुबह 9 बजे" या "10 मिनट में"',
  ),
  exact("That's too far away", 'यह बहुत दूर का समय है'),
  exact('I can set alarms up to a year ahead', 'मैं एक साल आगे तक के अलार्म लगा सकता हूँ'),
  exact('I can set reminders up to a year ahead', 'मैं एक साल आगे तक के रिमाइंडर लगा सकता हूँ'),
  exact('What should I remind you about?', 'मैं आपको किस बारे में याद दिलाऊँ?'),
  exact(
    'For example: "remind me in 10 minutes to call mom"',
    'जैसे: "10 मिनट बाद मुझे माँ को फोन करने की याद दिलाना"',
  ),
  exact('When should I remind you?', 'मैं आपको कब याद दिलाऊँ?'),
  exact(
    'Try "in 10 minutes", "at 3:30 pm" or "tomorrow at 9am"',
    'कहिए "10 मिनट में", "दोपहर 3:30 बजे" या "कल सुबह 9 बजे"',
  ),
  exact(
    'That time has already passed. What time should I set the alarm for?',
    'वह समय बीत चुका है। अलार्म किस समय के लिए लगाऊँ?',
  ),
  exact(
    'That time has already passed. When should I remind you?',
    'वह समय बीत चुका है। मैं आपको कब याद दिलाऊँ?',
  ),
  exact(
    'I can only set one-time reminders for now',
    'अभी मैं सिर्फ़ एक बार वाले रिमाइंडर लगा सकता हूँ',
  ),
  exact('No timers running', 'कोई टाइमर नहीं चल रहा'),
  exact('No alarms set', 'कोई अलार्म सेट नहीं है'),
  exact('No reminders scheduled', 'कोई रिमाइंडर तय नहीं है'),
  exact(
    'Say "set a timer for 5 minutes" to start one',
    'शुरू करने के लिए कहिए "5 मिनट का टाइमर लगाओ"',
  ),
  exact('Say "set an alarm for 7 am" to add one', 'जोड़ने के लिए कहिए "सुबह 7 बजे का अलार्म लगाओ"'),
  exact(
    'Say "remind me in 10 minutes to call mom" to add one',
    'जोड़ने के लिए कहिए "10 मिनट बाद मुझे माँ को फोन करने की याद दिलाना"',
  ),
  exact('You have no timers running', 'कोई टाइमर नहीं चल रहा है'),
  exact("You don't have any alarms set", 'आपका कोई अलार्म सेट नहीं है'),
  exact("You don't have any reminders scheduled", 'आपका कोई रिमाइंडर तय नहीं है'),
  exact('There is nothing to cancel', 'रद्द करने के लिए कुछ नहीं है'),
  pattern(
    /^You don't have any (timer|alarm|reminder)s to cancel$/,
    (kind) => `रद्द करने के लिए आपका कोई ${SCHEDULED[kind] ?? kind} नहीं है`,
  ),
  pattern(
    /^I couldn't find that (timer|alarm|reminder)$/,
    (kind) => `मुझे वह ${SCHEDULED[kind] ?? kind} नहीं मिला`,
  ),
  pattern(
    /^That (timer|alarm|reminder) just finished$/,
    (kind) => `वह ${SCHEDULED[kind] ?? kind} अभी-अभी पूरा हुआ`,
  ),
  pattern(
    /^(Timer|Alarm|Reminder) cancelled$/,
    (kind) => `${SCHEDULED[kind.toLowerCase()] ?? kind} रद्द कर दिया`,
  ),
  pattern(
    /^Cancelled your (timer|alarm|reminder)$/,
    (kind) => `आपका ${SCHEDULED[kind] ?? kind} रद्द कर दिया`,
  ),
  pattern(
    /^Cancelled (\d+) (timer|alarm|reminder)s$/,
    (count, kind) => `${count} ${SCHEDULED[kind] ?? kind} रद्द कर दिए`,
  ),
  pattern(
    /^All (\d+) (timer|alarm|reminder)s cancelled$/,
    (count, kind) => `सभी ${count} ${SCHEDULED[kind] ?? kind} रद्द कर दिए`,
  ),
  pattern(/^In (.+)$/, (duration) => `${durationFromEnglish(duration)} बाद`),

  // Notes
  exact('What should the note say?', 'नोट में क्या लिखूँ?'),
  exact('For example: "take a note buy milk"', 'जैसे: "नोट करो कि दूध लाना है"'),
  exact('That note is too long', 'यह नोट बहुत लंबा है'),
  exact('Note saved', 'नोट सेव हो गया'),
  exact('No notes yet', 'अभी कोई नोट नहीं है'),
  exact('Say "take a note buy milk" to save one', 'सेव करने के लिए कहिए "नोट करो कि दूध लाना है"'),
  exact("You don't have any notes yet", 'आपके पास अभी कोई नोट नहीं है'),
  exact('No notes to delete', 'हटाने के लिए कोई नोट नहीं है'),
  exact("You don't have any notes to delete", 'हटाने के लिए आपके पास कोई नोट नहीं है'),
  exact('Deleted your last note', 'आपका आख़िरी नोट हटा दिया'),
  exact('Deleted your note', 'आपका नोट हटा दिया'),
  pattern(/^Deleted all (\d+) notes$/, (count) => `सभी ${count} नोट्स हटा दिए`),
  exact('Delete your note?', 'क्या आपका नोट हटा दूँ?'),
  pattern(/^Delete all (\d+) notes\?$/, (count) => `क्या सभी ${count} नोट्स हटा दूँ?`),
  exact("This can't be undone", 'इसे वापस नहीं किया जा सकता'),
  exact('Yes, delete all notes', 'हाँ, सारे नोट्स हटाएँ'),
  exact('Undo', 'पूर्ववत करें'),
  pattern(
    /^Delete your note\? Say yes to confirm$/,
    () => 'क्या आपका नोट हटा दूँ? पुष्टि के लिए "हाँ" कहिए',
  ),
  pattern(
    /^Delete all (\d+) notes\? Say yes to confirm$/,
    (count) => `क्या सभी ${count} नोट्स हटा दूँ? पुष्टि के लिए "हाँ" कहिए`,
  ),
  pattern(
    /^I found no notes about (.+)$/,
    (query) => `मुझे ${query} के बारे में कोई नोट नहीं मिला`,
  ),
  pattern(/^No notes about "(.+)"$/, (query) => `"${query}" के बारे में कोई नोट नहीं`),
  pattern(/^Notes about "(.+)"$/, (query) => `"${query}" के बारे में नोट्स`),
  exact('Your notes', 'आपके नोट्स'),
  pattern(
    /^I found (\d+) notes? about (.+)$/,
    (count, query) => `मुझे ${query} के बारे में ${count} नोट ${count === '1' ? 'मिला' : 'मिले'}`,
  ),
  pattern(/^You have one note: (.+)$/, (text) => `आपके पास एक नोट है: ${text}`),
  pattern(
    /^You have (\d+) notes\. The latest says: (.+)$/,
    (count, text) => `आपके पास ${count} नोट्स हैं। सबसे नया नोट है: ${text}`,
  ),

  // Clipboard
  exact('Copied to clipboard', 'क्लिपबोर्ड पर कॉपी कर दिया'),
  exact('Nothing to copy yet', 'अभी कॉपी करने के लिए कुछ नहीं है'),
  exact(
    'Ask me something first, then say "copy that"',
    'पहले मुझसे कुछ पूछिए, फिर कहिए "इसे कॉपी करो"',
  ),
  exact('There is nothing to copy yet', 'अभी कॉपी करने के लिए कुछ नहीं है'),
  exact("I couldn't copy that", 'मैं इसे कॉपी नहीं कर सका'),
  exact(
    'The clipboard is not available right now. Try again in a moment',
    'क्लिपबोर्ड अभी उपलब्ध नहीं है। थोड़ी देर बाद फिर कोशिश कीजिए',
  ),

  // Volume, brightness, theme, screenshot, lock
  exact('Muted', 'म्यूट'),
  pattern(/^Volume (\d+)%$/, (level) => `आवाज़ ${level}%`),
  pattern(/^The volume is at (\d+)%$/, (level) => `आवाज़ ${level}% पर है`),
  exact('Sound is back on', 'आवाज़ फिर चालू हो गई'),
  pattern(/^Volume (\d+) percent$/, (level) => `आवाज़ ${level} प्रतिशत है`),
  pattern(
    /^Unmuted\. Volume (\d+) percent$/,
    (level) => `आवाज़ चालू कर दी। आवाज़ ${level} प्रतिशत है`,
  ),
  pattern(/^Brightness (\d+)%$/, (level) => `ब्राइटनेस ${level}%`),
  pattern(/^Brightness (\d+) percent$/, (level) => `ब्राइटनेस ${level} प्रतिशत है`),
  exact("Brightness can't be changed here", 'यहाँ ब्राइटनेस नहीं बदली जा सकती'),
  exact(
    "This display doesn't support software brightness control (most desktop monitors don't). Use the buttons on your monitor instead",
    'यह डिस्प्ले सॉफ़्टवेयर से ब्राइटनेस बदलने की सुविधा नहीं देता (ज़्यादातर डेस्कटॉप मॉनिटर नहीं देते)। इसके बजाय अपने मॉनिटर के बटन इस्तेमाल कीजिए',
  ),
  exact(
    "This display doesn't support brightness control",
    'यह डिस्प्ले ब्राइटनेस कंट्रोल का समर्थन नहीं करता',
  ),
  pattern(/^(Dark|Light) mode on$/, (theme) => `${theme === 'Dark' ? 'डार्क' : 'लाइट'} मोड चालू`),
  exact('Screenshot saved', 'स्क्रीनशॉट सेव हो गया'),
  exact('Locking your PC', 'आपका पीसी लॉक कर रहा हूँ'),

  // Power and recycle bin confirmations
  exact('Shut down this PC?', 'क्या इस पीसी को बंद कर दूँ?'),
  exact('Restart this PC?', 'क्या इस पीसी को रीस्टार्ट कर दूँ?'),
  exact('Put this PC to sleep?', 'क्या इस पीसी को स्लीप में डाल दूँ?'),
  exact('Shut down your PC? Please confirm', 'क्या आपका पीसी बंद कर दूँ? कृपया पुष्टि कीजिए'),
  exact('Restart your PC? Please confirm', 'क्या आपका पीसी रीस्टार्ट कर दूँ? कृपया पुष्टि कीजिए'),
  exact(
    'Put your PC to sleep? Please confirm',
    'क्या आपका पीसी स्लीप में डाल दूँ? कृपया पुष्टि कीजिए',
  ),
  pattern(
    /^Your PC (shuts down|restarts|goes to sleep) (\d+) seconds after you confirm\. You can cancel during the countdown$/,
    (verb, seconds) => {
      const action =
        verb === 'shuts down'
          ? 'बंद हो जाएगा'
          : verb === 'restarts'
            ? 'रीस्टार्ट हो जाएगा'
            : 'स्लीप में चला जाएगा';
      return `पुष्टि करने के ${seconds} सेकंड बाद आपका पीसी ${action}। उलटी गिनती के दौरान आप इसे रद्द कर सकते हैं`;
    },
  ),
  exact('Shut down', 'बंद करें'),
  exact('Restart', 'रीस्टार्ट करें'),
  exact('Sleep', 'स्लीप में डालें'),
  exact('Empty the Recycle Bin?', 'क्या रीसायकल बिन खाली कर दूँ?'),
  exact(
    "Everything in it is deleted for good. This can't be undone",
    'इसमें मौजूद सब कुछ हमेशा के लिए हट जाएगा। इसे वापस नहीं किया जा सकता',
  ),
  exact(
    "Empty the Recycle Bin? This can't be undone",
    'क्या रीसायकल बिन खाली कर दूँ? इसे वापस नहीं किया जा सकता',
  ),
  exact('Empty Recycle Bin', 'रीसायकल बिन खाली करें'),

  // Assistant
  exact('Circle to Search', 'सर्कल टू सर्च'),
  exact('Nothing to repeat yet', 'अभी दोहराने के लिए कुछ नहीं है'),
  exact('Ask me something first', 'पहले मुझसे कुछ पूछिए'),
  exact("I haven't said anything yet", 'मैंने अभी तक कुछ कहा ही नहीं है'),
  exact('Saying that again', 'इसे दोबारा बोल रहा हूँ'),
  exact('Dictation', 'डिक्टेशन'),
  exact(
    'Speak and I will type it where your cursor is',
    'बोलिए, मैं उसे वहीं टाइप कर दूँगा जहाँ आपका कर्सर है',
  ),
  exact('Press the hotkey or Esc to stop', 'रोकने के लिए हॉटकी या Esc दबाइए'),
  exact(
    'Circle, scribble or tap anything on your screen',
    'अपनी स्क्रीन पर किसी भी चीज़ को घेरिए, उस पर लकीर खींचिए या टैप कीजिए',
  ),
  exact(
    "Here's what I can do",
    'मैं टाइमर, मौसम, नोट्स, ऐप खोलने, आवाज़ और ब्राइटनेस जैसे कई कामों में आपकी मदद कर सकता हूँ',
  ),
];

/** Spoken replies whose natural Hindi differs from the on-screen title. Matched with the final period. */
const SPEECH_PHRASES: readonly Phrase[] = [
  exact('Muted.', 'आवाज़ म्यूट कर दी।'),
  pattern(
    /^(Dark|Light) mode on\.$/,
    (theme) => `${theme === 'Dark' ? 'डार्क' : 'लाइट'} मोड चालू कर दिया।`,
  ),
  exact('Screenshot saved.', 'स्क्रीनशॉट सेव हो गया।'),
  exact('Locking your PC.', 'आपका पीसी लॉक कर रहा हूँ।'),
];

function translateWhole(text: string): string | null {
  for (const phrase of SPEECH_PHRASES) {
    const match = phrase.pattern.exec(text);
    if (match !== null) return phrase.build(...match.slice(1).map((part) => part ?? ''));
  }
  const ends = /[.?!]$/.exec(text)?.[0];
  const core = ends === '.' ? text.slice(0, -1) : text;
  for (const phrase of PHRASES) {
    const match = phrase.pattern.exec(core);
    if (match === null) continue;
    const parts = match.slice(1).map((part) => part ?? '');
    // A kept part that runs over a sentence boundary means the pattern swallowed two sentences.
    if (parts.some((part) => /[.?!]\s/.test(part))) continue;
    const hindi = phrase.build(...parts);
    return ends === '.' && !/[?!।]$/.test(hindi) ? `${hindi}।` : hindi;
  }
  return null;
}

/**
 * The Hindi of a title, detail, spoken reply or button label. A text of several sentences is
 * translated sentence by sentence (untranslatable ones stay in English); null when nothing in it
 * could be translated.
 */
export function translatePhrase(text: string): string | null {
  const whole = translateWhole(text);
  if (whole !== null) return whole;
  const sentences = text.split(/(?<=[.?!])\s+/);
  if (sentences.length < 2) return null;
  const parts = sentences.map((sentence) => translateWhole(sentence));
  if (parts.every((part) => part === null)) return null;
  return parts.map((part, index) => part ?? sentences[index] ?? '').join(' ');
}

/** "I couldn't <action>" and "Sorry, I couldn't <action>" for the actions that can fail. */
export function translateFailure(text: string): string | null {
  const match = /^(Sorry, )?I couldn't (.+?)(\.)?$/.exec(text);
  if (match === null) return null;
  const phrase = failedAction(match[2] ?? '');
  if (phrase === null) return null;
  const sentence = match[1] === undefined ? `मैं ${phrase}` : `माफ़ कीजिए, मैं ${phrase}`;
  return match[3] === undefined ? sentence : `${sentence}।`;
}
