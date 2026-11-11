/** The command rules, most specific first. The first rule that recognises the utterance wins. */
import { Utterance } from '../utterance';
import { clockAnswerRule, durationAnswerRule, yesRule } from './answers';
import type { Rule } from './common';
import { closeRule, openRule, searchRule } from './apps';
import { briefingRule, circleRule, dictateRule, helpRule, repeatRule, stopRule } from './assistant';
import {
  batteryRule,
  calculateRule,
  convertRule,
  defineRule,
  systemInfoRule,
  timeRule,
  weatherFollowUpRule,
  weatherRule,
} from './info';
import { alarmRule, copyRule, notesRule, reminderRule, timerRule } from './productivity';
import {
  brightnessRule,
  darkModeRule,
  lockRule,
  powerRule,
  recycleRule,
  screenshotRule,
  settingsRule,
  volumeRule,
} from './system';

export const RULES: ReadonlyArray<readonly [id: string, rule: Rule]> = [
  ['stop', stopRule],
  ['help', helpRule],
  ['circle-to-search', circleRule],
  ['briefing', briefingRule],
  ['repeat', repeatRule],
  ['dictate', dictateRule],
  ['copy-that', copyRule],
  ['power', powerRule],
  ['lock', lockRule],
  ['recycle-bin', recycleRule],
  ['screenshot', screenshotRule],
  ['dark-mode', darkModeRule],
  ['settings', settingsRule],
  ['volume', volumeRule],
  ['brightness', brightnessRule],
  ['timer', timerRule],
  ['alarm', alarmRule],
  ['reminder', reminderRule],
  ['notes', notesRule],
  ['datetime', timeRule],
  ['weather', weatherRule],
  ['battery', batteryRule],
  ['system-info', systemInfoRule],
  ['calculate', calculateRule],
  ['convert', convertRule],
  ['define', defineRule],
  ['web-search', searchRule],
  ['open-app', openRule],
  ['close-app', closeRule],
  ['weather-follow-up', weatherFollowUpRule],
  ['duration-answer', durationAnswerRule],
  ['clock-answer', clockAnswerRule],
];

/**
 * The English command the utterance means and the rule that found it, or null. An agreeing word
 * ("ठीक है") only counts as an answer on its own; next to a command it is dropped.
 */
export function translate(u: Utterance): { english: string; rule: string } | null {
  const yes = yesRule(u);
  if (yes !== null) return { english: yes, rule: 'yes' };
  const plain = u.has('YES') ? new Utterance(u.toks.filter((token) => token.sym !== 'YES')) : u;
  for (const [rule, run] of RULES) {
    const english = run(plain);
    if (english !== null) return { english, rule };
  }
  return null;
}
