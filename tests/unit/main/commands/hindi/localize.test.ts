import { describe, expect, it, vi } from 'vitest';
import type { Card, CommandResult, WeatherCard } from '@shared/cards';
import { allCommands } from '@main/commands';
import { localizeResult } from '@main/commands/hindi';
import type { NotesService, TimerRecord, TimersService } from '@main/commands/types';
import type { SystemApi } from '@main/system/types';
import {
  createFakeServices,
  NOW,
  sampleForecast,
  SAMPLE_SYSTEM_INFO,
  type FakeServices,
} from '../helpers';
import { converse } from './support';

function fakes(overrides: Partial<FakeServices> = {}): FakeServices {
  return createFakeServices(allCommands, overrides);
}

function system(overrides: Partial<SystemApi>): FakeServices['system'] {
  return { ...fakes().system, ...overrides };
}

function record(overrides: Partial<TimerRecord> = {}): TimerRecord {
  return {
    id: 'timer-1',
    type: 'timer',
    label: 'Timer',
    durationMs: 300_000,
    startedAt: NOW.getTime(),
    endsAt: NOW.getTime() + 270_000,
    state: 'running',
    ...overrides,
  };
}

function timersWith(records: TimerRecord[]): TimersService {
  return {
    startTimer: vi.fn(() => record()),
    schedule: vi.fn(() => record()),
    list: () => records,
    cancel: () => true,
    cancelAll: () => records.length,
    onFire: () => () => undefined,
  };
}

const NOTE = { id: 'note-1', text: 'दूध लाना है', createdAt: NOW.getTime() };

function notesWith(texts: string[]): NotesService {
  const notes = texts.map((text, index) => ({ ...NOTE, id: `note-${index}`, text }));
  return {
    add: vi.fn(() => NOTE),
    list: () => ({ notes, total: notes.length }),
    deleteLast: () => notes[0] ?? null,
    clear: () => notes.length,
  };
}

function card<K extends Card['kind']>(result: CommandResult, kind: K): Extract<Card, { kind: K }> {
  const found = result.cards.find((candidate) => candidate.kind === kind);
  if (found === undefined) throw new Error(`no ${kind} card`);
  return found as Extract<Card, { kind: K }>;
}

async function speech(text: string, services: FakeServices = fakes()): Promise<string | undefined> {
  return (await converse(text, services)).hindi.speech;
}

describe('time and date', () => {
  it('says the time, the date and the day', async () => {
    expect(await speech('समय क्या हुआ है')).toBe('अभी दोपहर 3:42 बजे हैं।');
    expect(await speech('आज की तारीख क्या है')).toBe('आज मंगलवार, 10 नवंबर 2026 है।');
    expect(await speech('आज कौन सा दिन है')).toBe('आज मंगलवार है।');
  });

  it('names the place and keeps the card', async () => {
    const { english, hindi } = await converse('टोक्यो में समय क्या हुआ है');
    expect(hindi.speech).toMatch(/^Tokyo में अभी (सुबह|दोपहर|शाम|रात) \d{1,2}:\d{2} बजे हैं।$/);
    const time = card(hindi, 'time');
    expect(time.id).toBe(card(english, 'time').id);
    expect(time.dateText).toBe('मंगलवार, 10 नवंबर 2026');
    expect(time.weekday).toBe('मंगलवार');
  });
});

