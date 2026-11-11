import type { ScreenshotCard } from '@shared/cards';
import { failureResult } from '../apps-web/cards';
import { matchPhrase } from '../text';
import { defineCommand } from '../types';

type NoSlots = Record<string, never>;

const WHAT = String.raw`(?:screen\s?shots?|screen\s?captures?|screen\s?grabs?|screen\s?snaps?)`;
const WHOLE_SCREEN = String.raw`(?:whole\s+|entire\s+|full\s+)?(?:screen|display|monitor|desktop)`;
/** "take a screenshot", "screenshot", "screen capture", "take a screenshot of my screen". */
const NOUN_FORM = new RegExp(
  String.raw`^(?:(?:take|grab|capture|make|snap|get|do|create|shoot)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+|my\s+)?)?${WHAT}(?:\s+(?:of\s+)?(?:the\s+|my\s+)?${WHOLE_SCREEN})?$`,
);
/** "capture the screen", "snap my screen", "take a picture of the display". */
const VERB_FORM = new RegExp(
  String.raw`^(?:capture|snap|grab|shoot|screenshot|take\s+a\s+(?:picture|photo|snapshot)\s+of)\s+(?:the\s+|my\s+|this\s+)?${WHOLE_SCREEN}$`,
);
/** Reached when speech recognition or typing garbles a word ("take a screnshot"). */
const PHRASES = [
  'take a screenshot',
  'take screenshot',
  'screenshot',
  'capture the screen',
  'capture my screen',
  'screen capture',
  'snap my screen',
  'snap the screen',
  'grab a screenshot',
  'print screen',
];

export const screenshotCommand = defineCommand<NoSlots>({
  id: 'screenshot',
  number: 20,
  group: 'system',
  title: 'Screenshot',
  icon: 'screenshot',
  examples: [
    'Take a screenshot',
    'Screenshot',
    'Capture the screen',
    'Screen capture',
    'Snap my screen',
  ],

  match(input) {
    if (NOUN_FORM.test(input.text) || VERB_FORM.test(input.text)) return { slots: {}, score: 0.95 };
    return matchPhrase(input.text, PHRASES) === null ? null : { slots: {}, score: 0.85 };
  },

  async run(_slots, ctx) {
    let shot;
    try {
      shot = await ctx.services.system.takeScreenshot();
    } catch (error) {
      return failureResult(ctx, 'take a screenshot', error);
    }
    const card: ScreenshotCard = {
      kind: 'screenshot',
      id: ctx.newId(),
      createdAt: ctx.now.getTime(),
      path: shot.path,
      width: shot.width,
      height: shot.height,
      copyText: shot.path,
      actions: [
        { type: 'path', label: 'Open', path: shot.path, mode: 'open' },
        { type: 'path', label: 'Show in folder', path: shot.path, mode: 'reveal' },
      ],
    };
    // The file is saved and the card says so; the preview opens on top (Capture Studio, if enabled).
    ctx.services.ui.openCaptureStudio({ path: shot.path, width: shot.width, height: shot.height });
    return { cards: [card], speech: 'Screenshot saved.' };
  },
});
