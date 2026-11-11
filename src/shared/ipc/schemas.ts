/**
 * zod schemas for every IPC channel (inputs are validated in the main process; outputs and event
 * payloads are typed with z.custom so the contract stays one source of truth without runtime cost).
 * `satisfies` makes the compiler fail when a channel in channels.ts has no schema (or vice versa).
 */
import { z } from 'zod';
import type { Card } from '../cards';
import { SettingsPatchSchema, type SettingsView } from '../settings';
import type { WindowRole } from '../windows';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type EventChannel, type InvokeChannel } from './channels';
import type {
  AiTestResult,
  AppInfo,
  AssistantShowEvent,
  CardUpdateEvent,
  CircleSession,
  ConfirmResult,
  HistoryList,
  HotkeySetResult,
  HotkeyStatus,
  OcrResultDto,
  SmartActionResult,
  SpeechTokenResult,
  StreamEvent,
  SubmitResult,
  TimerFiredEvent,
  TimerInfo,
  ToastEvent,
  UpdateState,
  VoiceModelState,
  WorkerConfig,
  WorkerStatus,
} from './types';

const out = <T>() => z.custom<T>();

const identifier = z.string().min(1).max(120);
const finite = z.number().finite();
const rectSchema = z.object({
  x: finite,
  y: finite,
  width: finite.positive().max(20_000),
  height: finite.positive().max(20_000),
});
const pointSchema = z.object({ x: finite, y: finite });

export const cardActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'), label: z.string().max(80), url: z.string().max(2048) }),
  z.object({
    type: z.literal('command'),
    label: z.string().max(80),
    text: z.string().min(1).max(2000),
  }),
  z.object({
    type: z.literal('path'),
    label: z.string().max(80),
    path: z.string().min(1).max(1024),
    mode: z.enum(['open', 'reveal']),
  }),
]);

export const SETTINGS_PAGES = [
  'general',
  'voice',
  'hotkeys',
  'circle',
  'ai',
  'privacy',
  'updates',
  'about',
] as const;

const secretName = z.enum(['speech', 'openai']);

