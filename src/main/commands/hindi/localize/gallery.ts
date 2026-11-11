/**
 * The command gallery ("what can you do") in Hindi: group and command names, and example phrases a
 * Hindi speaker can say. Every example is understood by the Hindi normaliser (a test checks this),
 * because the gallery's example chips send them back to the assistant.
 */
export interface GalleryEntry {
  title: string;
  examples: readonly string[];
}

export const GALLERY_GROUPS: Readonly<Record<string, string>> = {
  'Apps & web': 'ऐप्स और वेब',
  Info: 'जानकारी',
  Productivity: 'उत्पादकता',
  System: 'सिस्टम',
  Assistant: 'असिस्टेंट',
};

/** Keyed by the English command title. */
export const GALLERY_COMMANDS: Readonly<Record<string, GalleryEntry>> = {
  'Open an app': {
    title: 'ऐप खोलना',
    examples: ['नोटपैड खोलो', 'क्रोम खोलो', 'व्हाट्सएप खोलो'],
  },
  'Close an app': {
    title: 'ऐप बंद करना',
    examples: ['क्रोम बंद करो', 'नोटपैड बंद करो', 'स्पॉटिफाई बंद करो'],
  },
  'Search the web': {
    title: 'वेब पर खोजना',
    examples: [
      'गूगल पर बिरयानी की रेसिपी सर्च करो',
      'पायथन ट्यूटोरियल सर्च करो',
      'बिंग पर मौसम सर्च करो',
    ],
  },
  'Play on YouTube': {
    title: 'यूट्यूब पर चलाना',
    examples: [
      'यूट्यूब पर लोफी म्यूजिक चलाओ',
      'यूट्यूब पर पुराने गाने लगाओ',
      'यूट्यूब पर बिल्ली के वीडियो सर्च करो',
    ],
  },
  'Open a website': {
    title: 'वेबसाइट खोलना',
    examples: ['github.com खोलो', 'गूगल डॉट कॉम खोलो', 'wikipedia.org खोलो'],
  },
  'Time & date': {
    title: 'समय और तारीख',
    examples: ['समय क्या हुआ है', 'आज की तारीख क्या है', 'टोक्यो में समय क्या हुआ है'],
  },
  Weather: {
    title: 'मौसम',
    examples: ['मौसम कैसा है', 'मुंबई में मौसम कैसा है', 'कल बारिश होगी क्या'],
  },
  Battery: {
    title: 'बैटरी',
    examples: ['बैटरी कितनी बची है', 'क्या लैपटॉप चार्ज हो रहा है', 'बैटरी चेक करो'],
  },
  'System info': {
    title: 'सिस्टम की जानकारी',
    examples: ['सिस्टम की जानकारी दिखाओ', 'कितनी रैम है', 'कंप्यूटर कब से चालू है'],
  },
  Calculator: {
    title: 'कैलकुलेटर',
    examples: ['5 गुणा 6 कितना होता है', '2400 का 15 प्रतिशत', '144 का वर्गमूल निकालो'],
  },
  'Unit converter': {
    title: 'इकाई बदलना',
    examples: [
      '10 किलोमीटर कितने मील हैं',
      '5 किलो कितने पाउंड होते हैं',
      '100 फ़ारेनहाइट को सेल्सियस में बदलो',
    ],
  },
  Dictionary: {
    title: 'शब्दकोश',
    examples: [
      'serendipity का मतलब क्या है',
      'ephemeral का मतलब बताओ',
      'resilient का मतलब क्या है',
    ],
  },
  Timers: {
    title: 'टाइमर',
    examples: ['5 मिनट का टाइमर लगाओ', 'आधे घंटे का टाइमर लगाओ', 'टाइमर रद्द करो'],
  },
  Reminders: {
    title: 'रिमाइंडर',
    examples: [
      'मुझे शाम 6 बजे दूध लाने की याद दिलाना',
      '10 मिनट में मुझे चाय बनाने की याद दिलाओ',
      'मेरे रिमाइंडर दिखाओ',
    ],
  },
  Alarms: {
    title: 'अलार्म',
    examples: ['कल सुबह सात बजे का अलार्म लगाओ', 'मुझे सुबह 6 बजे उठा देना', 'अलार्म रद्द करो'],
  },
  Notes: {
    title: 'नोट्स',
    examples: ['नोट करो कि दूध लाना है', 'मेरे नोट्स दिखाओ', 'आख़िरी नोट हटाओ'],
  },
  'Copy that': {
    title: 'कॉपी करना',
    examples: ['इसे कॉपी करो', 'जवाब कॉपी करो', 'कॉपी कर लो'],
  },
  Volume: {
    title: 'आवाज़',
    examples: ['आवाज़ बढ़ाओ', 'आवाज़ 50 करो', 'म्यूट करो'],
  },
  Brightness: {
    title: 'ब्राइटनेस',
    examples: ['ब्राइटनेस बढ़ाओ', 'ब्राइटनेस 70 प्रतिशत करो', 'स्क्रीन की चमक कम करो'],
  },
  Screenshot: {
    title: 'स्क्रीनशॉट',
    examples: ['स्क्रीनशॉट लो', 'स्क्रीन कैप्चर करो', 'स्क्रीन का फोटो लो'],
  },
  'Lock the PC': {
    title: 'पीसी लॉक करना',
    examples: ['कंप्यूटर लॉक करो', 'स्क्रीन लॉक करो', 'लैपटॉप लॉक कर दो'],
  },
  'Windows settings': {
    title: 'विंडोज़ सेटिंग्स',
    examples: ['वाईफाई सेटिंग्स खोलो', 'ब्लूटूथ सेटिंग्स खोलो', 'साउंड सेटिंग्स खोलो'],
  },
  'Empty the Recycle Bin': {
    title: 'रीसायकल बिन खाली करना',
    examples: ['रीसायकल बिन खाली करो', 'कचरा खाली करो', 'ट्रैश साफ़ करो'],
  },
  'Shut down, restart or sleep': {
    title: 'बंद, रीस्टार्ट या स्लीप',
    examples: ['कंप्यूटर बंद करो', 'पीसी रीस्टार्ट करो', 'कंप्यूटर को स्लीप मोड में डालो'],
  },
  'Dark mode': {
    title: 'डार्क मोड',
    examples: ['डार्क मोड चालू करो', 'लाइट मोड चालू करो', 'डार्क मोड बदलो'],
  },
  'Circle to Search': {
    title: 'सर्कल टू सर्च',
    examples: ['सर्कल टू सर्च', 'स्क्रीन पर सर्च करो', 'स्क्रीन पर क्या है'],
  },
  'Settings & help': {
    title: 'सेटिंग्स और मदद',
    examples: ['सेटिंग्स खोलो', 'तुम क्या कर सकते हो', 'कमांड दिखाओ'],
  },
  Stop: {
    title: 'रोकना',
    examples: ['रुको', 'रहने दो', 'चुप हो जाओ'],
  },
  'Daily briefing': {
    title: 'दैनिक ब्रीफ़िंग',
    examples: ['गुड मॉर्निंग', 'मेरी ब्रीफ़िंग सुनाओ', 'आज का दिन कैसा रहेगा'],
  },
  Repeat: {
    title: 'दोहराना',
    examples: ['इसे दोहराओ', 'फिर से बोलो', 'तुमने क्या कहा'],
  },
  Dictation: {
    title: 'डिक्टेशन',
    examples: ['डिक्टेशन शुरू करो', 'वॉइस टाइपिंग', 'मैं जो बोलूँ वो टाइप करो'],
  },
};
