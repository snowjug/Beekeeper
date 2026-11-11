/**
 * The Hindi / Hinglish concept vocabulary: every word the command rules care about, in Devanagari
 * (with the spellings speech recognisers produce) and in Latin script.
 *
 * Each entry is [SYMBOL(=payload), "spellings"]. Spellings are separated by spaces and `_` joins the
 * words of a phrase. Prefix `!` = phonetic-key match without typo tolerance, `!!` = exact spelling
 * only (for short words that would collide with another word under the phonetic key).
 */
export type VocabularyEntry = readonly [symbol: string, spellings: string];

/** Words with no meaning of their own for a command; the lexer drops them. */
const FILLERS: readonly VocabularyEntry[] = [
  [
    'FILLER',
    '!!कृपया !प्लीज़ !ज़रा !जरा !जी !अच्छा !हेलो !हैलो !हाय !अरे !सुनो !सुनिए !सुनिये !बीकीपर ' +
      '!!तो !!ही !!भी !!ना !ज़रा_सा !जरा_सा !please !pls !plz !zara !!अ !!एन !!a !!an !!the ' +
      '!ji !accha !acha !toh !hi !hello !hey !okay !ok !beekeeper !bee_keeper !!द !!दि !!yaar !!yar ' +
      '!!bhai !!bhaiya !!bro !!boss !!arre !!arey !!oye !!यार !!भाई !!भैया !!ओए',
  ],
];

