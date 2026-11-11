import type { AnyCommandModule } from '../types';
import { closeAppCommand } from '../apps-web/close-app';
import { openAppCommand } from '../apps-web/open-app';
import { openWebsiteCommand } from '../apps-web/open-website';
import { webSearchCommand } from '../apps-web/web-search';
import { youtubeCommand } from '../apps-web/youtube';

/** Commands 1-5 (open/close app, web search, YouTube, open website). */
export const appsWebCommands: readonly AnyCommandModule[] = [
  openAppCommand,
  closeAppCommand,
  webSearchCommand,
  youtubeCommand,
  openWebsiteCommand,
];
