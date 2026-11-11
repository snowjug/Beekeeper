/** IPC schemas and payload types of Capture Studio and pinned screenshots. */
import { z } from 'zod';

const out = <T>() => z.custom<T>();

const identifier = z.string().min(1).max(120);

/** Upper bound for an edited bitmap sent back by the Studio (PNG bytes). */
export const MAX_STUDIO_PNG_BYTES = 80 * 1024 * 1024;

const pngBytes = z
  .instanceof(Uint8Array)
  .refine(
    (bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_STUDIO_PNG_BYTES,
    'Invalid image',
  );

export interface StudioRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StudioSource = 'hotkey' | 'voice' | 'tray' | 'circle' | 'file' | 'ui';

export interface StudioSession {
  id: string;
  /** App-protocol URL of the captured image (native resolution). */
  imageUrl: string;
  /** Native pixel size of the image. */
  width: number;
  height: number;
  scaleFactor: number;
  /** Path of the saved file when the capture was saved automatically. */
  savedPath: string | null;
  source: StudioSource;
  createdAt: number;
  display: { id: number; bounds: StudioRect };
  /** Azure OpenAI is configured, so "Ask AI" is available in Photo assist. */
  aiAvailable: boolean;
  glowFrame: boolean;
  dismissAfterSeconds: number;
  theme: 'light' | 'dark';
}

export type StudioAssistTask = 'text' | 'sensitive' | 'qr';

export interface SensitiveRegion {
  rect: StudioRect;
  kind: 'email' | 'phone' | 'card' | 'secret' | 'id';
  label: string;
}

export interface StudioAssistResult {
  ok: boolean;
  task: StudioAssistTask;
  message?: string;
  /** Text found in the image (task 'text'), or decoded QR payloads (task 'qr'). */
  text?: string;
  /** Regions to blur (task 'sensitive'), in image pixels. */
  regions?: SensitiveRegion[];
}

export type StudioShareTarget = 'file' | 'openWith' | 'reveal' | 'mail';

export interface StudioActionResult {
  ok: boolean;
  message?: string;
  path?: string;
}

export interface PinInfo {
  id: string;
  /** App-protocol URL of the pinned image. */
  imageUrl: string;
  /** Native pixel size of the image. */
  width: number;
  height: number;
  /** Current zoom (1 = native size). */
  scale: number;
  opacity: number;
  clickThrough: boolean;
}

export type PinAction =
  | { type: 'close' }
  | { type: 'copy' }
  | { type: 'save' }
  | { type: 'opacity'; value: number }
  | { type: 'scale'; value: number }
  | { type: 'resetScale' }
  | { type: 'clickThrough'; value: boolean };

const sessionPng = z.object({ sessionId: identifier, png: pngBytes.optional() });

export const studioInvokeSchemas = {
  'capture:start': { input: z.object({}).optional(), output: z.void() },

  'studio:getSession': { input: z.void(), output: out<StudioSession | null>() },
  'studio:ready': { input: z.object({ sessionId: identifier }), output: z.void() },
  'studio:copy': { input: sessionPng, output: out<StudioActionResult>() },
  'studio:save': {
    input: sessionPng.extend({ saveAs: z.boolean().optional() }),
    output: out<StudioActionResult>(),
  },
  'studio:pin': { input: sessionPng, output: out<StudioActionResult>() },
  'studio:wallpaper': { input: sessionPng, output: out<StudioActionResult>() },
  'studio:share': {
    input: sessionPng.extend({ target: z.enum(['file', 'openWith', 'reveal', 'mail']) }),
    output: out<StudioActionResult>(),
  },
  'studio:assist': {
    input: sessionPng.extend({ task: z.enum(['text', 'sensitive', 'qr']) }),
    output: out<StudioAssistResult>(),
  },
  'studio:delete': {
    input: z.object({ sessionId: identifier }),
    output: out<StudioActionResult>(),
  },
  'studio:openFolder': { input: z.void(), output: out<boolean>() },
  'studio:close': { input: z.void(), output: z.void() },

  'pin:getInfo': { input: z.void(), output: out<PinInfo | null>() },
  'pin:action': {
    input: z.discriminatedUnion('type', [
      z.object({ type: z.literal('close') }),
      z.object({ type: z.literal('copy') }),
      z.object({ type: z.literal('save') }),
      z.object({ type: z.literal('opacity'), value: z.number().min(0.1).max(1) }),
      z.object({ type: z.literal('scale'), value: z.number().min(0.1).max(8) }),
      z.object({ type: z.literal('resetScale') }),
      z.object({ type: z.literal('clickThrough'), value: z.boolean() }),
    ]),
    output: z.void(),
  },
};

export const studioEventSchemas = {
  'studio:session': out<StudioSession>(),
  'studio:cancel': out<{ reason: 'escape' | 'blur' | 'api' | 'display-change' }>(),
  'pin:update': out<PinInfo>(),
};