const GRAMMAR: readonly VocabularyEntry[] = [
  [
    'WHAT',
    '!!क्या !!kya !!kia !!kyaa !!व्हाट !!व्हॉट !!वाट !!वॉट !!व्हाट्स !!वाट्स !!what !!whats',
  ],
  ['HOW', '!कैसा !कैसी !कैसे !kaisa !kaisi !kaise !kesa !kese !kaisaa'],
  ['HOWMUCH', 'कितना कितनी कितने कितनों kitna kitni kitne kitnaa'],
  ['WHEN', '!!कब !!kab'],
  ['WHICH', 'कौनसा कौनसी कौनसे कौन_सा कौन_सी कौन_से kaunsa kaunsi kaunse kaun_sa kaun_si konsa'],
  ['WHO', '!!कौन !!kaun !!kon'],
  ['WHERE', '!!कहाँ !!कहां !!kahan !!kaha'],
  [
    'BE',
    '!!है !!हैं !!हें !!हूँ !!हूं !!हो !!hai !!hain !!hun !!ho !!hein !!इज़ !!इज !!आर !!is !!are',
  ],
  ['WENT', '!!गए !!गये !!गया !!गई !!गयी !!gaye !!gaya !!gayi'],
  [
    'FUT',
    '!होगा !होगी !होंगे !होगें !रहेगा !रहेगी !रहेंगे !हो_सकता !हो_सकती !hoga !hogi !honge !rahega ' +
      '!rahegi !rahenge !निकलेगी !निकलेगा !निकलेंगे !पड़ेगी !पड़ेगा !पड़ेंगी !चलेगी !चलेगा !चलेंगे ' +
      '!nikalegi !padegi !chalegi',
  ],
  ['PAST', '!!था !!थी !!थे !!थीं !!tha !!thi'],
  [
    'HOTA',
    '!!हुआ !!हुई !!हुए !!हुयी !!होता !!होती !!होते !!होने !!रहा !!रही !!रहे !!hua !!hui !!hue !!hota ' +
      '!!hoti !!hote !!raha !!rahi !!rahe',
  ],
  ['KA', '!!का !!की !!के !!कि !!ka !!kaa !!ki !!kee !!ke'],
  ['KO', '!!को !!ko'],
  ['IN', '!!में !!मे !!mein !!men !!mai !!me !!in !!इन'],
  ['I', '!!मैं !!main'],
  ['ON', '!!पर !!पे !!par !!pe !!pr'],
  ['FROM', '!!से !!se'],
  ['TILL', '!!तक !!tak'],
  ['FOR', '!लिए !लिये !liye !lie !ke_liye !के_लिए !के_लिये !के_वास्ते !!फॉर !!फार !!for'],
  ['AFTER', '!बाद !बाद_में !baad !baad_me !baad_mein !bad_me'],
  ['BEFORE', '!पहले !pehle !pahle'],
  ['AND', '!!और !!एवं !!एंड !!aur !!avam !!and'],
  ['OR', '!!या !!ya'],
  ['WITH', '!!साथ !!saath !!sath'],
  ['ABOUT', '!के_बारे_में !के_बारे_मे !के_बारे !ke_bare_mein !ke_baare_mein !ke_bare_me'],
  [
    'THAT',
    '!!यह !!ये !!इस !!इसे !!इसको !!वह !!वो !!उस !!उसे !!उसको !!जो !!yeh !!ye !!ise !!isko !!woh !!wo !!jo',
  ],
  [
    'ALL',
    'सब सभी सारे सारी सारा सबको सबकुछ सब_कुछ sab sabhi saare sare saari saara all every everything',
  ],
  [
    'LAST',
    'आख़िरी आखिरी आखरी आख़री पिछला पिछली पिछले अंतिम ताज़ा ताजा akhiri aakhri pichla pichhla ' +
      'pichli last latest recent previous',
  ],
  ['NEW', '!नया !नयी !नई !नए !naya !nayi !naye !new'],
  ['NO', '!!नहीं !!नही !!नहिं !!मत !!nahi !!nahin !!nhi !!mat !!not'],
  [
    'YES',
    '!!हाँ !!हां !!हा !!हाँजी !!हांजी !!बिल्कुल !!बिलकुल !!ज़रूर !!जरूर !!yes !!haan !!han !!bilkul ' +
      '!!zaroor !जी_हाँ !जी_हां !जी_हा !ठीक_है !ठीक_हैं !ji_haan !theek_hai !thik_hai',
  ],
  ['CAN', '!सकता !सकती !सकते !सकूँ !सकूं !सकें !सकोगे !sakta !sakti !sakte !sakun'],
  ['WANT', '!चाहिए !चाहिये !चाहता !चाहती !चाहते !chahiye !chahta !chahti !chahte'],
  [
    'YOU',
    '!!आप !!तुम !!तू !!तुम्हें !!आपको !!तुमने !!आपने !!aap !!tum !!tu !!tumhe !!apko !!aapko !!tumne !!aapne',
  ],
  ['ME', '!!मुझे !!मुझको !!मुझ !!mujhe !!mujhko !!mujh !मेरे_लिए !mere_liye !!मी'],
  ['MY', '!!मेरा !!मेरी !!मेरे !!mera !!meri !!mere !!माय !!my'],
  ['OUTSIDE', '!बाहर !बाहरी !bahar !outside !outdoor !outdoors'],
  ['TURN', '!!टर्न !!turn'],
  ['LIKE', '!!लाइक !!like'],
  ['YOUR', '!!आपका !!आपकी !!आपके !!तुम्हारा !!तुम्हारी !!तुम्हारे !!aapka !!aapki !!tumhara'],
  ['NOW', '!!अभी !!अब !!फिलहाल !इस_समय !!abhi !!ab !!filhal'],
  ['HERE', 'यहाँ यहां यहीं मेरे_शहर शहर मेरे_यहाँ मेरे_यहां मेरे_इलाके इलाके yahan yaha here'],
  ['THODA', 'थोड़ा थोड़ी थोड़े थोड़ा_सा थोड़ी_सी थोड़ा_और thoda thodi thoda_sa thodi_si'],
  ['MAX', 'फुल फूल मैक्स मैक्सिमम पूरा पूरी पूरे full max maximum highest'],
  ['MINW', 'मिनिमम न्यूनतम minimum lowest'],
  [
    'AGAIN',
    'दोबारा दुबारा फिर_से फिरसे वापस एक_बार_फिर_से एक_बार_फिर dobara phir_se phirse wapas vapas',
  ],
  ['PUT', 'डालो डाल डालिए डाल_दो daalo dalo'],
  ['KEEP', 'रखो रखना रख रखिए रखें rakho rakhna rakh'],
  ['TODAY', '!!आज !!aaj !!aj !!today !!टुडे'],
  ['TOMORROW', '!!कल !!kal !!tomorrow !!tmrw !!टुमॉरो !!टुमारो !!टुमोरो'],
  ['DAYAFTER', '!परसों !परसो !parson !parso'],
  [
    'DO',
    'करो करें कीजिए कीजिये कीजिएगा करिए करिये करना करता करती करते करके !!कर !!kar !!kr karo kro ' +
      'karein kare kijiye kijiyega kariye karna',
  ],
  [
    'GIVE',
    '!!दो !!दीजिए !!दीजिये !!दीजिएगा !!दें !!दे !!देना !!do !!de !!dijiye !!dijiyega !!dena',
  ],
];

