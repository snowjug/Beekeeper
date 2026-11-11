/**
 * Apps and websites as Hindi speakers say them ("क्रोम", "व्हाट्सएप", "यूट्यूब"); the payload is the
 * English name the open-app / close-app matchers and the app index know.
 */
import type { VocabularyEntry } from './vocabulary';

export const APPS: readonly VocabularyEntry[] = [
  // Windows apps
  ['APP=chrome', 'क्रोम क्रॉम गूगल_क्रोम गुगल_क्रोम chrome google_chrome'],
  ['APP=edge', 'एज माइक्रोसॉफ्ट_एज एज_ब्राउज़र एज_ब्राउजर microsoft_edge ms_edge'],
  ['APP=firefox', 'फायरफॉक्स फ़ायरफ़ॉक्स फायरफाक्स फायर_फॉक्स फ़ायर_फ़ॉक्स firefox fire_fox'],
  ['APP=teams', 'टीम्स माइक्रोसॉफ्ट_टीम्स एमएस_टीम्स teams microsoft_teams'],
  ['APP=outlook', 'आउटलुक आउटलुक outlook'],
  ['APP=spotify', 'स्पॉटिफाई स्पोटिफाई स्पॉटिफ़ाई स्पोटिफ़ाई स्पॉटिफ़ाय spotify'],
  ['APP=word', 'वर्ड माइक्रोसॉफ्ट_वर्ड एमएस_वर्ड ms_word microsoft_word'],
  ['APP=excel', 'एक्सेल एक्सल माइक्रोसॉफ्ट_एक्सेल एमएस_एक्सेल excel ms_excel'],
  [
    'APP=powerpoint',
    'पावरपॉइंट पावर_पॉइंट पावरपोइंट पावर_पोइंट पीपीटी powerpoint power_point !!ppt',
  ],
  ['APP=onenote', 'वननोट वन_नोट onenote one_note'],
  ['APP=terminal', 'टर्मिनल विंडोज़_टर्मिनल terminal windows_terminal'],
  ['APP=command prompt', 'कमांड_प्रॉम्प्ट कमांड_प्रोम्प्ट सीएमडी cmd command_prompt'],
  ['APP=powershell', 'पावरशेल पावर_शेल पॉवरशेल पावरशैल powershell power_shell'],
  ['APP=paint', 'पेंट पेन्ट एमएस_पेंट paint ms_paint'],
  ['APP=snipping tool', 'स्निपिंग_टूल स्निपिंग snipping_tool snip'],
  ['APP=control panel', 'कंट्रोल_पैनल कण्ट्रोल_पैनल control_panel'],
  ['APP=store', 'स्टोर माइक्रोसॉफ्ट_स्टोर ऐप_स्टोर store microsoft_store'],
  ['APP=regedit', 'रेजिस्ट्री_एडिटर रजिस्ट्री_एडिटर रेगएडिट regedit registry_editor'],
  [
    'APP=visual studio code',
    'विज़ुअल_स्टूडियो_कोड विजुअल_स्टूडियो_कोड वीएस_कोड वी_एस_कोड विज़ुअल_स्टूडियो विजुअल_स्टूडियो ' +
      'vs_code vscode visual_studio_code visual_studio',
  ],
  [
    'APP=file explorer',
    'फाइल_एक्सप्लोरर फ़ाइल_एक्सप्लोरर फाइल_एक्सप्लोरर एक्सप्लोरर फाइल_मैनेजर फाइल्स file_explorer explorer ' +
      'file_manager',
  ],
  ['APP=task manager', 'टास्क_मैनेजर टास्क_मेनेजर task_manager'],
  ['APP=notepad', 'नोटपैड नोटपेड नोट_पैड नोटपैड notepad note_pad'],
  ['APP=calculator', 'कैलकुलेटर कैल्कुलेटर कैलक्युलेटर कैलकुलेटर calculator'],
  ['APP=camera', 'कैमरा कैमेरा camera'],
  ['APP=photos', 'फोटोज़ फ़ोटोज़ फोटोज photos'],
  ['APP=clock', 'क्लॉक clock'],
  // Websites
  ['APP=youtube', 'यूट्यूब यूटयूब यू_ट्यूब यूट्यूब यूटूब youtube you_tube'],
  ['APP=gmail', 'जीमेल जी_मेल gmail'],
  ['APP=github', 'गिटहब गिथब गिट_हब गिटहब github'],
  ['APP=reddit', 'रेडिट रेड्डिट reddit'],
  ['APP=twitter', 'ट्विटर ट्वीटर twitter'],
  ['APP=facebook', 'फेसबुक फ़ेसबुक फेस_बुक facebook'],
  ['APP=instagram', 'इंस्टाग्राम इन्स्टाग्राम इंस्टा instagram insta'],
  ['APP=netflix', 'नेटफ्लिक्स नेटफ़्लिक्स netflix'],
  ['APP=amazon', 'अमेज़न अमेजन अमेज़ॉन amazon'],
  ['APP=linkedin', 'लिंक्डइन लिंक्डिन लिंकडिन लिंकडइन लिंक्ड_इन linkedin linked_in'],
  ['APP=wikipedia', 'विकिपीडिया विकीपीडिया wikipedia'],
  ['APP=stack overflow', 'स्टैक_ओवरफ्लो स्टैकओवरफ़्लो स्टैक_ओवरफ़्लो stack_overflow'],
  ['APP=chatgpt', 'चैटजीपीटी चैट_जीपीटी चैट_जी_पी_टी चैटजी_पी_टी chatgpt chat_gpt'],
  ['APP=google', 'गूगल गुगल google'],
  ['APP=bing', 'बिंग bing'],
  ['APP=google maps', 'गूगल_मैप्स गूगल_मैप गूगल_मैप्स google_maps'],
  ['APP=google drive', 'गूगल_ड्राइव google_drive'],
  ['APP=google docs', 'गूगल_डॉक्स गूगल_डॉक google_docs'],
  ['APP=google calendar', 'गूगल_कैलेंडर गूगल_कैलेण्डर google_calendar'],
  ['APP=google translate', 'गूगल_ट्रांसलेट गूगल_ट्रान्सलेट google_translate'],
  ['APP=twitch', 'ट्विच twitch'],
  ['APP=tiktok', 'टिकटॉक टिक_टॉक tiktok tik_tok'],
  ['APP=pinterest', 'पिंटरेस्ट pinterest'],
  ['APP=hacker news', 'हैकर_न्यूज़ हैकर_न्यूज hacker_news'],
  ['APP=duckduckgo', 'डकडकगो डक_डक_गो duckduckgo duck_duck_go'],
  // Other popular apps (opened by name through the Start menu)
  [
    'APP=whatsapp',
    'व्हाट्सएप व्हाट्सऐप व्हाट्सअप वॉट्सएप वाट्सएप वाट्सऐप वॉट्सऐप व्हाट्स_एप व्हाट्सएप्प व्हाट्सऐप्प ' +
      'whatsapp whats_app',
  ],
  ['APP=telegram', 'टेलीग्राम टेलिग्राम टेलेग्राम telegram'],
  ['APP=zoom', 'ज़ूम जूम zoom'],
  ['APP=slack', 'स्लैक स्लेक slack'],
  ['APP=discord', 'डिस्कॉर्ड डिस्कोर्ड discord'],
  ['APP=vlc', 'वीएलसी वी_एल_सी vlc'],
  ['APP=skype', 'स्काइप स्काईप skype'],
  ['APP=steam', 'स्टीम steam'],
  ['APP=photoshop', 'फोटोशॉप फ़ोटोशॉप फोटोशाप photoshop'],
  ['APP=brave', 'ब्रेव brave'],
  ['APP=opera', 'ओपेरा opera'],
  ['APP=notion', 'नोशन notion'],
  ['APP=figma', 'फिग्मा figma'],
  ['APP=postman', 'पोस्टमैन postman'],
  ['APP=hotstar', 'हॉटस्टार हॉट_स्टार hotstar'],
  ['APP=canva', 'कैनवा canva'],
];
