import { batteryCommand } from '../info/battery';
import { calculateCommand } from '../info/calculate';
import { convertCommand } from '../info/convert';
import { dateTimeCommand } from '../info/datetime';
import { dictionaryCommand } from '../info/define';
import { systemInfoCommand } from '../info/system-info';
import { weatherCommand } from '../info/weather';
import type { AnyCommandModule } from '../types';

/** Commands 6-12 (time/date, weather, battery, system info, calculate, convert, define). */
export const infoCommands: readonly AnyCommandModule[] = [
  dateTimeCommand,
  weatherCommand,
  batteryCommand,
  systemInfoCommand,
  calculateCommand,
  convertCommand,
  dictionaryCommand,
];