const TIME_AND_DAY: readonly VocabularyEntry[] = [
  ['TIME', 'समय टाइम वक्त वक़्त samay taim time waqt vakt'],
  ['DATE', 'तारीख तारीख़ तिथि डेट tareekh tarikh tithi date'],
  ['DAY', '!दिन !वार !डे !din !vaar !day'],
  ['BAJE', '!बजे !बजा !बजकर !बजके !baje !bajke !bajkar !baja !!बज !!बजी !!बजते !!baj !!bajte'],
  ['MORNING', 'सुबह सवेरे सवेरा सबेरे भोर subah subha savere morning'],
  ['NOON', 'दोपहर दुपहर दोपहरी dopahar dophar noon afternoon midday'],
  ['EVENING', 'शाम शाम_को sham shaam evening'],
  ['NIGHT', 'रात रात_को raat night'],
  ['MIDNIGHT', 'आधी_रात आधीरात midnight'],
  ['AMPM=am', '!!एएम !ए_एम !!am !a_m'],
  ['AMPM=pm', '!!पीएम !पी_एम !!pm !p_m'],
  ['WEEKEND', 'वीकेंड वीक_एंड सप्ताहांत weekend'],
  ['MIN', 'मिनट मिनिट मिनट्स मिनिट्स मिनटों minute minutes mins min minat minit'],
  ['HOUR', 'घंटा घंटे घण्टा घण्टे घंटों घन्टा घन्टे hour hours hrs hr ghanta ghante ghantaa'],
  ['SEC', 'सेकंड सेकेंड सेकण्ड सेकंड्स सेकेंड्स सेकण्ड्स second seconds secs sec sekand'],
  ['WEEK', 'हफ्ता हफ्ते हफ़्ता हफ़्ते सप्ताह हफ़्तों week weeks hafta hafte'],
  ['DAYU', 'दिनों days'],
  ['DAYW=monday', 'सोमवार सोम_वार somvar somwar monday'],
  ['DAYW=tuesday', 'मंगलवार मंगल_वार mangalvar mangalwar tuesday'],
  ['DAYW=wednesday', 'बुधवार बुध_वार budhvar budhwar wednesday'],
  ['DAYW=thursday', 'गुरुवार बृहस्पतिवार वीरवार guruvar brihaspativar veervar thursday'],
  ['DAYW=friday', 'शुक्रवार शुक्र_वार shukravar shukrawar friday'],
  ['DAYW=saturday', 'शनिवार शनि_वार shanivar shaniwar saturday'],
  ['DAYW=sunday', 'रविवार इतवार रवि_वार ravivar itvar itwar sunday'],
];

const WEATHER: readonly VocabularyEntry[] = [
  ['WEATHER', 'मौसम वेदर वैदर mausam mosam weather'],
  [
    'RAIN',
    'बारिश बरसात वर्षा बरसेगा बरसेगी बरसना बारिश_होना barish baarish barsaat barsat rain raining',
  ],
  ['WATER', '!पानी !pani !paani'],
  ['SNOW', 'बर्फ बर्फ़ बर्फबारी बर्फ़बारी हिमपात snow snowing barf'],
  ['HOT', 'गर्मी गरमी गर्म गरम garmi garam hot'],
  ['COLD', 'ठंड ठंडा ठंडी ठण्ड ठंडक सर्दी thand thandi thanda sardi cold'],
  ['TEMP', 'तापमान टेम्परेचर टेम्प्रेचर टेंपरेचर tapman taapmaan temperature temp'],
  ['UMBRELLA', 'छाता छतरी छाते chhata chhatri umbrella'],
  ['STORM', 'तूफान तूफ़ान आंधी आँधी storm toofan'],
  ['SUNNY', 'धूप धुप sunny dhoop'],
  ['CLOUDY', 'बादल बदली cloudy badal'],
  ['WINDY', 'हवा हवाएं windy hawa'],
  ['FORECAST', 'पूर्वानुमान फोरकास्ट फॉरकास्ट forecast'],
  ['CHANCE', 'संभावना सम्भावना चांस chance sambhavna'],
];

