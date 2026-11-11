/** Data shapes that travel over IPC. Types only - safe to import from every process. */
import type { Card, CountdownCard, HistoryEntry } from '../cards';
import type { WindowRole } from '../windows';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  electron: string;
  chrome: string;
  isPackaged: boolean;
  isDev: boolean;
  /** Portable builds never auto-update. */
  portable: boolean;
  /** System backdrop applied to this window ('none' = CSS glass fallback). */
  material: 'mica' | 'acrylic' | 'none';
  /** Resolved colour scheme right now. */
  theme: 'light' | 'dark';
  role: WindowRole;
  /** Windows build number, 0 when unknown. */
  osBuild: number;
  userDataPath: string;
}

export type HotkeyId = 'assistant' | 'circle';

export interface HotkeyStatusEntry {
  accelerator: string;
  registered: boolean;
  error?: string;
}

export type HotkeyStatus = Record<HotkeyId, HotkeyStatusEntry>;

export type HotkeySetResult =
  | { ok: true; accelerator: string }
  | {
      ok: false;
      reason: 'invalid' | 'conflict' | 'reserved';
      message: string;
      suggestion?: string;
    };

export interface VoiceModelState {
  state: 'missing' | 'partial' | 'downloading' | 'ready' | 'error';
  receivedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  attempt: number;
  maxAttempts: number;
  message?: string;
  /** App-protocol URL vosk-browser loads the model from; null until ready. */
  modelUrl: string | null;
  /** Human-readable model name for the UI. */
  displayName: string;
}

export interface WorkerStatus {
  state: 'off' | 'loading' | 'armed' | 'paused' | 'error';
  message?: string;
}

export interface WorkerConfig {
  enabled: boolean;
  micDeviceId: string;
  modelUrl: string | null;
  phrases: string[];
}

export interface SubmitResult {
  turnId: string;
  cards: Card[];
  speech?: string;
  autoCloseMs?: number;
  pin?: boolean;
  closeNow?: boolean;
}

export type ConfirmResult =
  | { status: 'countdown'; card: CountdownCard }
  | { status: 'executed' }
  | { status: 'failed'; message: string }
  | { status: 'unknown' };

/** Streaming answer updates (Azure OpenAI). */
export interface StreamEvent {
  cardId: string;
  /** Text appended to the card's markdown. */
  delta?: string;
  done?: boolean;
  error?: string;
}

export interface TimerInfo {
  id: string;
  type: 'timer' | 'alarm' | 'reminder';
  label: string;
  durationMs: number;
  startedAt: number;
  endsAt: number;
  state: 'running' | 'done' | 'cancelled';
}

export interface TimerFiredEvent {
  timer: TimerInfo;
  missed: boolean;
}

export interface CardUpdateEvent {
  /** Replaces the card with this id (ConfirmCard -> CountdownCard -> outcome). */
  confirmId: string;
  replacement: Card | null;
}

export interface AssistantShowEvent {
  /** Start listening right away (hotkey / wake word). */
  listen: boolean;
  source: 'hotkey' | 'wake' | 'tray' | 'ptt' | 'second-instance' | 'api';
  /** Optional view to jump to (tray menu entries). */
  view?: 'notes' | 'timers' | 'history' | 'gallery';
}

export interface ToastEvent {
  title: string;
  message?: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  action?: { label: string; id: 'install-update' | 'open-settings' };
}

export interface UpdateState {
  status:
    'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error';
  version?: string;
  /** 0-100 while downloading. */
  progress?: number;
  message?: string;
}

export interface AiTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export interface SpeechTokenResult {
  token: string;
  region: string;
  /** Epoch ms at which the token stops being valid. */
  expiresAt: number;
}

// ---- Circle to Search ------------------------------------------------------

export interface CircleSession {
  id: string;
  /** App-protocol URL of the frozen screenshot (native resolution). */
  imageUrl: string;
  /** Native pixel size of the screenshot. */
  width: number;
  height: number;
  scaleFactor: number;
  display: { id: number; bounds: Rect };
  aiAvailable: boolean;
  defaultAction: 'show' | 'copy' | 'search' | 'translate';
}

export interface OcrWordDto {
  text: string;
  confidence: number;
  bbox: Rect;
}

export interface OcrLineDto {
  text: string;
  confidence: number;
  bbox: Rect;
  words: OcrWordDto[];
}

export interface OcrResultDto {
  text: string;
  confidence: number;
  lines: OcrLineDto[];
  words: OcrWordDto[];
  durationMs: number;
}

export interface SmartActionDto {
  id: string;
  type: 'url' | 'email' | 'phone' | 'date' | 'math';
  label: string;
  value: string;
  display: string;
}

export interface SmartActionResult {
  ok: boolean;
  message?: string;
  /** e.g. the evaluated expression for "Calculate". */
  resultText?: string;
}

export interface HistoryList {
  entries: HistoryEntry[];
  total: number;
}
