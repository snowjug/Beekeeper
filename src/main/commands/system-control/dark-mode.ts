import { failureResult, statusCard } from '../apps-web/cards';
import { defineCommand } from '../types';

export interface DarkModeSlots {
  mode: 'dark' | 'light' | 'toggle';
}

const THEME_WORD = String.raw`(?:mode|theme)`;
type Theme = 'dark' | 'light';

/** "toggle dark mode", "switch theme", "flip the light theme". */
const TOGGLE = new RegExp(
  String.raw`^(?:toggle|switch|flip|change|swap)\s+(?:the\s+)?(?:(?:dark|light)\s+)?${THEME_WORD}$`,
);
/** "switch to dark mode", "turn on the light theme", "enable dark mode". */
const ENABLE = new RegExp(
  String.raw`^(?:switch\s+to|change\s+to|go\s+to|swap\s+to|enable|turn\s+on|switch\s+on|activate|use|set\s+to|put\s+(?:it|windows|my\s+pc)\s+(?:in|on))\s+(?:the\s+)?(?<theme>dark|light)\s+${THEME_WORD}$`,
);
/** "turn off dark mode", "disable the light theme". */
const DISABLE = new RegExp(
  String.raw`^(?:disable|turn\s+off|switch\s+off|deactivate|stop\s+using)\s+(?:the\s+)?(?<theme>dark|light)\s+${THEME_WORD}$`,
);
/** "dark theme", "light mode", "dark mode on", "light mode off". */
const BARE = new RegExp(String.raw`^(?<theme>dark|light)\s+${THEME_WORD}(?:\s+(?<state>on|off))?$`);

function opposite(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

function theme(value: string | undefined): Theme {
  return value === 'light' ? 'light' : 'dark';
}

export const darkModeCommand = defineCommand<DarkModeSlots>({
  id: 'dark-mode',
  number: 25,
  group: 'system',
  title: 'Dark mode',
  icon: 'moon',
  examples: [
    'Toggle dark mode',
    'Switch to dark mode',
    'Enable dark mode',
    'Turn on dark mode',
    'Light mode',
    'Switch to the light theme',
    'Turn off dark mode',
    'Dark theme',
  ],

  match(input) {
    const { text } = input;
    if (TOGGLE.test(text)) return { slots: { mode: 'toggle' }, score: 0.95 };

    const enable = ENABLE.exec(text)?.groups?.['theme'];
    if (enable !== undefined) return { slots: { mode: theme(enable) }, score: 0.97 };

    const disable = DISABLE.exec(text)?.groups?.['theme'];
    if (disable !== undefined) return { slots: { mode: opposite(theme(disable)) }, score: 0.97 };

    const bare = BARE.exec(text)?.groups;
    if (bare === undefined) return null;
    const wanted = theme(bare['theme']);
    return { slots: { mode: bare['state'] === 'off' ? opposite(wanted) : wanted }, score: 0.85 };
  },

  async run({ mode }, ctx) {
    let applied: Theme;
    try {
      applied = await ctx.services.system.setDarkMode(mode);
    } catch (error) {
      return failureResult(ctx, 'change the theme', error);
    }
    const name = applied === 'dark' ? 'Dark' : 'Light';
    const card = statusCard(ctx, { tone: 'success', icon: 'moon', title: `${name} mode on` });
    return { cards: [card], speech: `${name} mode on.`, autoCloseMs: 1800 };
  },
});