const PRODUCTIVITY: readonly VocabularyEntry[] = [
  ['TIMER', 'टाइमर टायमर टाइम्र टाईमर काउंटडाउन timer taimar countdown'],
  ['ALARM', 'अलार्म अलारम अलार्मे alarm alaram'],
  ['REMINDER', 'रिमाइंडर रिमाइन्डर रिमाईंडर reminder reminders'],
  ['REMINDV', 'रिमाइंड रिमाइन्ड रिमाईंड remind'],
  ['YAAD', '!याद !yaad !yad'],
  ['DILA', 'दिलाओ दिलाना दिला दिलाइए दिलाइये दिलाएं दिलाएँ दिलाऊँ dilao dilana dila dilaiye'],
  ['WAKE', 'उठाओ उठा उठाना जगाओ !!जगा जगाना wake uthao jagao'],
  ['NOTE', '!नोट !मेमो !note !memo !noat'],
  ['NOTES', 'नोट्स नोटों नोटस notes memos'],
  ['WRITE', 'लिखो लिख लिखिए लिखिये लिखें लिखना लिखकर likho likh write'],
  ['SAVE', 'सेव सेव_करो save'],
  ['LEFT', '!बची !बचा !बचे !बाकी !शेष !bacha !bachi !baki !left !remaining'],
  ['DER', '!देर !der'],
];