describe('weather', () => {
  it('describes the weather now', async () => {
    const { english, hindi } = await converse('मौसम कैसा है');
    expect(hindi.speech).toBe(
      'Paris में अभी तापमान 18 डिग्री है और आसमान में कुछ बादल हैं। आज अधिकतम तापमान 21 डिग्री रहेगा।',
    );
    const weather = card(hindi, 'weather');
    expect(weather.id).toBe(card(english, 'weather').id);
    expect(weather.place).toBe('Paris, France');
    expect(weather.current.summary).toBe('आंशिक बादल');
    expect(weather.days.map((day) => day.label).slice(0, 3)).toEqual(['आज', 'कल', 'गुरु']);
    expect(weather.copyText).toContain('Paris, France का मौसम: 18°C, आंशिक बादल');
  });

  it('answers the rain question for tomorrow', async () => {
    const { hindi } = await converse('कल बारिश होगी क्या');
    expect(hindi.speech).toBe('हाँ, कल Paris में बारिश की संभावना है। संभावना 80 प्रतिशत है।');
    expect(card(hindi, 'weather').verdict).toBe('हाँ — कल बारिश की संभावना है (80%)');
  });

  it('answers the temperature question and a forecast for a weekday', async () => {
    expect(await speech('कितनी गर्मी है')).toBe(
      'Paris में अभी 18 डिग्री है, महसूस 17 डिग्री हो रहा है। आज अधिकतम 21 डिग्री और न्यूनतम 12 डिग्री रहेगा।',
    );
    expect(await speech('शनिवार को मौसम कैसा रहेगा')).toBe(
      'शनिवार को Paris में हल्की फुहार पड़ेगी। अधिकतम तापमान 14 डिग्री, न्यूनतम 9 डिग्री और बारिश की संभावना 45 प्रतिशत है।',
    );
    expect(await speech('कल का तापमान कितना रहेगा')).toBe(
      'कल Paris में अधिकतम तापमान 17 डिग्री और न्यूनतम 11 डिग्री रहेगा।',
    );
  });

  it.each([
    [80, 'हाँ, आज Paris में बारिश की संभावना है। संभावना 80 प्रतिशत है।'],
    [35, 'हो सकता है। Paris में आज बारिश की 35 प्रतिशत संभावना है।'],
    [15, 'शायद नहीं। Paris में आज बारिश की संभावना सिर्फ़ 15 प्रतिशत है।'],
    [0, 'नहीं, आज Paris में बारिश की संभावना नहीं है।'],
  ])('rain chance of %d%% today', async (percent, expected) => {
    const base = sampleForecast();
    const days = base.days.map((day, index) =>
      index === 0 ? { ...day, precipChance: percent } : day,
    );
    const services = fakes({ weather: { forecast: () => Promise.resolve({ ...base, days }) } });
    expect(await speech('आज बारिश होगी क्या', services)).toBe(expected);
  });

  it('says minus for freezing temperatures', async () => {
    const base = sampleForecast();
    const forecast = { ...base, current: { ...base.current, temp: -3 } };
    const services = fakes({ weather: { forecast: () => Promise.resolve(forecast) } });
    expect(await speech('मौसम कैसा है', services)).toContain('तापमान माइनस 3 डिग्री है');
  });

  it('keeps unknown conditions readable and the unit the user uses', async () => {
    const base = sampleForecast({ units: 'imperial' });
    const services = fakes({ weather: { forecast: () => Promise.resolve(base) } });
    const { hindi } = await converse('मौसम कैसा है', services);
    expect(card(hindi, 'weather').copyText).toContain('18°F');
  });

  it('says what it knows when the forecast has no days', () => {
    const card: WeatherCard = {
      ...sampleForecast({ days: [] }),
      id: 'w1',
      createdAt: 1,
      focusDay: 0,
    };
    const result = localizeResult(
      { cards: [card], speech: 'x' },
      { commandId: 'weather', locale: 'hi' },
    );
    expect(result.speech).toBe('Paris में अभी तापमान 18 डिग्री है।');
  });

  it('translates the weather service errors', async () => {
    const services = fakes({
      weather: { forecast: () => Promise.reject(new Error('offline')) },
    });
    expect(await speech('मौसम कैसा है', services)).toBe(
      'माफ़ कीजिए, कुछ गड़बड़ हो गई। कृपया फिर कोशिश कीजिए।',
    );
  });
});

