import { SystemError } from '../../system/types';
import { failureResult, statusCard } from '../apps-web/cards';
import { defineCommand } from '../types';
import type { RunContext } from '../types';
import type { CommandResult } from '@shared/cards';
import { createLevelParser, type LevelAction } from './levels';

export type BrightnessSlots = LevelAction;

const BRIGHTNESS_PARSER = createLevelParser({
  noun: String.raw`(?:(?:screen|display|monitor|laptop)\s+)?brightness(?:\s+level)?`,
  typoWords: ['brightness'],
  comparatives: { brighter: 'up', dimmer: 'down', darker: 'down' },
  objects: String.raw`(?:(?:the|my)\s+)?(?:(?:laptop|computer|pc)\s+)?(?:screen|display|monitor)`,
  impliedVerbs: { dim: 'down', brighten: 'up' },
  pronounTurn: false,
  how: 'bright',
});

function unsupported(ctx: RunContext): CommandResult {
  const card = statusCard(ctx, {
    tone: 'warning',
    icon: 'brightness',
    title: "Brightness can't be changed here",
    detail:
      "This display doesn't support software brightness control (most desktop monitors don't). Use the buttons on your monitor instead.",
  });
  return { cards: [card], speech: "This display doesn't support brightness control." };
}

export const brightnessCommand = defineCommand<BrightnessSlots>({
  id: 'brightness',
  number: 19,
  group: 'system',
  title: 'Brightness',
  icon: 'brightness',
  examples: [
    'Brightness up',
    'Brightness down',
    'Set brightness to 70%',
    'Dim the screen',
    'Make the screen brighter',
    'Increase brightness by 20',
    "What's the brightness?",
  ],

  match(input) {
    return BRIGHTNESS_PARSER(input.text);
  },

  async run(slots, ctx) {
    const { system } = ctx.services;
    let level: number | null;
    try {
      if (slots.action === 'get') {
        level = await system.getBrightness();
      } else if (slots.action === 'set') {
        level = await system.setBrightness(slots.percent);
      } else {
        const current = await system.getBrightness();
        const delta = slots.direction === 'up' ? slots.amount : -slots.amount;
        level =
          current === null
            ? null
            : await system.setBrightness(Math.min(100, Math.max(0, current + delta)));
      }
    } catch (error) {
      if (error instanceof SystemError && error.code === 'unsupported') return unsupported(ctx);
      return failureResult(
        ctx,
        slots.action === 'get' ? 'read the brightness' : 'change the brightness',
        error,
      );
    }
    if (level === null) return unsupported(ctx);

    const card = statusCard(ctx, {
      tone: slots.action === 'get' ? 'neutral' : 'success',
      icon: 'brightness',
      title: `Brightness ${level}%`,
    });
    return { cards: [card], speech: `Brightness ${level} percent.`, autoCloseMs: 2500 };
  },
});