const COMPUTER: readonly VocabularyEntry[] = [
  ['VOLUME', 'आवाज़ आवाज आवाजें वॉल्यूम वाल्यूम वोल्यूम वॉल्युम वाल्युम awaaz awaz avaaz volume'],
  ['SOUND', 'साउंड साउण्ड ऑडियो ऑडिओ स्पीकर स्पीकर्स sound audio speaker speakers'],
  ['BRIGHT', 'ब्राइटनेस ब्राईटनेस ब्राइटनस रोशनी रौशनी चमक उजाला brightness roshni'],
  ['MUTE', 'म्यूट मूट म्युट mute'],
  ['UNMUTE', 'अनम्यूट अनमूट अनम्युट unmute'],
  ['DARK', 'डार्क dark'],
  ['LIGHTM', 'लाइट लाईट light'],
  ['MODE', 'मोड mode'],
  ['THEME', 'थीम theme'],
  [
    'PC',
    'कंप्यूटर कम्प्यूटर कंपयूटर कम्पूटर पीसी लैपटॉप लैपटाप लेपटॉप सिस्टम मशीन डेस्कटॉप ' +
      'computer laptop pc system desktop machine',
  ],
  ['SCREEN', 'स्क्रीन स्क्रिन screen'],
  ['SHUTDOWN', 'शटडाउन शट_डाउन शटडाऊन shutdown shut_down power_off पावर_ऑफ'],
  ['RESTART', 'रीस्टार्ट रिस्टार्ट रीबूट रिबूट restart reboot'],
  ['SLEEPM', 'स्लीप स्लिप हाइबरनेट स्टैंडबाय सुला सुलाओ सुला_दो sleep hibernate standby'],
  ['LOCK', 'लॉक लोक ताला lock'],
  ['BATTERY', 'बैटरी बेटरी battery batri'],
  ['CHARGE', 'चार्ज चार्जिंग चार्जर charge charging charger'],
  ['CPU', 'सीपीयू प्रोसेसर cpu processor'],
  ['RAM', 'रैम मेमोरी ram memory'],
  ['DISK', 'डिस्क स्टोरेज ड्राइव हार्ड_डिस्क disk storage drive ssd'],
  ['SPACE', 'जगह स्पेस space'],
  ['FREE', 'फ्री free'],
  ['USAGE', 'उपयोग इस्तेमाल यूसेज यूज़ usage !!use !!used'],
  [
    'INFO',
    'जानकारी इन्फो इनफो इन्फॉर्मेशन इनफॉर्मेशन स्पेक्स स्पेसिफिकेशन स्टेटस स्थिति हाल हालत info ' +
      'information specs status haal halat',
  ],
  ['SCREENSHOT', 'स्क्रीनशॉट स्क्रीन_शॉट स्क्रीनशाट स्क्रीनशॉर्ट screenshot screen_shot'],
  ['CAPTURE', 'कैप्चर कैप्चर capture'],
  ['PHOTO', 'फोटो फ़ोटो तस्वीर पिक्चर picture photo'],
  [
    'TAKE',
    '!!लो !!ले !!लीजिए !!लीजिये !!लें !!लेना !!लेलो !!खींचो !!खींच !!खींचिए !!lo !!le !ले_जाना ' +
      '!ले_जाऊँ !!टेक !!take',
  ],
  [
    'APPW',
    '!!ऐप !!एप !!ऐप्स !!एप्स !!साइट !ऐप्लिकेशन !एप्लीकेशन !एप्लिकेशन !ब्राउज़र !ब्राउजर !वेबसाइट ' +
      '!वेब_साइट !!app !!apps !!application !!browser !!website !!site',
  ],
  [
    'HOUSEHOLD',
    '!दरवाज़ा !दरवाजा !दरवाज़े !दरवाजे !दरवाज़ों !खिड़की !खिड़कियाँ !किवाड़ !फाटक !पर्दा !परदा !पर्दे ' +
      '!बोतल !डिब्बा !डब्बा !पैकेट !किताब !पुस्तक !दुकान !अलमारी !बक्सा !लिफाफा !!पंखा !!पंखे !!टीवी ' +
      '!!एसी !!बल्ब !!गीजर !!गैस !!नल !!door !!window !!gate !!bottle !!darwaza !!darwaje !!khidki ' +
      '!!pankha !!fan !!tv !!ac !!bulb !!geyser !!gas !!nal',
  ],
  ['MAKE', 'बनाओ बना बनाइए बनाइये बनाना बनाएँ बनाएं banao banana'],
  ['GO', '!जाओ !जा !जाइए !जाइये !jao !ja'],
  [
    'RECYCLE',
    'रीसायकल_बिन रिसाइकल_बिन रीसाइकिल_बिन रिसायकल_बिन रीसायकल रिसाइकल रीसाइकिल बिन ट्रैश कचरा कूड़ा ' +
      'कूड़ेदान कचरे कचरा_पेटी recycle_bin recycle bin trash',
  ],
  ['EMPTY', 'खाली ख़ाली साफ़ साफ सफाई क्लियर क्लीयर एम्प्टी clear empty saaf khali'],
  ['SETTINGS', 'सेटिंग सेटिंग्स सेटिंगस सेटिंग्ज़ settings setting'],
  [
    'WIFI',
    'वाईफाई वाई_फाई वाईफ़ाई वाइफाई वाई_फ़ाई वायफाई नेटवर्क इंटरनेट इन्टरनेट wifi wi_fi network internet wlan',
  ],
  ['BLUETOOTH', 'ब्लूटूथ ब्लू_टूथ ब्लूटुथ bluetooth blue_tooth'],
  ['DISPLAY', 'डिस्प्ले मॉनिटर रेज़ोल्यूशन रिज़ॉल्यूशन display monitor resolution'],
  ['HELP', 'मदद सहायता हेल्प help madad'],
  ['COMMANDS', 'कमांड कमांड्स कमांडस कमान्ड आदेश फीचर फीचर्स command commands features'],
  ['CIRCLE', 'सर्कल गोला circle'],
  ['CIRCLETOSEARCH', 'सर्कल_टू_सर्च सर्कल_टु_सर्च circle_to_search'],
  ['COPY', 'कॉपी कोपी copy नकल'],
  ['ANSWER', 'जवाब उत्तर जबाब रिप्लाई रिज़ल्ट रिजल्ट परिणाम नतीजा answer reply result'],
  ['GREET', 'सुप्रभात गुड_मॉर्निंग गुड_मोर्निंग गुड_मार्निंग गुड_मॉर्निग suprabhat good_morning'],
  ['BRIEFING', 'ब्रीफिंग ब्रिफिंग ब्रीफ़िंग briefing brief'],
  ['REPEAT', 'दोहराओ दोहराइए दोहराना दोहरा रिपीट dohrao dohrana repeat'],
  ['DICTATE', 'डिक्टेशन डिक्टेट डिक्टेटिंग डिक्टेशन_मोड डिक्टेट_मोड dictation dictate dictating'],
  ['TYPE', '!टाइप !टाइपिंग !type !typing'],
  ['VOICE', '!वॉइस !वॉयस !वायस !voice'],
];