describe('timers, alarms and reminders', () => {
  it('starts a timer', async () => {
    const { english, hindi } = await converse('पाँच मिनट का टाइमर लगाओ');
    expect(hindi.speech).toBe('ठीक है, 5 मिनट का टाइमर शुरू कर दिया।');
    expect(card(hindi, 'timer').label).toBe('टाइमर');
    expect(card(hindi, 'timer').id).toBe(card(english, 'timer').id);
  });

  it('starts a labelled timer and keeps the label as it was said', async () => {
    expect(await speech('चाय का 5 मिनट का टाइमर लगाओ')).toBe(
      'ठीक है, चाय के लिए 5 मिनट का टाइमर शुरू कर दिया।',
    );
    expect(await speech('डेढ़ घंटे का टाइमर लगाओ')).toBe(
      'ठीक है, 1 घंटा 30 मिनट का टाइमर शुरू कर दिया।',
    );
  });

  it('asks how long the timer should run', async () => {
    const { hindi } = await converse('टाइमर शुरू करो');
    expect(hindi.speech).toBe('टाइमर कितनी देर के लिए चलाऊँ?');
    const status = card(hindi, 'status');
    expect(status.title).toBe('टाइमर कितनी देर के लिए चलाऊँ?');
    expect(status.detail).toBe('जैसे: "5 मिनट का टाइमर लगाओ"।');
  });

  it('reports what is left, lists and cancels timers', async () => {
    const one = fakes({ timers: timersWith([record()]) });
    expect(await speech('टाइमर में कितना समय बचा है', one)).toBe(
      'आपके टाइमर में 4 मिनट 30 सेकंड बचे हैं।',
    );
    expect(await speech('टाइमर रद्द करो', one)).toBe('टाइमर रद्द कर दिया।');

    const two = fakes({
      timers: timersWith([record(), record({ id: 'timer-2', label: 'Chai' })]),
    });
    expect(await speech('मेरे टाइमर दिखाओ', two)).toBe(
      'आपके 2 टाइमर चल रहे हैं। अगले टाइमर में 4 मिनट 30 सेकंड बचे हैं।',
    );
    const cancelled = await converse('सारे टाइमर रद्द करो', two);
    expect(cancelled.hindi.speech).toBe('सभी 2 टाइमर रद्द कर दिए');
    expect(card(cancelled.hindi, 'status').title).toBe('2 टाइमर रद्द कर दिए');
  });

  it('says there is nothing to cancel or list', async () => {
    expect(await speech('टाइमर रद्द करो')).toBe('रद्द करने के लिए आपका कोई टाइमर नहीं है।');
    expect(await speech('मेरे टाइमर दिखाओ')).toBe('कोई टाइमर नहीं चल रहा है।');
  });

  it('reads a labelled timer, several alarms and several reminders', async () => {
    const tea = fakes({ timers: timersWith([record({ label: 'चाय' })]) });
    expect(await speech('मेरे टाइमर दिखाओ', tea)).toBe('चाय में 4 मिनट 30 सेकंड बचे हैं।');

    const later = NOW.getTime() + 16 * 3_600_000;
    const alarms = fakes({
      timers: timersWith([
        record({ type: 'alarm', label: 'Alarm', endsAt: later }),
        record({ id: 'alarm-2', type: 'alarm', label: 'Alarm', endsAt: later + 3_600_000 }),
      ]),
    });
    expect(await speech('मेरे अलार्म दिखाओ', alarms)).toBe(
      'आपके 2 अलार्म सेट हैं। अगला अलार्म कल सुबह 7:42 बजे के लिए है।',
    );

    const soon = NOW.getTime() + 2 * 3_600_000;
    const reminders = fakes({
      timers: timersWith([
        record({ type: 'reminder', label: 'दूध लाना', endsAt: soon }),
        record({ id: 'reminder-2', type: 'reminder', label: 'बैंक जाना', endsAt: soon + 600_000 }),
      ]),
    });
    expect(await speech('मेरे रिमाइंडर दिखाओ', reminders)).toBe(
      'आपके 2 रिमाइंडर हैं। अगला आज शाम 5:42 बजे: दूध लाना।',
    );
  });

  it('sets an alarm for the time that was asked', async () => {
    const { hindi } = await converse('कल सुबह सात बजे का अलार्म लगाओ');
    expect(hindi.speech).toBe('अलार्म कल सुबह 7 बजे के लिए सेट हो गया।');
    expect(card(hindi, 'status').title).toBe('अलार्म कल सुबह 7 बजे के लिए सेट हो गया');
    expect(await speech('साढ़े पाँच बजे उठा देना')).toBe(
      'अलार्म कल सुबह 5:30 बजे के लिए सेट हो गया।',
    );
  });

  it('asks for the alarm time, lists and cancels alarms', async () => {
    expect(await speech('अलार्म लगाओ')).toBe('अलार्म किस समय के लिए लगाऊँ?');
    const alarm = fakes({
      timers: timersWith([
        record({ type: 'alarm', label: 'Alarm', endsAt: NOW.getTime() + 16 * 3_600_000 }),
      ]),
    });
    expect(await speech('मेरे अलार्म दिखाओ', alarm)).toBe(
      'आपका अलार्म कल सुबह 7:42 बजे के लिए सेट है।',
    );
    const cancelled = await converse('अलार्म रद्द करो', alarm);
    expect(cancelled.hindi.speech).toBe('अलार्म रद्द कर दिया।');
    expect(card(cancelled.hindi, 'timer').label).toBe('अलार्म');
  });

  it('sets, lists and cancels reminders', async () => {
    expect(await speech('मुझे शाम 6 बजे दूध लाने की याद दिलाना')).toBe(
      'ठीक है, मैं आपको आज शाम 6 बजे याद दिलाऊँगा: दूध लाना।',
    );
    expect(await speech('10 मिनट में मुझे चाय बनाने की याद दिलाओ')).toBe(
      'ठीक है, मैं आपको आज दोपहर 3:52 बजे याद दिलाऊँगा: चाय बनाना।',
    );
    const reminders = fakes({
      timers: timersWith([
        record({ type: 'reminder', label: 'दूध लाना', endsAt: NOW.getTime() + 2 * 3_600_000 }),
      ]),
    });
    expect(await speech('मेरे रिमाइंडर दिखाओ', reminders)).toBe(
      'रिमाइंडर आज शाम 5:42 बजे: दूध लाना।',
    );
    expect(await speech('रिमाइंडर रद्द करो', reminders)).toBe('रिमाइंडर रद्द कर दिया।');
  });
});