export const invokeSchemas = {
  'app:info': { input: z.void(), output: out<AppInfo>() },
  'app:log': {
    input: z.object({
      level: z.enum(['debug', 'info', 'warn', 'error']),
      scope: z.string().max(40),
      message: z.string().max(4000),
      stack: z.string().max(8000).optional(),
    }),
    output: z.void(),
  },
  'app:openExternal': { input: z.object({ url: z.string().max(2048) }), output: out<boolean>() },
  'app:copyText': { input: z.object({ text: z.string().max(100_000) }), output: z.void() },
  'os:openMicSettings': { input: z.void(), output: out<boolean>() },

  'settings:get': { input: z.void(), output: out<SettingsView>() },
  'settings:update': { input: SettingsPatchSchema, output: out<SettingsView>() },
  'hotkeys:status': { input: z.void(), output: out<HotkeyStatus>() },
  'hotkeys:set': {
    input: z.object({
      id: z.enum(['assistant', 'circle']),
      accelerator: z.string().min(1).max(60),
    }),
    output: out<HotkeySetResult>(),
  },

  'window:openSettings': {
    input: z.object({ section: z.enum(SETTINGS_PAGES).optional() }),
    output: z.void(),
  },
  'window:openOnboarding': { input: z.void(), output: z.void() },
  'window:closeSelf': { input: z.void(), output: z.void() },

  'assistant:submit': {
    input: z.object({
      text: z.string().trim().min(1).max(2000),
      source: z.enum(['text', 'voice', 'chip', 'circle']),
    }),
    output: out<SubmitResult>(),
  },
  'assistant:confirm': { input: z.object({ confirmId: identifier }), output: out<ConfirmResult>() },
  'assistant:cancelPending': {
    input: z.object({ confirmId: identifier.optional() }),
    output: out<{ cancelled: number }>(),
  },
  'assistant:cardAction': { input: z.object({ action: cardActionSchema }), output: out<boolean>() },
  'assistant:setPinned': { input: z.object({ pinned: z.boolean() }), output: z.void() },
  'assistant:close': {
    input: z.object({ reason: z.enum(['escape', 'backdrop', 'auto', 'command']) }),
    output: z.void(),
  },
  'assistant:hidden': { input: z.void(), output: z.void() },
  'assistant:history': {
    input: z.object({
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    output: out<HistoryList>(),
  },
  'assistant:clearHistory': { input: z.void(), output: out<number>() },
  'assistant:recall': {
    input: z.object({ offset: z.number().int().min(0).max(200) }),
    output: out<string | null>(),
  },
  'assistant:timers': { input: z.void(), output: out<TimerInfo[]>() },
  'assistant:cancelTimer': { input: z.object({ id: identifier }), output: out<boolean>() },
  'assistant:stopStream': { input: z.object({ cardId: identifier.optional() }), output: z.void() },

  'glow:set': { input: z.object({ active: z.boolean() }), output: z.void() },

  'voice:modelStatus': { input: z.void(), output: out<VoiceModelState>() },
  'voice:modelEnsure': { input: z.void(), output: out<VoiceModelState>() },
  'voice:modelCancel': { input: z.void(), output: out<VoiceModelState>() },
  'voice:modelRemove': { input: z.void(), output: out<VoiceModelState>() },
  'voice:micActive': { input: z.object({ active: z.boolean() }), output: z.void() },
  'voice:wakeDetected': {
    input: z.object({ phrase: z.string().max(80), confidence: finite.min(0).max(1).optional() }),
    output: z.void(),
  },
  'voice:workerStatus': {
    input: z.object({
      state: z.enum(['off', 'loading', 'armed', 'paused', 'error']),
      message: z.string().max(300).optional(),
    }),
    output: z.void(),
  },

  'ai:setKey': {
    input: z.object({ name: secretName, value: z.string().trim().min(8).max(400) }),
    output: out<SettingsView>(),
  },
  'ai:clearKey': { input: z.object({ name: secretName }), output: out<SettingsView>() },
  'ai:test': { input: z.object({ service: secretName }), output: out<AiTestResult>() },
  'ai:speechToken': { input: z.void(), output: out<SpeechTokenResult | null>() },

  'circle:getSession': { input: z.void(), output: out<CircleSession | null>() },
  'circle:ready': { input: z.object({ sessionId: identifier }), output: z.void() },
  'circle:ocr': {
    input: z.object({ sessionId: identifier, rect: rectSchema }),
    output: out<OcrResultDto>(),
  },
  'circle:tap': {
    input: z.object({
      sessionId: identifier,
      point: pointSchema,
      whole: z.enum(['word', 'line']).default('word'),
    }),
    output: out<{ rect: z.infer<typeof rectSchema>; result: OcrResultDto } | null>(),
  },
  'circle:copyImage': {
    input: z.object({ sessionId: identifier, rect: rectSchema }),
    output: out<boolean>(),
  },
  'circle:saveImage': {
    input: z.object({ sessionId: identifier, rect: rectSchema }),
    output: out<{ path: string } | null>(),
  },
  'circle:searchImage': {
    input: z.object({ sessionId: identifier, rect: rectSchema }),
    output: out<boolean>(),
  },
  'circle:openText': {
    input: z.object({ kind: z.enum(['search', 'translate']), text: z.string().min(1).max(4000) }),
    output: out<boolean>(),
  },
  'circle:smartAction': {
    input: z.object({
      type: z.enum(['url', 'email', 'phone', 'date', 'math']),
      value: z.string().min(1).max(2000),
    }),
    output: out<SmartActionResult>(),
  },
  'circle:askAi': {
    input: z.object({
      sessionId: identifier,
      rect: rectSchema,
      question: z.string().trim().max(1000).optional(),
      streamId: identifier,
    }),
    output: z.void(),
  },
  'circle:stopAi': { input: z.object({ streamId: identifier.optional() }), output: z.void() },
  'circle:close': { input: z.void(), output: z.void() },

  'privacy:clearNotes': { input: z.void(), output: out<number>() },
  'privacy:openLogs': { input: z.void(), output: z.void() },
  'updates:check': { input: z.void(), output: out<UpdateState>() },
  'updates:install': { input: z.void(), output: z.void() },
  'updates:state': { input: z.void(), output: out<UpdateState>() },
  'onboarding:finish': { input: z.void(), output: z.void() },
} satisfies { [K in InvokeChannel]: { input: z.ZodType; output: z.ZodType } };

export const eventSchemas = {
  'theme:changed': out<{ theme: 'light' | 'dark' }>(),
  'settings:changed': out<SettingsView>(),
  'settings:navigate': out<{ section: (typeof SETTINGS_PAGES)[number] }>(),
  'assistant:show': out<AssistantShowEvent>(),
  'assistant:hide': out<{ reason: 'blur' | 'hotkey' | 'escape' | 'api' }>(),
  'assistant:startListening': out<{ source: AssistantShowEvent['source'] }>(),
  'assistant:stopListening': out<{ submit: boolean }>(),
  'assistant:stopSpeaking': out<Record<string, never>>(),
  'assistant:stream': out<StreamEvent>(),
  'assistant:timerFired': out<TimerFiredEvent>(),
  'assistant:cardUpdate': out<CardUpdateEvent>(),

  'toast:show': out<ToastEvent>(),
  'updates:state': out<UpdateState>(),

  'voice:modelProgress': out<VoiceModelState>(),
  'voice:wakeStatus': out<WorkerStatus>(),
  'worker:config': out<WorkerConfig>(),
  'worker:setPaused': out<{ paused: boolean }>(),

  'glow:state': out<{ active: boolean; theme: 'light' | 'dark' }>(),

  'circle:session': out<CircleSession>(),
  'circle:cancel': out<{ reason: 'hotkey' | 'blur' | 'display-change' | 'api' }>(),
  'circle:aiChunk': out<{ streamId: string; delta?: string; done?: boolean; error?: string }>(),
} satisfies { [K in EventChannel]: z.ZodType };

export type InvokeInput<C extends InvokeChannel> = z.input<(typeof invokeSchemas)[C]['input']>;
export type InvokeParsed<C extends InvokeChannel> = z.output<(typeof invokeSchemas)[C]['input']>;
export type InvokeOutput<C extends InvokeChannel> = z.output<(typeof invokeSchemas)[C]['output']>;
export type EventPayload<C extends EventChannel> = z.output<(typeof eventSchemas)[C]>;

/** Runtime sanity check used by tests and the router: the two tables describe the same channels. */
export function contractIsConsistent(): boolean {
  const invokeKeys = Object.keys(INVOKE_CHANNELS).sort();
  const invokeSchemaKeys = Object.keys(invokeSchemas).sort();
  const eventKeys = Object.keys(EVENT_CHANNELS).sort();
  const eventSchemaKeys = Object.keys(eventSchemas).sort();
  return (
    JSON.stringify(invokeKeys) === JSON.stringify(invokeSchemaKeys) &&
    JSON.stringify(eventKeys) === JSON.stringify(eventSchemaKeys)
  );
}

export type { Card, WindowRole };
