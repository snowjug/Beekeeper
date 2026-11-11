import type { AnyCommandModule } from '../types';
import { brightnessCommand } from '../system-control/brightness';
import { darkModeCommand } from '../system-control/dark-mode';
import { lockCommand } from '../system-control/lock';
import { powerCommand } from '../system-control/power';
import { recycleBinCommand } from '../system-control/recycle-bin';
import { screenshotCommand } from '../system-control/screenshot';
import { settingsPagesCommand } from '../system-control/settings-pages';
import { volumeCommand } from '../system-control/volume';

/** Commands 18-25 (volume, brightness, screenshot, lock, settings pages, recycle bin, power, dark mode). */
export const systemCommands: readonly AnyCommandModule[] = [
  volumeCommand,
  brightnessCommand,
  screenshotCommand,
  lockCommand,
  settingsPagesCommand,
  recycleBinCommand,
  powerCommand,
  darkModeCommand,
];