describe('notes', () => {
  it('saves a note', async () => {
    const { hindi } = await converse('नोट करो कि दूध लाना है');
    expect(hindi.speech).toBe('नोट सेव हो गया');
    expect(card(hindi, 'status').title).toBe('नोट सेव हो गया');
  });

  it('asks what to note', async () => {
    const { hindi } = await converse('नोट करो');
    expect(hindi.speech).toBe('नोट में क्या लिखूँ?');
    expect(card(hindi, 'status').detail).toBe('जैसे: "नोट करो कि दूध लाना है"।');
  });

  it('lists and searches notes without touching their text', async () => {
    const services = fakes({ notes: notesWith(['दूध लाना है', 'बैंक जाना है']) });
    const listed = await converse('मेरे नोट्स दिखाओ', services);
    expect(listed.hindi.speech).toBe('आपके पास 2 नोट्स हैं। सबसे नया नोट है: दूध लाना है');
    expect(card(listed.hindi, 'notes').title).toBe('आपके नोट्स');
    expect(card(listed.hindi, 'notes').copyText).toBe('- दूध लाना है\n- बैंक जाना है');

    const found = await converse(
      'दूध के बारे में नोट्स दिखाओ',
      fakes({ notes: notesWith(['दूध लाना है']) }),
    );
    expect(found.hindi.speech).toBe('मुझे दूध के बारे में 1 नोट मिला।');
    expect(card(found.hindi, 'notes').title).toBe('"दूध" के बारे में नोट्स');
  });

  it('says there are no notes', async () => {
    expect(await speech('मेरे नोट्स दिखाओ')).toBe('आपके पास अभी कोई नोट नहीं है।');
    expect(await speech('आख़िरी नोट हटाओ')).toBe('हटाने के लिए आपके पास कोई नोट नहीं है।');
  });

  it('deletes the last note and offers to undo it', async () => {
    const { english, hindi } = await converse(
      'आख़िरी नोट हटाओ',
      fakes({ notes: notesWith(['दूध लाना है']) }),
    );
    expect(hindi.speech).toBe('आपका आख़िरी नोट हटा दिया');
    const status = card(hindi, 'status');
    expect(status.actions?.[0]?.label).toBe('पूर्ववत करें');
    expect(status.actions?.[0]).toMatchObject({ type: 'command', text: 'take a note दूध लाना है' });
    expect(status.actions).toHaveLength(card(english, 'status').actions?.length ?? 0);
  });

  it('asks before deleting everything, and keeps the confirmation phrase the engine knows', async () => {
    const { hindi } = await converse(
      'सारे नोट्स डिलीट करो',
      fakes({ notes: notesWith(['क', 'ख', 'ग']) }),
    );
    expect(hindi.speech).toBe('क्या सभी 3 नोट्स हटा दूँ? पुष्टि के लिए "हाँ" कहिए।');
    const status = card(hindi, 'status');
    expect(status.title).toBe('क्या सभी 3 नोट्स हटा दूँ?');
    expect(status.detail).toBe('इसे वापस नहीं किया जा सकता।');
    expect(status.actions?.[0]).toMatchObject({
      label: 'हाँ, सारे नोट्स हटाएँ',
      text: 'confirm delete all notes',
    });
  });
});

describe('calculator and converter', () => {
  it('speaks the sum', async () => {
    const { hindi } = await converse('5 गुणा 6 कितना होता है');
    expect(hindi.speech).toBe('5 गुणा 6 बराबर 30 है।');
    expect(card(hindi, 'calc').resultText).toBe('30');
  });

  it.each([
    ['2400 का 15 प्रतिशत', '2400 का 15 प्रतिशत 360 है।'],
    ['सौ में से बीस घटाओ', '100 घटा 20 बराबर 80 है।'],
    ['एक सौ बीस जमा तीस', '120 जमा 30 बराबर 150 है।'],
    ['सोलह का वर्गमूल', '16 का वर्गमूल 4 है।'],
    ['दस भाग चार', '10 भाग 4 बराबर 2.5 है।'],
  ])('%s', async (text, expected) => {
    expect(await speech(text)).toBe(expected);
  });

  it('refuses to divide by zero', async () => {
    const { hindi } = await converse('5 भाग 0 कितना होता है');
    expect(hindi.speech).toBe('शून्य से भाग नहीं दिया जा सकता।');
    expect(card(hindi, 'status').title).toBe('शून्य से भाग नहीं दिया जा सकता');
  });

  it('converts units', async () => {
    const { hindi } = await converse('10 किलोमीटर कितने मील हैं');
    expect(hindi.speech).toBe('10 किलोमीटर 6.2137 मील के बराबर है।');
    const conversion = card(hindi, 'conversion');
    expect(conversion.fromText).toBe('10 किलोमीटर');
    expect(conversion.toText).toBe('6.2137 मील');
    expect(await speech('100 फ़ारेनहाइट को सेल्सियस में बदलो')).toBe(
      '100 डिग्री फ़ारेनहाइट 37.7778 डिग्री सेल्सियस के बराबर है।',
    );
  });

  it('explains why two units cannot be converted', async () => {
    const { hindi } = await converse('1 किलोमीटर को सेल्सियस में बदलो');
    expect(hindi.speech).toBe(
      'मैं किलोमीटर को डिग्री सेल्सियस में नहीं बदल सकता। किलोमीटर लंबाई की इकाई है, जबकि डिग्री सेल्सियस तापमान की इकाई है।',
    );
  });

  it('says it found no definition, and leaves definitions it cannot translate alone', async () => {
    expect(await speech('serendipity का मतलब बताओ')).toBe('मुझे serendipity की परिभाषा नहीं मिली।');
  });
});

