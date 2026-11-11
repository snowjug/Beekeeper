import { matchLeadingVerb, matchPhrase, stripArticles } from '../text';
import { defineCommand } from '../types';

type NoSlots = Record<string, never>;

const EMPTY_VERBS = ['empty', 'clear', 'clean out', 'clean up', 'clean', 'purge', 'flush', 'wipe'];
const BIN_PHRASES = [
  'recycle bin',
  'recycling bin',
  'recycle',
  'trash',
  'trash can',
  'trashcan',
  'bin',
  'garbage',
  'rubbish bin',
  'waste bin',
];
/** "delete everything in the recycle bin". */
const DELETE_ALL = new RegExp(
  String.raw`^delete\s+(?:everything|all(?:\s+the)?(?:\s+files)?)\s+(?:in|from|out\s+of)\s+(?:the\s+|my\s+)?(.+)$`,
);

function isBin(phrase: string): boolean {
  return matchPhrase(stripArticles(phrase), BIN_PHRASES) !== null;
}

export const recycleBinCommand = defineCommand<NoSlots>({
  id: 'recycle-bin',
  number: 23,
  group: 'system',
  title: 'Empty the Recycle Bin',
  icon: 'trash',
  examples: [
    'Empty the recycle bin',
    'Empty recycle bin',
    'Clear the trash',
    'Empty trash',
    'Clean out the recycle bin',
  ],

  match(input) {
    const verb = matchLeadingVerb(input.text, EMPTY_VERBS);
    if (verb !== null && isBin(verb.rest)) return { slots: {}, score: verb.exact ? 0.95 : 0.85 };
    const deleted = DELETE_ALL.exec(input.text)?.[1];
    return deleted !== undefined && isBin(deleted) ? { slots: {}, score: 0.95 } : null;
  },

  run(_slots, ctx) {
    const { system, confirm } = ctx.services;
    const card = confirm.request({
      action: 'empty-recycle-bin',
      title: 'Empty the Recycle Bin?',
      detail: "Everything in it is deleted for good. This can't be undone.",
      confirmLabel: 'Empty Recycle Bin',
      danger: true,
      run: () => system.emptyRecycleBin(),
    });
    return { cards: [card], speech: "Empty the Recycle Bin? This can't be undone.", pin: true };
  },
});
