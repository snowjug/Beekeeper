import { defineCommand } from '../types';

export type PowerAction = 'shutdown' | 'restart' | 'sleep';

export interface PowerSlots {
  action: PowerAction;
}

/** Anything that names the computer itself, so "shut down notepad" and "turn off the lights" do not match. */
const COMPUTER = String.raw`(?:the\s+|my\s+|this\s+|your\s+)?(?:pc|computer|laptop|machine|system|windows|desktop|device|notebook|workstation|tablet)`;
const NOW = String.raw`(?:\s+(?:now|right\s+now|immediately|down))?`;
const SLEEP_STATE = String.raw`(?:sleep|sleep\s+mode|standby|hibernat(?:e|ion)(?:\s+mode)?)`;

interface PowerPattern {
  pattern: RegExp;
  action: PowerAction;
  score: number;
}

const PATTERNS: readonly PowerPattern[] = [
  {
    pattern: new RegExp(
      String.raw`^(?:shut\s?down|shut\s+off|power\s+(?:off|down)|switch\s+off|turn\s+off)\s+${COMPUTER}${NOW}$`,
    ),
    action: 'shutdown',
    score: 0.97,
  },
  { pattern: /^(?:shut\s?down|power\s+(?:off|down))(?:\s+now)?$/, action: 'shutdown', score: 0.9 },
  { pattern: /^shut\s+(?:it|this|everything)\s+down$/, action: 'shutdown', score: 0.85 },
  {
    pattern: new RegExp(String.raw`^(?:restart|reboot|re-boot|power\s+cycle)\s+${COMPUTER}${NOW}$`),
    action: 'restart',
    score: 0.97,
  },
  { pattern: /^(?:restart|reboot|re-boot)(?:\s+now)?$/, action: 'restart', score: 0.9 },
  {
    pattern: new RegExp(String.raw`^(?:put|set)\s+${COMPUTER}\s+(?:to|in|into)\s+${SLEEP_STATE}$`),
    action: 'sleep',
    score: 0.97,
  },
  {
    pattern: new RegExp(
      String.raw`^(?:put|set)\s+(?:it|this|everything)\s+(?:to|in|into)\s+${SLEEP_STATE}$`,
    ),
    action: 'sleep',
    score: 0.88,
  },
  {
    pattern: new RegExp(String.raw`^(?:go\s+to|go\s+into|enter)\s+${SLEEP_STATE}$`),
    action: 'sleep',
    score: 0.9,
  },
  {
    pattern:
      /^(?:sleep|hibernate|suspend)\s+(?:the\s+|my\s+|this\s+)?(?:pc|computer|laptop|machine|system)$/,
    action: 'sleep',
    score: 0.95,
  },
  { pattern: /^(?:sleep(?:\s+mode)?|hibernate|suspend)(?:\s+now)?$/, action: 'sleep', score: 0.88 },
];

const COPY: Readonly<
  Record<PowerAction, { title: string; verb: string; label: string; speech: string }>
> = {
  shutdown: {
    title: 'Shut down this PC?',
    verb: 'shuts down',
    label: 'Shut down',
    speech: 'Shut down your PC? Please confirm.',
  },
  restart: {
    title: 'Restart this PC?',
    verb: 'restarts',
    label: 'Restart',
    speech: 'Restart your PC? Please confirm.',
  },
  sleep: {
    title: 'Put this PC to sleep?',
    verb: 'goes to sleep',
    label: 'Sleep',
    speech: 'Put your PC to sleep? Please confirm.',
  },
};
const COUNTDOWN_SECONDS = 10;

export const powerCommand = defineCommand<PowerSlots>({
  id: 'power',
  number: 24,
  group: 'system',
  title: 'Shut down, restart or sleep',
  icon: 'power',
  examples: [
    'Shut down',
    'Shutdown',
    'Turn off my computer',
    'Power off the PC',
    'Restart',
    'Reboot',
    'Restart my computer',
    'Put the computer to sleep',
    'Go to sleep',
    'Sleep mode',
    'Hibernate',
  ],
  // The explicit phrases must never lose to a looser matcher: this is a one-way action.
  priority: 10,

  match(input) {
    for (const { pattern, action, score } of PATTERNS) {
      if (pattern.test(input.text)) return { slots: { action }, score };
    }
    return null;
  },

  run({ action }, ctx) {
    const { system, confirm } = ctx.services;
    const copy = COPY[action];
    // The confirmation service runs the action after the user confirmed and the countdown elapsed.
    const card = confirm.request({
      action,
      title: copy.title,
      detail: `Your PC ${copy.verb} ${COUNTDOWN_SECONDS} seconds after you confirm. You can cancel during the countdown.`,
      confirmLabel: copy.label,
      danger: true,
      countdownSeconds: COUNTDOWN_SECONDS,
      run: () => system.power(action),
    });
    return { cards: [card], speech: copy.speech, pin: true };
  },
});