describe('battery and system information', () => {
  const battery = (info: Partial<Awaited<ReturnType<SystemApi['getBattery']>>>) =>
    fakes({
      system: system({
        getBattery: () =>
          Promise.resolve({ hasBattery: true, percent: 80, charging: false, onAc: false, ...info }),
      }),
    });

  it('reports the level and the time left', async () => {
    expect(await speech('बैटरी कितनी बची है')).toBe(
      'आपकी बैटरी 62 प्रतिशत है, लगभग 3 घंटे 10 मिनट बचे हैं।',
    );
    const { hindi } = await converse('बैटरी कितनी बची है');
    expect(card(hindi, 'battery').copyText).toBe('बैटरी: 62% (बैटरी पर)');
  });

  it('knows when the PC is charging or plugged in', async () => {
    const charging = battery({ charging: true, onAc: true });
    expect(await speech('बैटरी कितनी बची है', charging)).toBe(
      'आपकी बैटरी 80 प्रतिशत है और चार्ज हो रही है।',
    );
    expect(await speech('क्या चार्जिंग हो रही है', charging)).toBe(
      'हाँ, आपकी बैटरी चार्ज हो रही है। यह 80 प्रतिशत है।',
    );
    const plugged = battery({ onAc: true });
    expect(await speech('बैटरी कितनी बची है', plugged)).toBe(
      'आपकी बैटरी 80 प्रतिशत है और प्लग इन है।',
    );
    expect(await speech('क्या चार्जिंग हो रही है', plugged)).toBe(
      'नहीं, पीसी प्लग इन है लेकिन बैटरी चार्ज नहीं हो रही। बैटरी 80 प्रतिशत है।',
    );
    expect(await speech('क्या चार्जिंग हो रही है')).toBe(
      'नहीं, आपका पीसी बैटरी पावर पर चल रहा है और बैटरी 62 प्रतिशत है।',
    );
  });

  it('says when there is no battery', async () => {
    const desktop = fakes({
      system: system({
        getBattery: () => Promise.resolve({ hasBattery: false, charging: false, onAc: true }),
      }),
    });
    const { hindi } = await converse('बैटरी कितनी बची है', desktop);
    expect(hindi.speech).toBe('इस पीसी में बैटरी नहीं है। यह एसी पावर पर चल रहा है।');
    expect(card(hindi, 'battery').copyText).toBe('इस पीसी में बैटरी नहीं है');
  });

  it.each([
    ['कितनी रैम है', 'आप 16 GB में से 8 GB मेमोरी इस्तेमाल कर रहे हैं, यानी लगभग 50 प्रतिशत।'],
    [
      'सीपीयू कितना इस्तेमाल हो रहा है',
      'आपके 8-कोर Intel Core i7-1165G7 पर सीपीयू का उपयोग 12 प्रतिशत है।',
    ],
    ['डिस्क में कितनी जगह खाली है', 'ड्राइव C: पर 475.9 GB में से 119.2 GB खाली है।'],
    ['कंप्यूटर कब से चालू है', 'आपका पीसी 3 दिन 4 घंटे 30 मिनट से चालू है।'],
    [
      'सिस्टम की जानकारी दिखाओ',
      'Windows 11 Pro। सीपीयू 12 प्रतिशत, मेमोरी 50 प्रतिशत इस्तेमाल में, ड्राइव C: पर 119.2 GB खाली। पीसी 3 दिन 4 घंटे 30 मिनट से चालू है।',
    ],
  ])('%s', async (text, expected) => {
    expect(await speech(text)).toBe(expected);
  });

  it('speaks terabytes and megabytes', async () => {
    const tiny = {
      ...SAMPLE_SYSTEM_INFO,
      memory: { totalBytes: 2 * 1024 ** 3, usedBytes: 512 * 1024 ** 2, usagePercent: 25 },
      disk: {
        drive: 'D:',
        totalBytes: 2 * 1024 ** 4,
        freeBytes: 500 * 1024 ** 2,
        usagePercent: 99,
      },
    };
    const services = fakes({ system: system({ getSystemInfo: () => Promise.resolve(tiny) }) });
    expect(await speech('डिस्क में कितनी जगह खाली है', services)).toBe(
      'ड्राइव D: पर 2 TB में से 500 MB खाली है।',
    );
    expect(await speech('कितनी रैम है', services)).toBe(
      'आप 2 GB में से 512 MB मेमोरी इस्तेमाल कर रहे हैं, यानी लगभग 25 प्रतिशत।',
    );
  });

  it('translates the system card summary', async () => {
    const { hindi } = await converse('सिस्टम की जानकारी दिखाओ');
    expect(card(hindi, 'sysinfo').copyText).toBe(
      [
        'ओएस: Windows 11 Pro',
        'सीपीयू: Intel Core i7-1165G7 (8 कोर), 12% उपयोग में',
        'मेमोरी: 16 GB में से 8 GB उपयोग में (50%)',
        'डिस्क C:: 475.9 GB में से 119.2 GB खाली',
        'चालू रहने का समय: 3 दिन 4 घंटे 30 मिनट',
      ].join('\n'),
    );
  });
});

