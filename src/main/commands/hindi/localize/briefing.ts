/** The daily briefing ("गुड मॉर्निंग") in Hindi. Its text is put together from fixed English sentences. */
import type { CardAction, CommandResult, TextCard } from '@shared/cards';
import { clockHindi, monthFromEnglish, parseTwelveHour, weekdayFromEnglish } from './hi';
import { knownSkyTerms } from './weatherTerms';

const GREETINGS: Readonly<Record<string, string>> = {
  'Good morning': 'सुप्रभात',
  'Good afternoon': 'नमस्कार',
  'Good evening': 'शुभ संध्या',
};

/** The chips under the briefing resubmit these phrases, so the answer stays in Hindi. */
const CHIPS: Readonly<Record<string, { label: string; text: string }>> = {
  Weather: { label: 'मौसम', text: 'मौसम बताओ' },
  'My notes': { label: 'मेरे नोट्स', text: 'मेरे नोट्स दिखाओ' },
};

function clockOf(text: string): string {
  const time = parseTwelveHour(text);
  return time === null ? text : clockHindi(time.hour, time.minute);
}

function labelHindi(label: string): string {
  return label === 'Timer' ? 'टाइमर' : label;
}

/** "Timer (ends 4:00 PM)", "Alarm at 7:00 AM", "Call mom at 6:00 PM". */
function agendaItem(item: string): string {
  const ends = /^(.+) \(ends (\d{1,2}:\d{2} [AP]M)\)$/.exec(item);
  if (ends !== null) return `${labelHindi(ends[1] ?? '')} (${clockOf(ends[2] ?? '')} ख़त्म होगा)`;
  const at = /^(.+) at (\d{1,2}:\d{2} [AP]M)$/.exec(item);
  if (at === null) return item;
  const names: Readonly<Record<string, string>> = { Alarm: 'अलार्म', Reminder: 'रिमाइंडर' };
  return `${names[at[1] ?? ''] ?? at[1] ?? ''} ${clockOf(at[2] ?? '')}`;
}

function agendaCount(count: string): string {
  return `${count} रिमाइंडर या टाइमर`;
}

function speechSentence(sentence: string): string | null {
  const greeting = /^(Good morning|Good afternoon|Good evening)!$/.exec(sentence);
  if (greeting !== null) return `${GREETINGS[greeting[1] ?? ''] ?? ''}!`;
  const date = /^It's (\w+), (\w+) (\d{1,2})\.$/.exec(sentence);
  if (date !== null) {
    const [, weekday = '', month = '', day = ''] = date;
    return `आज ${weekdayFromEnglish(weekday)}, ${day} ${monthFromEnglish(month)} है।`;
  }
  const weather =
    /^In (.+?) it's (-?\d+) degrees and (.+?), with a high of (-?\d+)(?:, with a (\d+) percent chance of rain)?\.$/.exec(
      sentence,
    );
  if (weather !== null) {
    const [, city = '', temp = '', summary = '', high = '', rain] = weather;
    const sky = knownSkyTerms(summary);
    if (sky === null) return null;
    const chance = rain === undefined ? '' : `, और बारिश की संभावना ${rain} प्रतिशत है`;
    return `${city} में अभी ${temp} डिग्री है और ${sky.present}। आज अधिकतम तापमान ${high} डिग्री रहेगा${chance}।`;
  }
  const agenda = /^You have (\d+) reminders? or timers? today: (.+?)(?:, and (\d+) more)?\.$/.exec(
    sentence,
  );
  if (agenda !== null) {
    const [, count = '', items = '', extra] = agenda;
    const listed = items.split(', then ').map(agendaItem).join(', फिर ');
    const more = extra === undefined ? '' : `, और ${extra} अन्य`;
    return `आज आपके ${agendaCount(count)} हैं: ${listed}${more}।`;
  }
  const notes = /^You have (\d+) saved notes?\.$/.exec(sentence);
  if (notes !== null) return `आपके ${notes[1] ?? ''} सेव किए हुए नोट हैं।`;
  const fixed: Readonly<Record<string, string>> = {
    'Your day looks clear.': 'आज आपका दिन खाली है।',
    'Have a great day!': 'आपका दिन शुभ हो!',
    'Anything else I can do?': 'क्या मैं और कुछ कर सकता हूँ?',
  };
  return fixed[sentence] ?? null;
}

function blockHindi(block: string): string {
  const date = /^\*\*(\w+), (\w+) (\d{1,2})\*\*$/.exec(block);
  if (date !== null) {
    const [, weekday = '', month = '', day = ''] = date;
    return `**${weekdayFromEnglish(weekday)}, ${day} ${monthFromEnglish(month)}**`;
  }
  const weather =
    /^\*\*(.+?)\*\* — (-?\d+)°([CF]), (.+?) \(high (-?\d+)°, low (-?\d+)°(?:, (\d+)% chance of rain)?\)$/.exec(
      block,
    );
  if (weather !== null) {
    const [, city = '', temp = '', unit = '', summary = '', high = '', low = '', rain] = weather;
    const sky = knownSkyTerms(summary);
    if (sky === null) return block;
    const chance = rain === undefined ? '' : `, बारिश की ${rain}% संभावना`;
    return `**${city}** — ${temp}°${unit}, ${sky.noun} (अधिकतम ${high}°, न्यूनतम ${low}°${chance})`;
  }
  const [head = '', ...lines] = block.split('\n');
  const agenda = /^\*\*Today\*\* — (\d+) reminders? or timers?$/.exec(head);
  if (agenda !== null) {
    const items = lines.map((line) => {
      const more = /^- and (\d+) more$/.exec(line);
      if (more !== null) return `- और ${more[1] ?? ''} अन्य`;
      return `- ${agendaItem(line.replace(/^- /, ''))}`;
    });
    return [`**आज** — ${agendaCount(agenda[1] ?? '')}`, ...items].join('\n');
  }
  const notes = /^\*\*Notes\*\* — (\d+) saved notes?$/.exec(block);
  if (notes !== null) return `**नोट्स** — ${notes[1] ?? ''} सेव किए हुए नोट`;
  return block;
}

function chipsHindi(actions: CardAction[] | undefined): CardAction[] | undefined {
  return actions?.map((action) => {
    const chip = action.type === 'command' ? CHIPS[action.label] : undefined;
    return chip === undefined ? action : { ...action, label: chip.label, text: chip.text };
  });
}

/** Localises a briefing result, or returns null when it is not one (or reads differently than expected). */
export function localizeBriefing(result: CommandResult): CommandResult | null {
  const card = result.cards.find((candidate): candidate is TextCard => candidate.kind === 'text');
  if (card === undefined || result.speech === undefined) return null;
  const greeting = GREETINGS[card.title ?? ''];
  if (greeting === undefined) return null;

  const markdown = card.markdown.split('\n\n').map(blockHindi).join('\n\n');
  const actions = chipsHindi(card.actions);
  const localized: TextCard = {
    ...card,
    title: greeting,
    markdown,
    copyText: markdown.replace(/\*\*/g, ''),
    ...(actions === undefined ? {} : { actions }),
  };
  const sentences = result.speech.split(/(?<=[.!?])\s+/);
  const speech = sentences.map((sentence) => speechSentence(sentence) ?? sentence).join(' ');
  return {
    ...result,
    speech,
    cards: result.cards.map((candidate) => (candidate === card ? localized : candidate)),
  };
}
