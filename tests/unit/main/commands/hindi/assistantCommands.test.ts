import { describe, expect, it } from 'vitest';
import { normalizeUtterance } from '@main/commands/hindi';
import { understand } from './support';

/** Greetings, "say that again" and dictation: Hindi in, the exact English the commands know out. */
describe('briefing, repeat and dictation', () => {
  it.each([
    ['सुप्रभात', 'good morning', 'briefing'],
    ['गुड मॉर्निंग', 'good morning', 'briefing'],
    ['आज का दिन कैसा है', 'what does my day look like', 'briefing'],
    ['आज का दिन कैसा रहेगा', 'what does my day look like', 'briefing'],
    ['मेरा दिन कैसा रहेगा', 'what does my day look like', 'briefing'],
    ['फिर से बोलो', 'repeat that', 'repeat'],
    ['दोबारा बोलो', 'repeat that', 'repeat'],
    ['फिर से कहो', 'repeat that', 'repeat'],
    ['इसे दोहराओ', 'repeat that', 'repeat'],
    ['क्या कहा तुमने', 'what did you say', 'repeat'],
    ['डिक्टेशन शुरू करो', 'start dictation', 'dictate'],
    ['बोलकर टाइप करो', 'start dictation', 'dictate'],
    ['मैं जो बोलूँ वो टाइप करो', 'type what i say', 'dictate'],
    ['वॉइस टाइपिंग चालू करो', 'voice typing', 'dictate'],
  ])('%s -> %s', (hindi, english, command) => {
    const { spoken, intent } = understand(hindi);
    expect(spoken.text).toBe(english);
    expect(spoken.locale).toBe('hi');
    expect(intent?.command.id).toBe(command);
  });

  it.each([
    'good morning',
    'Good morning!',
    'brief me',
    'what does my day look like',
    'repeat that',
    'say that again',
    'what did you say',
    'pardon',
    'start dictation',
    'dictate',
    'voice typing',
    'type what I say',
  ])('%s is English and is left alone', (english) => {
    expect(normalizeUtterance(english)).toStrictEqual({
      text: english,
      locale: 'en',
      changed: false,
      original: english,
    });
    expect(understand(english).intent).not.toBeNull();
  });
});
