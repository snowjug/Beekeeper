/**
 * IPC channel allow-lists (WHO may call/receive WHAT). Contains no runtime dependencies on purpose:
 * sandboxed preload scripts import this file to refuse unknown channels, and tree-shaking keeps zod
 * out of their bundles. Payload schemas live in ./schemas.ts and must cover every channel here.
 */
import type { WindowRole } from '../windows';
import { DICTATION_EVENTS, DICTATION_INVOKE } from './areas/dictation.channels';
import { SPEECH_EVENTS, SPEECH_INVOKE } from './areas/speech.channels';
import { STUDIO_EVENTS, STUDIO_INVOKE } from './areas/studio.channels';

type Roles = readonly WindowRole[];

const ALL = [
  'assistant',
  'circle',
  'edgeGlow',
  'settings',
  'onboarding',
  'worker',
  'studio',
  'pin',
  'dictation',
] as const;
const UI = ['assistant', 'circle', 'settings', 'onboarding'] as const;
const SETTINGS_UI = ['settings', 'onboarding'] as const;

/** renderer -> main (ipcRenderer.invoke / ipcMain.handle) */
export const INVOKE_CHANNELS = {
  ...SPEECH_INVOKE,
  ...STUDIO_INVOKE,
  ...DICTATION_INVOKE,

  // app
  'app:info': ALL,
  'app:log': ALL,
  'app:openExternal': UI,
  'app:copyText': ['assistant', 'circle', 'settings'],
  'os:openMicSettings': ['assistant', 'settings', 'onboarding'],

  // settings & hotkeys
  'settings:get': ALL,
  'settings:update': SETTINGS_UI,
  'hotkeys:status': ['assistant', 'settings', 'onboarding'],
  'hotkeys:set': SETTINGS_UI,

  // windows
  'window:openSettings': ['assistant', 'circle', 'studio'],
  'window:openOnboarding': ['settings'],
  'window:closeSelf': ['settings', 'onboarding', 'circle'],

  // assistant bar
  'assistant:submit': ['assistant'],
  'assistant:confirm': ['assistant'],
  'assistant:cancelPending': ['assistant'],
  'assistant:cardAction': ['assistant'],
  'assistant:setPinned': ['assistant'],
  'assistant:close': ['assistant'],
  'assistant:hidden': ['assistant'],
  'assistant:history': ['assistant', 'settings'],
  'assistant:clearHistory': ['assistant', 'settings'],
  'assistant:recall': ['assistant'],
  'assistant:timers': ['assistant'],
  'assistant:cancelTimer': ['assistant'],
  'assistant:stopStream': ['assistant'],

  // edge glow
  'glow:set': ['assistant'],

  // voice
  'voice:modelStatus': ['assistant', 'onboarding', 'settings', 'worker'],
  'voice:modelEnsure': ['assistant', 'onboarding', 'settings'],
  'voice:modelCancel': ['assistant', 'onboarding', 'settings'],
  'voice:modelRemove': ['settings'],
  'voice:micActive': ['assistant', 'worker'],
  'voice:wakeDetected': ['worker'],
  'voice:workerStatus': ['worker'],

  // Azure (optional)
  'ai:setKey': ['settings'],
  'ai:clearKey': ['settings'],
  'ai:test': ['settings'],
  'ai:speechToken': ['assistant'],

  // circle to search
  'circle:getSession': ['circle'],
  'circle:ready': ['circle'],
  'circle:ocr': ['circle'],
  'circle:tap': ['circle'],
  'circle:copyImage': ['circle'],
  'circle:saveImage': ['circle'],
  'circle:searchImage': ['circle'],
  'circle:openText': ['circle'],
  'circle:smartAction': ['circle'],
  'circle:askAi': ['circle'],
  'circle:stopAi': ['circle'],
  'circle:close': ['circle'],

  // privacy / maintenance / updates / onboarding
  'privacy:clearNotes': ['settings'],
  'privacy:openLogs': ['settings'],
  'updates:check': ['settings', 'assistant'],
  'updates:install': ['settings', 'assistant'],
  'updates:state': ['settings', 'assistant'],
  'onboarding:finish': ['onboarding'],
} as const satisfies Record<string, Roles>;

/** main -> renderer (webContents.send / ipcRenderer.on) */
export const EVENT_CHANNELS = {
  ...SPEECH_EVENTS,
  ...STUDIO_EVENTS,
  ...DICTATION_EVENTS,

  'theme:changed': ALL,
  'settings:changed': ALL,
  'settings:navigate': ['settings'],
  'assistant:show': ['assistant'],
  'assistant:hide': ['assistant'],
  'assistant:startListening': ['assistant'],
  'assistant:stopListening': ['assistant'],
  'assistant:stopSpeaking': ['assistant'],
  'assistant:stream': ['assistant'],
  'assistant:timerFired': ['assistant'],
  'assistant:cardUpdate': ['assistant'],

  'toast:show': ['assistant', 'settings'],
  'updates:state': ['settings', 'assistant'],

  'voice:modelProgress': ['assistant', 'onboarding', 'settings'],
  'voice:wakeStatus': ['settings', 'onboarding'],
  'worker:config': ['worker'],
  'worker:setPaused': ['worker'],

  'glow:state': ['edgeGlow'],

  'circle:session': ['circle'],
  'circle:cancel': ['circle'],
  'circle:aiChunk': ['circle'],
} as const satisfies Record<string, Roles>;

export type InvokeChannel = keyof typeof INVOKE_CHANNELS;
export type EventChannel = keyof typeof EVENT_CHANNELS;

type ChannelsFor<R extends WindowRole, Map extends Record<string, Roles>> = {
  [K in keyof Map]: R extends Map[K][number] ? K : never;
}[keyof Map];

export type InvokeChannelFor<R extends WindowRole> = ChannelsFor<R, typeof INVOKE_CHANNELS>;
export type EventChannelFor<R extends WindowRole> = ChannelsFor<R, typeof EVENT_CHANNELS>;

export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return typeof value === 'string' && Object.hasOwn(INVOKE_CHANNELS, value);
}

export function isEventChannel(value: unknown): value is EventChannel {
  return typeof value === 'string' && Object.hasOwn(EVENT_CHANNELS, value);
}

export function canInvoke(role: WindowRole, channel: string): channel is InvokeChannel {
  return isInvokeChannel(channel) && (INVOKE_CHANNELS[channel] as Roles).includes(role);
}

export function canReceive(role: WindowRole, channel: string): channel is EventChannel {
  return isEventChannel(channel) && (EVENT_CHANNELS[channel] as Roles).includes(role);
}
