import type { AnyCommandModule } from '../types';
import { alarmCommand } from '../productivity/alarm';
import { copyThatCommand } from '../productivity/copyThat';
import { notesCommand } from '../productivity/notes';
import { reminderCommand } from '../productivity/reminder';
import { timerCommand } from '../productivity/timer';

/** Commands 13-17 (timer, reminder, alarm, notes, copy that). */
export const productivityCommands: readonly AnyCommandModule[] = [
  timerCommand,
  reminderCommand,
  alarmCommand,
  notesCommand,
  copyThatCommand,
];