const VERBS: readonly VocabularyEntry[] = [
  [
    'OPEN',
    'खोलो खोलिए खोलिये खोलें खोल खोलना खोलकर खोलियेगा खोलिएगा ओपन ओपेन लॉन्च लांच लॉंच ' +
      'kholo kholiye kholiyega kholein khol kholna open launch',
  ],
  [
    'SET',
    'लगाओ लगा लगाइए लगाइये लगाएँ लगाएं लगाना लगाइएगा सेट सैट lagao laga lagaiye lagana lagaye ' +
      'lagayen set',
  ],
  [
    'START',
    'शुरू शुरु शुरूआत शुरुआत चालू चालु आरंभ स्टार्ट ऑन !!on shuru shuroo shuruat start chalu chaalu begin',
  ],
  [
    'PLAY',
    'चलाओ चला चलाइए चलाइये चलाएँ चलाएं चलाना बजाओ बजाइए बजाइये बजाना प्ले सुनाओ सुनाइए सुना ' +
      'सुनाना chalao chala chalaiye chalana bajao play sunao',
  ],
  [
    'OFF',
    '!बंद !बन्द !band !bandh !bnd !ऑफ !off !क्लोज़ !क्लोज !close !क्विट !quit !एग्जिट !एग्ज़िट !exit !किल !kill',
  ],
  [
    'INC',
    'बढ़ाओ बढ़ा बढ़ाइए बढ़ाइये बढ़ाएँ बढ़ाएं बढ़ाना बढ़ाओगे ज़्यादा ज्यादा अधिक तेज़ तेज ऊँचा ऊंचा ऊपर ऊँची ऊंची ' +
      'अप बूस्ट increase raise boost up higher badhao badha badhaiye badhana zyada jyada tez upar oopar',
  ],
  [
    'DEC',
    'घटाओ घटा घटाइए घटाइये घटाएँ घटाएं घटाना कम कमी धीमा धीमी धीमे धीरे नीचे डाउन डिक्रीज़ ghatao ghata ' +
      'ghatana kam dheema dheere dhire niche neeche down decrease lower reduce',
  ],
  [
    'TELL',
    'बताओ बताइए बताइये बता बताना बताएँ बताएं बताइएगा बताईये बतलाओ बोलो दिखाओ दिखा दिखाइए दिखाइये दिखाना ' +
      'दिखाएँ दिखाएं दिखाईये दिखादो देखो देखना देखें देखिए चेक पढ़ो पढ़कर पढ़ना पढ़िए पढ़ें पढ़ ' +
      'batao bata bataiye batana dikhao dikha dikhaiye dikhana dekho dekhna check show tell read',
  ],
  [
    'SAY',
    '!बोल !बोलना !कह !कहना !कहो !कहें !bol !bolna !kehna !kah !!कहा !!बोला !!बोलूँ !!बोलूं !!कहूँ !!कहूं !!बोलकर !!बोलके !!bolkar',
  ],
  [
    'DEL',
    'हटाओ हटा हटाइए हटाइये हटाएँ हटाएं हटाना मिटाओ मिटा मिटाइए मिटाना मिटाएँ डिलीट डीलीट रिमूव इरेज़ ' +
      'hatao hata hatana mitao mita delete remove erase',
  ],
  ['CANCEL', 'रद्द रद रदद कैंसल कैन्सल कैंसिल निरस्त cancel'],
  [
    'SEARCH',
    'सर्च खोज खोजो खोजिए खोजें ढूंढो ढूँढो ढूँढ़ो ढूंढ ढूँढ तलाश search find lookup khojo dhundo',
  ],
  ['CALC', 'कैलकुलेट कैल्कुलेट कैलक्युलेट गणना हिसाब निकालो निकाल सॉल्व calculate calc solve'],
  ['CONVERT', 'कन्वर्ट रूपांतरित convert'],
  ['CHANGE', '!!बदल बदलो बदलिए चेंज टॉगल स्विच toggle switch change badlo'],
  ['STOPW', 'रुको रुक रोको रोक स्टॉप स्टाप बस ruko ruk roko stop bas'],
  ['QUIET', 'चुप शांत ख़ामोश खामोश chup shant quiet'],
  [
    'NEVERMIND',
    'रहने_दो छोड़ो छोड़_दो जाने_दो भूल_जाओ कोई_बात_नहीं नेवर_माइंड नेवरमाइंड कुछ_नहीं rehne_do ' +
      'chhodo koi_baat_nahi nevermind never_mind',
  ],
];

