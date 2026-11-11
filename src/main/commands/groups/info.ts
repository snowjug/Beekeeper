import { batteryCommand } from '../info/battery';
import { briefingCommand } from '../info/briefing';
import { calculateCommand } from '../info/calculate';
import { convertCommand } from '../info/convert';
import { dateTimeCommand } from '../info/datetime';
import { dictionaryCommand } from '../info/define';
import { systemInfoCommand } from '../info/system-info';
import { weatherCommand } from '../info/weather';
import { repeatCommand } from '../assistant/repeat';
import type { AnyCommandModule } from '../types';

/**
 * Commands 6-12 (time/date, weather, battery, system info, calculate, convert, define) plus the
 * v1.1 additions: daily briefing (40) and "repeat that" (41).
 */
export const infoCommands: readonly AnyCommandModule[] = [
  dateTimeCommand,
  weatherCommand,
  batteryCommand,
  systemInfoCommand,
  calculateCommand,
  convertCommand,
  dictionaryCommand,
  briefingCommand,
  repeatCommand,
];