describe('controlling the PC', () => {
  it.each([
    ['आवाज़ बढ़ाओ', 'आवाज़ 50 प्रतिशत है।'],
    ['आवाज़ 50 करो', 'आवाज़ 40 प्रतिशत है।'],
    ['आवाज़ कितनी है', 'आवाज़ 40 प्रतिशत है।'],
    ['म्यूट करो', 'आवाज़ म्यूट कर दी।'],
    ['ब्राइटनेस 70 प्रतिशत करो', 'ब्राइटनेस 60 प्रतिशत है।'],
    ['डार्क मोड चालू करो', 'डार्क मोड चालू कर दिया।'],
    ['स्क्रीनशॉट लो', 'स्क्रीनशॉट सेव हो गया।'],
    ['कंप्यूटर लॉक करो', 'आपका पीसी लॉक कर रहा हूँ।'],
    ['वाईफाई सेटिंग्स खोलो', 'वाई-फ़ाई सेटिंग्स खोल रहा हूँ।'],
    ['ब्लूटूथ सेटिंग्स खोलो', 'ब्लूटूथ सेटिंग्स खोल रहा हूँ।'],
    ['डिस्प्ले सेटिंग्स खोलो', 'डिस्प्ले सेटिंग्स खोल रहा हूँ।'],
    ['सेटिंग्स खोलो', 'सेटिंग्स खोल रहा हूँ।'],
  ])('%s', async (text, expected) => {
    expect(await speech(text)).toBe(expected);
  });

  it('keeps the titles short on the cards', async () => {
    expect(card((await converse('आवाज़ बढ़ाओ')).hindi, 'status').title).toBe('आवाज़ 50%');
    expect(card((await converse('म्यूट करो')).hindi, 'status')).toMatchObject({
      title: 'म्यूट',
      detail: 'आवाज़ 40% पर है',
    });
    expect(card((await converse('डार्क मोड चालू करो')).hindi, 'status').title).toBe(
      'डार्क मोड चालू',
    );
    expect(card((await converse('कंप्यूटर लॉक करो')).hindi, 'status').title).toBe(
      'आपका पीसी लॉक कर रहा हूँ',
    );
  });

  it('asks before shutting down, restarting or sleeping, and keeps the confirmation card', async () => {
    const shutdown = await converse('कंप्यूटर बंद करो');
    expect(shutdown.hindi.speech).toBe('क्या आपका पीसी बंद कर दूँ? कृपया पुष्टि कीजिए।');
    const confirm = card(shutdown.hindi, 'confirm');
    expect(confirm.title).toBe('क्या इस पीसी को बंद कर दूँ?');
    expect(confirm.confirmLabel).toBe('बंद करें');
    expect(confirm.confirmId).toBe(card(shutdown.english, 'confirm').confirmId);
    expect(confirm.action).toEqual(card(shutdown.english, 'confirm').action);

    expect(await speech('कंप्यूटर रीस्टार्ट करो')).toBe(
      'क्या आपका पीसी रीस्टार्ट कर दूँ? कृपया पुष्टि कीजिए।',
    );
    expect(await speech('कंप्यूटर को स्लीप में डालो')).toBe(
      'क्या आपका पीसी स्लीप में डाल दूँ? कृपया पुष्टि कीजिए।',
    );
  });

  it('asks before emptying the recycle bin', async () => {
    const { hindi } = await converse('रीसायकल बिन खाली करो');
    expect(hindi.speech).toBe('क्या रीसायकल बिन खाली कर दूँ? इसे वापस नहीं किया जा सकता।');
    expect(card(hindi, 'confirm').confirmLabel).toBe('रीसायकल बिन खाली करें');
  });

  it('translates system errors', async () => {
    const services = fakes({
      system: system({
        setVolume: () => Promise.reject(new Error('no device')),
        adjustVolume: () => Promise.reject(new Error('no device')),
      }),
    });
    expect(await speech('आवाज़ बढ़ाओ', services)).toBe('माफ़ कीजिए, मैं आवाज़ नहीं बदल सका।');
  });
});

describe('apps and the web', () => {
  const chrome = {
    name: 'Google Chrome',
    key: 'google chrome',
    kind: 'shortcut' as const,
    target: 'chrome.lnk',
  };

  it('opens an app, or says it is not installed', async () => {
    const installed = fakes({
      system: system({ findApps: () => Promise.resolve([{ app: chrome, score: 1 }]) }),
    });
    expect(await speech('क्रोम खोलो', installed)).toBe('Google Chrome खोल रहा हूँ।');
    const missing = await converse('क्रोम खोलो');
    expect(missing.hindi.speech).toBe('मुझे chrome नहीं मिला।');
    expect(card(missing.hindi, 'status').detail).toBe(
      'यह इस पीसी पर इंस्टॉल किया हुआ ऐप नहीं लगता।',
    );
  });

  it('closes an app, or explains why it did not close', async () => {
    const closed = fakes({
      system: system({
        closeApp: () =>
          Promise.resolve({ status: 'closed', processes: [{ pid: 1, name: 'chrome', title: '' }] }),
      }),
    });
    expect(await speech('क्रोम बंद करो', closed)).toBe('Google Chrome बंद कर दिया।');

    const idle = fakes({
      system: system({ closeApp: () => Promise.resolve({ status: 'not-running', processes: [] }) }),
    });
    const notRunning = await converse('क्रोम बंद करो', idle);
    expect(notRunning.hindi.speech).toBe('Google Chrome चल नहीं रहा है।');
    expect(card(notRunning.hindi, 'status').detail).toBe('इसकी कोई खुली विंडो नहीं मिली।');

    const stuck = fakes({
      system: system({
        closeApp: () =>
          Promise.resolve({
            status: 'needs-force',
            processes: [{ pid: 1, name: 'chrome', title: '' }],
          }),
      }),
    });
    const force = await converse('क्रोम बंद करो', stuck);
    expect(force.hindi.speech).toBe('Google Chrome बंद नहीं हुआ। क्या इसे ज़बरदस्ती बंद कर दूँ?');
    expect(card(force.hindi, 'confirm').confirmLabel).toBe('ज़बरदस्ती बंद करें');
  });

  it('opens a website and searches', async () => {
    expect(await speech('github.com खोलो')).toBe('github.com खोल रहा हूँ।');
    const google = await converse('गूगल पर बिरयानी की रेसिपी सर्च करो');
    expect(google.hindi.speech).toBe('Google पर "बिरयानी की रेसिपी" खोज रहा हूँ।');
    expect(card(google.hindi, 'search').query).toBe('बिरयानी की रेसिपी');
    expect(await speech('यूट्यूब पर लोफी म्यूजिक चलाओ')).toBe(
      'YouTube पर "लोफी म्यूजिक" खोज रहा हूँ।',
    );
  });

  it('says when the browser cannot be opened', async () => {
    const services = fakes({
      ui: { ...fakes().ui, openExternal: vi.fn(() => Promise.resolve(false)) },
    });
    expect(await speech('गूगल पर मौसम सर्च करो', services)).toBe(
      'माफ़ कीजिए, मैं आपका ब्राउज़र नहीं खोल सका।',
    );
  });
});

