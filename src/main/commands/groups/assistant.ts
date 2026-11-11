import { circleToSearchCommand } from '../assistant/circle-to-search';
import { dictateCommand } from '../assistant/dictation';
import { settingsAndHelpCommand } from '../assistant/settings-and-help';
import { stopCommand } from '../assistant/stop';
import type { AnyCommandModule } from '../types';

/** Commands 26-29 (circle to search, open settings / what can you do, stop / cancel, dictation). */
export const assistantCommands: readonly AnyCommandModule[] = [
  circleToSearchCommand,
  settingsAndHelpCommand,
  stopCommand,
  dictateCommand,
];
