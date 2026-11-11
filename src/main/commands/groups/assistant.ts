import { circleToSearchCommand } from '../assistant/circle-to-search';
import { settingsAndHelpCommand } from '../assistant/settings-and-help';
import { stopCommand } from '../assistant/stop';
import type { AnyCommandModule } from '../types';

/** Commands 26-28 (circle to search, open settings / what can you do, stop / cancel). */
export const assistantCommands: readonly AnyCommandModule[] = [
  circleToSearchCommand,
  settingsAndHelpCommand,
  stopCommand,
];
