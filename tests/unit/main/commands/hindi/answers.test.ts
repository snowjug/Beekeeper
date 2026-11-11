import { describe, expect, it } from 'vitest';
import type { ConversationTurn } from '@shared/cards';
import { NOW, turn } from '../helpers';
import { understand } from './support';

/** The turn the assistant just answered, with the context the command left for the follow-up. */
const asked = (commandId: string, context: Record<string, unknown>): ConversationTurn[] => [
  turn(commandId, 'x', { context }),
];

const WEATHER_TURN = (): ConversationTurn[] => [
  turn('weather', 'weather', {
    context: { place: 'Paris', focusDay: 0 },
    slots: { question: 'general' },
  }),
];

describe('answers to a question the assistant asked', () => {
  it.each([
    ['5 मिनट', 'in 5 minutes'],
    ['पाँच मिनट के लिए', 'in 5 minutes'],
    ['दस मिनट', 'in 10 minutes'],
    ['आधे घंटे', 'in 0.5 hours'],
  ])('how long should the timer run: %s', (answer, english) => {
    const { spoken, intent } = understand(answer, asked('timer', { awaiting: 'timer-duration' }));
    expect(spoken.text).toBe(english);
    expect(intent?.command.id).toBe('timer');
    expect(intent?.slots).toMatchObject({ action: 'start' });
  });

  it.each([
    ['सुबह 7 बजे', 'at 7 am'],
    ['शाम 6 बजे', 'at 6 pm'],
    ['कल सुबह सात बजे', 'tomorrow at 7 am'],
    ['साढ़े छह बजे', 'at 6:30'],
  ])('what time should the alarm ring: %s', (answer, english) => {
    const { spoken, intent } = understand(answer, asked('alarm', { awaiting: 'alarm-time' }));
    expect(spoken.text).toBe(english);
    expect(intent?.command.id).toBe('alarm');
  });

  it('when to remind, and what to remind about', () => {
    const when = understand(
      '10 मिनट बाद',
      asked('reminder', { awaiting: 'reminder-time', text: 'call mom' }),
    );
    expect(when.intent?.command.id).toBe('reminder');
    expect(when.intent?.slots).toMatchObject({ text: 'call mom' });

    const what = understand(
      'माँ को फोन करना',
      asked('reminder', { awaiting: 'reminder-text', at: NOW.getTime() + 600_000 }),
    );
    expect(what.spoken.changed).toBe(false);
    expect(what.intent?.slots).toMatchObject({ text: 'माँ को फोन करना' });
  });

  it.each(['हाँ', 'हां', 'जी हाँ', 'ठीक है', 'हाँ सब हटा दो', 'बिल्कुल', 'haan'])(
    'confirms deleting all notes: %s',
    (answer) => {
      const { spoken, intent } = understand(answer, asked('notes', { awaiting: 'notes-clear' }));
      expect(spoken.text).toBe('yes');
      expect(intent?.slots).toMatchObject({ action: 'clear', confirmed: true });
    },
  );

  it('an agreeing word next to a command is dropped, not mistaken for a confirmation', () => {
    expect(understand('ठीक है आवाज़ बढ़ाओ').spoken.text).toBe('volume up');
    expect(understand('जी हाँ डार्क मोड चालू करो').spoken.text).toBe('turn on dark mode');
    expect(understand('हाँ').intent).toBeNull();
  });
});

describe('weather follow-ups', () => {
  it.each([
    ['और कल?', 'what about tomorrow', { day: 1 }],
    ['कल कैसा रहेगा', 'what about tomorrow', { day: 1 }],
    ['कल का क्या', 'what about tomorrow', { day: 1 }],
    ['और मुंबई में?', 'what about mumbai', { place: 'mumbai' }],
    ['मुंबई का क्या', 'what about mumbai', { place: 'mumbai' }],
    ['और दिल्ली में कल', 'what about delhi tomorrow', { place: 'delhi', day: 1 }],
  ])('%s', (text, english, slots) => {
    const { spoken, intent } = understand(text, WEATHER_TURN());
    expect(spoken.text).toBe(english);
    expect(intent?.command.id).toBe('weather');
    expect(intent?.slots).toMatchObject(slots);
  });

  it('is only a follow-up after a weather answer', () => {
    expect(understand('और कल?').intent).toBeNull();
  });
});