describe('the assistant itself', () => {
  it('copies the last answer', async () => {
    const services = fakes({ ui: { ...fakes().ui, getLastAnswerText: vi.fn(() => 'नमस्ते') } });
    const { hindi } = await converse('कॉपी कर लो', services);
    expect(hindi.speech).toBe('क्लिपबोर्ड पर कॉपी कर दिया');
    expect(card(hindi, 'status').detail).toBe('नमस्ते');
    expect(await speech('कॉपी करो')).toBe('अभी कॉपी करने के लिए कुछ नहीं है।');
  });

  it('says what it can do', async () => {
    const { english, hindi } = await converse('तुम क्या कर सकते हो');
    expect(hindi.speech).toBe(
      'मैं टाइमर, मौसम, नोट्स, ऐप खोलने, आवाज़ और ब्राइटनेस जैसे कई कामों में आपकी मदद कर सकता हूँ।',
    );
    const gallery = card(hindi, 'gallery');
    const original = card(english, 'gallery');
    expect(gallery.groups.map((group) => group.title)).toEqual([
      'ऐप्स और वेब',
      'जानकारी',
      'उत्पादकता',
      'सिस्टम',
      'असिस्टेंट',
    ]);
    expect(gallery.groups.map((group) => group.commands.length)).toEqual(
      original.groups.map((group) => group.commands.length),
    );
    const timers = gallery.groups
      .flatMap((group) => group.commands)
      .find((command) => command.title === 'टाइमर');
    expect(timers?.examples).toEqual([
      '5 मिनट का टाइमर लगाओ',
      'आधे घंटे का टाइमर लगाओ',
      'टाइमर रद्द करो',
    ]);
  });

  it('translates the circle to search card', async () => {
    const { hindi } = await converse('सर्कल टू सर्च');
    expect(card(hindi, 'status').title).toBe('सर्कल टू सर्च');
  });

  it('says the daily briefing in Hindi', async () => {
    const { english, hindi } = await converse('गुड मॉर्निंग');
    expect(hindi.speech).toBe(
      'नमस्कार! आज मंगलवार, 10 नवंबर है। Paris में अभी 18 डिग्री है और आसमान में कुछ बादल हैं। आज अधिकतम तापमान 21 डिग्री रहेगा। क्या मैं और कुछ कर सकता हूँ?',
    );
    const text = card(hindi, 'text');
    expect(text.id).toBe(card(english, 'text').id);
    expect(text.title).toBe('नमस्कार');
    expect(text.markdown).toBe(
      '**मंगलवार, 10 नवंबर**\n\n**Paris** — 18°C, आंशिक बादल (अधिकतम 21°, न्यूनतम 12°)',
    );
    expect(text.actions?.map((action) => action.label)).toEqual(['मौसम', 'मेरे नोट्स']);
    expect(text.actions?.map((action) => (action.type === 'command' ? action.text : ''))).toEqual([
      'मौसम बताओ',
      'मेरे नोट्स दिखाओ',
    ]);
  });

  it('includes reminders, timers and notes in the briefing', async () => {
    const services = fakes({
      timers: timersWith([
        record(),
        record({ id: 'a', type: 'alarm', label: 'Alarm', endsAt: NOW.getTime() + 3_600_000 }),
        record({ id: 'b', type: 'reminder', label: 'दूध लाना', endsAt: NOW.getTime() + 7_200_000 }),
        record({
          id: 'c',
          type: 'reminder',
          label: 'बैंक जाना',
          endsAt: NOW.getTime() + 7_300_000,
        }),
      ]),
      notes: notesWith(['क', 'ख']),
    });
    const { hindi } = await converse('गुड मॉर्निंग', services);
    expect(hindi.speech).toContain(
      'आज आपके 4 रिमाइंडर या टाइमर हैं: टाइमर (दोपहर 3:46 बजे ख़त्म होगा), फिर अलार्म शाम 4:42 बजे, फिर दूध लाना शाम 5:42 बजे, और 1 अन्य।',
    );
    expect(hindi.speech).toContain('आपके 2 सेव किए हुए नोट हैं।');
    const markdown = card(hindi, 'text').markdown;
    expect(markdown).toContain('**आज** — 4 रिमाइंडर या टाइमर');
    expect(markdown).toContain('- टाइमर (दोपहर 3:46 बजे ख़त्म होगा)');
    expect(markdown).toContain('- और 1 अन्य');
    expect(markdown).toContain('**नोट्स** — 2 सेव किए हुए नोट');
  });

  it('repeats and dictates', async () => {
    const repeat = await converse('दोबारा बोलो');
    expect(repeat.hindi.speech).toBe('मैंने अभी तक कुछ कहा ही नहीं है।');
    expect(card(repeat.hindi, 'status')).toMatchObject({
      title: 'अभी दोहराने के लिए कुछ नहीं है',
      detail: 'पहले मुझसे कुछ पूछिए।',
    });
    const dictate = await converse('डिक्टेशन शुरू करो');
    expect(card(dictate.hindi, 'status')).toMatchObject({
      title: 'डिक्टेशन',
      detail:
        'बोलिए, मैं उसे वहीं टाइप कर दूँगा जहाँ आपका कर्सर है। रोकने के लिए हॉटकी या Esc दबाइए।',
    });
  });
});

