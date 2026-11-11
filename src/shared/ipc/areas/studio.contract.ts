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

export type StudioAssistTask = 'text' | 'sensitive';

export interface SensitiveRegion {
  rect: StudioRect;
  kind: 'email' | 'phone' | 'card' | 'secret' | 'id';
  label: string;
}

export interface StudioAssistResult {
  ok: boolean;
  task: StudioAssistTask;
  message?: string;
  /** Text found in the image (task 'text'). */
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
  /** `anchor` (window DIPs) is the point that stays under the cursor while zooming. */
  | { type: 'scale'; value: number; anchor?: { x: number; y: number } }
  | { type: 'resetScale' }
  | { type: 'clickThrough'; value: boolean }
  /** Moves the window to this top-left position (screen DIPs): dragging is done by the page. */
  | { type: 'move'; x: number; y: number }
  /** While click-through is on: the pointer is over a control that must receive clicks. */
  | { type: 'interactive'; value: boolean }
  /** Opens the native context menu at the cursor. */
  | { type: 'menu' };

const sessionPng = z.object({ sessionId: identifier, png: pngBytes.optional() });
const position = z.number().min(-1_000_000).max(1_000_000);

export const studioInvokeSchemas = {
  'capture:start': { input: z.object({}).optional(), output: z.void() },

  'studio:getSession': { input: z.void(), output: out<StudioSession | null>() },
  'studio:ready': { input: z.object({ sessionId: identifier }), output: z.void() },
  'studio:activity': { input: z.object({ busy: z.boolean() }), output: z.void() },
  'studio:copy': { input: sessionPng, output: out<StudioActionResult>() },
  'studio:copyText': {
    input: z.object({ text: z.string().min(1).max(100_000) }),
    output: out<StudioActionResult>(),
  },
  'studio:searchText': {
    input: z.object({ text: z.string().min(1).max(4000) }),
    output: out<StudioActionResult>(),
  },
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
    input: sessionPng.extend({ task: z.enum(['text', 'sensitive']) }),
    output: out<StudioAssistResult>(),
  },
  'studio:delete': {
    input: z.object({ sessionId: identifier }),
    output: out<StudioActionResult>(),
  },
  'studio:openFolder': { input: z.void(), output: out<boolean>() },
  'studio:close': { input: z.object({ sessionId: identifier }), output: z.void() },

  'pin:getInfo': { input: z.void(), output: out<PinInfo | null>() },
  'pin:action': {
    input: z.discriminatedUnion('type', [
      z.object({ type: z.literal('close') }),
      z.object({ type: z.literal('copy') }),
      z.object({ type: z.literal('save') }),
      z.object({ type: z.literal('opacity'), value: z.number().min(0.1).max(1) }),
      z.object({
        type: z.literal('scale'),
        value: z.number().min(0.1).max(8),
        anchor: z.object({ x: position, y: position }).optional(),
      }),
      z.object({ type: z.literal('resetScale') }),
      z.object({ type: z.literal('clickThrough'), value: z.boolean() }),
      z.object({ type: z.literal('move'), x: position, y: position }),
      z.object({ type: z.literal('interactive'), value: z.boolean() }),
      z.object({ type: z.literal('menu') }),
    ]),
    output: z.void(),
  },
};

export const studioEventSchemas = {
  'studio:session': out<StudioSession>(),
  'studio:cancel': out<{ reason: 'escape' | 'blur' | 'api' | 'display-change' }>(),
  'pin:update': out<PinInfo>(),
};