/** Calculator, dictionary and web-address words. */
const MATH: readonly VocabularyEntry[] = [
  ['PLUS', 'जमा जोड़ जोड़ो जोड़ें जोड़ना प्लस ऐड jama jod plus add'],
  ['MINUS', 'माइनस ऋण घटाव minus'],
  ['TIMES', 'गुणा गुना मल्टीप्लाई मल्टिप्लाई ज़रब guna gunaa times multiply into !!x'],
  ['DIV', 'भाग भागा विभाजित डिवाइड डिवाइडेड bhag divide divided'],
  ['PERCENT', 'प्रतिशत परसेंट पर्सेंट फीसदी फ़ीसदी फीसद percent'],
  ['EQUALS', 'बराबर इक्वल इक्वल्स barabar equals'],
  ['SQRT', 'वर्गमूल वर्ग_मूल स्क्वायर_रूट स्क्वेयर_रूट square_root sqrt'],
  ['CBRT', 'घनमूल घन_मूल क्यूब_रूट cube_root'],
  ['SQUARE', 'वर्ग स्क्वायर स्क्वेयर square squared'],
  ['CUBE', 'घन क्यूब cube cubed'],
  ['POWER', 'घात पावर power'],
  ['MEANING', 'मतलब अर्थ मीनिंग matlab arth meaning'],
  ['WORD', 'शब्द shabd'],
  ['DOT=.com', 'डॉट_कॉम डोट_कॉम dot_com'],
  ['DOT=.org', 'डॉट_ओआरजी डॉट_ऑर्ग dot_org'],
  ['DOT=.in', 'डॉट_इन dot_in'],
  ['DOT=.net', 'डॉट_नेट dot_net'],
];

/** Units the converter understands; the payload is a name lib/units accepts. */
const UNITS: readonly VocabularyEntry[] = [
  [
    'UNIT=kilometers',
    'किलोमीटर किमी किलो_मीटर कि_मी kilometer kilometers kilometre kilometres !!km !!kms',
  ],
  ['UNIT=meters', 'मीटर मीटर्स meter meters metre metres'],
  ['UNIT=centimeters', 'सेंटीमीटर सेन्टीमीटर सेमी सेंटी_मीटर centimeter centimeters !!cm'],
  ['UNIT=millimeters', 'मिलीमीटर मिलि_मीटर मिमी millimeter millimeters !!mm'],
  ['UNIT=miles', 'मील मीलों miles mile'],
  ['UNIT=feet', 'फुट फीट फ़ुट foot feet !!ft'],
  ['UNIT=inches', 'इंच इंचों इन्च inch inches'],
  ['UNIT=yards', 'गज यार्ड yard yards'],
  [
    'UNIT=kilograms',
    'किलोग्राम किलो केजी किलोग्राम्स किलोग्रैम kilogram kilograms kilo kilos !!kg',
  ],
  ['UNIT=grams', 'ग्राम ग्रैम ग्राम्स gram grams'],
  ['UNIT=milligrams', 'मिलीग्राम मिलिग्राम milligram milligrams !!mg'],
  ['UNIT=pounds', 'पाउंड पौंड पाउण्ड pound pounds !!lb !!lbs'],
  ['UNIT=ounces', 'औंस आउंस ounce ounces !!oz'],
  ['UNIT=tonnes', 'टन tonne tonnes ton tons'],
  [
    'UNIT=celsius',
    'सेल्सियस सेल्सीयस सेंटीग्रेड डिग्री_सेल्सियस डिग्री_सेल्सीयस celsius centigrade',
  ],
  [
    'UNIT=fahrenheit',
    'फ़ारेनहाइट फारेनहाइट फैरनहाइट फारेनहीट फॉरेनहाइट डिग्री_फारेनहाइट डिग्री_फ़ारेनहाइट fahrenheit farenheit',
  ],
  ['UNIT=kelvin', 'केल्विन केलविन kelvin'],
  ['UNIT=bytes', 'बाइट बाइट्स byte bytes'],
  ['UNIT=kb', 'किलोबाइट किलो_बाइट केबी !!kb kilobyte kilobytes'],
  ['UNIT=mb', 'मेगाबाइट मेगा_बाइट एमबी !!mb megabyte megabytes'],
  ['UNIT=gb', 'गीगाबाइट गीगा_बाइट जीबी !!gb gigabyte gigabytes'],
  ['UNIT=tb', 'टेराबाइट टेरा_बाइट टीबी !!tb terabyte terabytes'],
];

export const VOCABULARY: readonly VocabularyEntry[] = [
  ...FILLERS,
  ...GRAMMAR,
  ...TIME_AND_DAY,
  ...WEATHER,
  ...PRODUCTIVITY,
  ...COMPUTER,
  ...VERBS,
  ...MATH,
  ...UNITS,
];