describe('everything else', () => {
  const english: CommandResult = {
    cards: [
      {
        kind: 'status',
        id: 'c1',
        createdAt: 1,
        tone: 'neutral',
        icon: 'info',
        title: 'Hello there',
      },
    ],
    speech: 'Hello there.',
  };

  it('returns an English reply unchanged when asked for English', () => {
    expect(localizeResult(english, { commandId: 'weather', locale: 'en' })).toBe(english);
  });

  it('keeps sentences it has no translation for, and their card kinds and ids', () => {
    const result = localizeResult(english, { commandId: 'unknown', locale: 'hi' });
    expect(result.speech).toBe('Hello there.');
    expect(result.cards).toEqual(english.cards);
  });

  it('leaves a streaming AI answer alone', () => {
    const answer: CommandResult = {
      cards: [
        { kind: 'answer', id: 'a1', createdAt: 1, markdown: '', streaming: true, model: 'gpt-4o' },
      ],
      pin: true,
    };
    const result = localizeResult(answer, { commandId: null, locale: 'hi' });
    expect(result).toEqual(answer);
  });

  it('translates the web search fallback', () => {
    const search: CommandResult = {
      cards: [
        {
          kind: 'search',
          id: 's1',
          createdAt: 1,
          engine: 'web',
          query: 'ताजमहल',
          url: 'https://x',
          openUrl: 'https://x',
        },
      ],
      speech: 'Searching the web for ताजमहल',
    };
    expect(localizeResult(search, { commandId: null, locale: 'hi' }).speech).toBe(
      'वेब पर "ताजमहल" खोज रहा हूँ',
    );
    const lost: CommandResult = {
      cards: [
        {
          kind: 'status',
          id: 's2',
          createdAt: 1,
          tone: 'warning',
          icon: 'search',
          title: "I didn't catch that",
          detail: 'Try saying or typing it again.',
        },
      ],
      speech: "I didn't catch that. Try saying or typing it again.",
    };
    expect(localizeResult(lost, { commandId: null, locale: 'hi' }).speech).toBe(
      'मुझे यह समझ नहीं आया, क्या आप दोबारा कह सकते हैं?',
    );
  });

  it('translates a countdown card and its buttons', () => {
    const countdown: CommandResult = {
      cards: [
        {
          kind: 'countdown',
          id: 'c1',
          createdAt: 1,
          confirmId: 'confirm-1',
          action: 'shutdown',
          title: 'Shut down this PC?',
          detail:
            'Your PC shuts down 10 seconds after you confirm. You can cancel during the countdown',
          startedAt: 1,
          endsAt: 11_000,
          actions: [{ type: 'command', label: 'Undo', text: 'cancel' }],
        },
      ],
    };
    const result = localizeResult(countdown, { commandId: 'power', locale: 'hi' });
    expect(result.cards[0]).toMatchObject({
      kind: 'countdown',
      id: 'c1',
      confirmId: 'confirm-1',
      title: 'क्या इस पीसी को बंद कर दूँ?',
      detail:
        'पुष्टि करने के 10 सेकंड बाद आपका पीसी बंद हो जाएगा। उलटी गिनती के दौरान आप इसे रद्द कर सकते हैं',
      actions: [{ type: 'command', label: 'पूर्ववत करें', text: 'cancel' }],
    });
  });

  it('leaves cards that carry data alone', () => {
    const definition: CommandResult = {
      cards: [{ kind: 'text', id: 't1', createdAt: 1, markdown: 'Serendipity: a happy accident' }],
      speech: 'Serendipity is a happy accident.',
    };
    const result = localizeResult(definition, { commandId: 'define', locale: 'hi' });
    expect(result.cards).toEqual(definition.cards);
    expect(result.speech).toBe('Serendipity is a happy accident.');
  });

  it('never throws on a malformed result', () => {
    const broken = { cards: undefined } as unknown as CommandResult;
    expect(localizeResult(broken, { commandId: 'weather', locale: 'hi' })).toBe(broken);
  });

  it('translates the sentences of a multi-sentence reply one by one', () => {
    const mixed: CommandResult = {
      cards: [],
      speech: 'Note saved. Something nobody translated.',
    };
    expect(localizeResult(mixed, { commandId: 'notes', locale: 'hi' }).speech).toBe(
      'नोट सेव हो गया। Something nobody translated.',
    );
  });
});
