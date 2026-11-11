import type { StatusCard } from '@shared/cards';
import type { VolumeState } from '../../system/types';
import { failureResult, statusCard } from '../apps-web/cards';
import { defineCommand } from '../types';
import { createLevelParser, type LevelAction } from './levels';

export type VolumeSlots = LevelAction | { action: 'mute' } | { action: 'unmute' };

const VOLUME_PARSER = createLevelParser({
  noun: String.raw`volume(?:\s+level)?`,
  typoWords: ['volume'],
  comparatives: { louder: 'up', quieter: 'down', softer: 'down' },
  objects: null,
  impliedVerbs: {},
  pronounTurn: true,
  how: 'loud',
});

/** Things that can be muted. "mute my pc" is fine; "turn off my pc" is the power command. */
const MUTE_TARGET = String.raw`(?:the\s+|my\s+)?(?:volume|sound|audio|speakers?|pc|computer|laptop|system)`;
const SOUND_TARGET = String.raw`(?:the\s+|my\s+)?(?:volume|sound|audio|speakers?)`;
const MUTE = new RegExp(String.raw`^(?<un>un\s?)?mute(?:\s+${MUTE_TARGET})?$`);
const TURN_TARGET_STATE = new RegExp(
  String.raw`^(?:turn|switch)\s+${SOUND_TARGET}\s+(?<state>off|on)$`,
);
const TURN_STATE_TARGET = new RegExp(
  String.raw`^(?:turn|switch)\s+(?<state>off|on)\s+${SOUND_TARGET}$`,
);

function parseMute(text: string): VolumeSlots | null {
  const muteMatch = MUTE.exec(text);
  if (muteMatch !== null) {
    return { action: muteMatch.groups?.['un'] === undefined ? 'mute' : 'unmute' };
  }
  const state = (TURN_TARGET_STATE.exec(text) ?? TURN_STATE_TARGET.exec(text))?.groups?.['state'];
  if (state === undefined) return null;
  return { action: state === 'off' ? 'mute' : 'unmute' };
}

function volumeCard(
  ctx: Parameters<typeof statusCard>[0],
  slots: VolumeSlots,
  state: VolumeState,
): StatusCard {
  const silent = state.muted || state.percent === 0;
  return statusCard(ctx, {
    tone: slots.action === 'get' ? 'neutral' : 'success',
    icon: silent ? 'mute' : 'volume',
    title: state.muted ? 'Muted' : `Volume ${state.percent}%`,
    detail: state.muted
      ? `The volume is at ${state.percent}%`
      : slots.action === 'unmute'
        ? 'Sound is back on'
        : undefined,
  });
}

function volumeSpeech(slots: VolumeSlots, state: VolumeState): string {
  if (state.muted) return 'Muted.';
  const level = `Volume ${state.percent} percent.`;
  return slots.action === 'unmute' ? `Unmuted. ${level}` : level;
}

export const volumeCommand = defineCommand<VolumeSlots>({
  id: 'volume',
  number: 18,
  group: 'system',
  title: 'Volume',
  icon: 'volume',
  examples: [
    'Volume up',
    'Turn the volume down',
    'Louder',
    'Mute',
    'Unmute',
    'Set volume to 40%',
    'Increase volume by 10',
    "What's the volume?",
  ],

  match(input) {
    const mute = parseMute(input.text);
    if (mute !== null) return { slots: mute, score: mute.action === 'unmute' ? 0.95 : 0.92 };
    const level = VOLUME_PARSER(input.text);
    return level === null ? null : { slots: level.slots, score: level.score };
  },

  async run(slots, ctx) {
    const { system } = ctx.services;
    let state: VolumeState;
    try {
      switch (slots.action) {
        case 'step':
          state = await system.adjustVolume(
            slots.direction === 'up' ? slots.amount : -slots.amount,
          );
          break;
        case 'set':
          state = await system.setVolume(slots.percent);
          break;
        case 'mute':
          state = await system.setMuted(true);
          break;
        case 'unmute':
          state = await system.setMuted(false);
          break;
        case 'get':
          state = await system.getVolume();
          break;
      }
    } catch (error) {
      return failureResult(
        ctx,
        slots.action === 'get' ? 'read the volume' : 'change the volume',
        error,
      );
    }
    return {
      cards: [volumeCard(ctx, slots, state)],
      speech: volumeSpeech(slots, state),
      autoCloseMs: 2500,
    };
  },
});
