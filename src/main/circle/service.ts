import type { Rect, Size } from '@shared/geometry';
import type { Logger } from '@shared/logger';
import type { CircleSession, OcrResultDto, SmartActionResult } from '@shared/ipc/types';
import type { Settings } from '@shared/settings';
import {
  buildBingSearchUrl,
  buildBingTranslateUrl,
  BING_VISUAL_SEARCH_URL,
  buildMailtoUrl,
} from '@shared/webLinks';
import type { CaptureStore } from '../capture/store';
import type { OcrService } from '../capture/ocr';
import type { VisionEmit, VisionRequest } from '../ai/aiService';
import {
  ocrResultToDip,
  ocrUpscaleFactor,
  pickTapTarget,
  selectionToCrop,
  tapBand,
  tapResult,
  tapSelection,
  type OverlayGeometry,
} from './mapping';

/** The slice of Electron's NativeImage the service needs (fakes implement it in unit tests). */
export interface CircleImage {
  getSize(): Size;
  crop(rect: Rect): CircleImage;
  resize(size: Size): CircleImage;
  toPNG(): Buffer;
  toJPEG(quality: number): Buffer;
}

export interface CircleCapture {
  image: CircleImage;
  /** Native pixel size of the captured image. */
  width: number;
  height: number;
  scaleFactor: number;
  display: { id: number; bounds: Rect };
}

export interface CircleActions {
  copyImage(image: CircleImage): Promise<void>;
  copyText(text: string): Promise<void>;
  /** Writes a PNG into the Beekeeper pictures folder and returns its path. */
  savePng(png: Buffer): Promise<string>;
  openExternal(url: string): Promise<boolean>;
  /** Schedules a reminder at an ISO date/time; returns false when the date is in the past. */
  addReminder(iso: string, label: string): boolean;
  /** Evaluates an arithmetic expression with the safe parser; null when it cannot be evaluated. */
  calculate(expression: string): string | null;
}

export interface CircleAi {
  isConfigured(): boolean;
  askAboutImage(request: VisionRequest, signal: AbortSignal, emit: VisionEmit): Promise<void>;
}

export interface CircleServiceDeps {
  ocr: OcrService;
  store: CaptureStore;
  actions: CircleActions;
  ai: CircleAi;
  settings: () => Settings;
  newId: () => string;
  logger: Logger;
}

export interface CircleSessionRecord {
  id: string;
  image: CircleImage;
  geometry: OverlayGeometry;
  scaleFactor: number;
  display: CircleCapture['display'];
}

const JPEG_QUALITY = 90;
const MAX_TEXT_FOR_URL = 1000;

function assertRect(rect: Rect, geometry: OverlayGeometry): Rect {
  const crop = selectionToCrop(rect, geometry);
  if (crop.width <= 0 || crop.height <= 0) throw new Error('The selection is outside the screen.');
  return crop;
}

/**
 * Circle to Search back end: owns the frozen capture of a session and everything done with a
 * selection of it (OCR, tap targeting, clipboard/file actions, smart actions). The overlay window
 * itself is managed by CircleWindowController; this class has no Electron dependency so it is
 * unit tested with fake images, OCR and actions.
 */
export class CircleService {
  private session: CircleSessionRecord | null = null;
  private ocrAbort: AbortController | null = null;
  private aiAbort: AbortController | null = null;

  constructor(private readonly deps: CircleServiceDeps) {}

  current(): CircleSessionRecord | null {
    return this.session;
  }

  /** Registers a capture of the display under the cursor. Replaces and frees the previous session. */
  register(capture: CircleCapture): CircleSession {
    this.end();
    const id = this.deps.newId();
    const size = capture.image.getSize();
    const record: CircleSessionRecord = {
      id,
      image: capture.image,
      geometry: {
        bounds: { width: capture.display.bounds.width, height: capture.display.bounds.height },
        image: size,
      },
      scaleFactor: capture.scaleFactor,
      display: capture.display,
    };
    this.session = record;
    this.deps.store.put(id, capture.image.toJPEG(JPEG_QUALITY), 'image/jpeg');
    return this.describe(record);
  }

  describe(record: CircleSessionRecord = this.require()): CircleSession {
    return {
      id: record.id,
      imageUrl: `beekeeper://app/capture/${record.id}.jpg`,
      width: record.geometry.image.width,
      height: record.geometry.image.height,
      scaleFactor: record.scaleFactor,
      display: record.display,
      aiAvailable: this.deps.ai.isConfigured(),
      defaultAction: this.deps.settings().circle.defaultAction,
    };
  }

  /** Drops the session: the capture must not outlive the overlay. */
  end(): void {
    this.ocrAbort?.abort();
    this.ocrAbort = null;
    this.stopAi();
    if (this.session) this.deps.store.delete(this.session.id);
    this.session = null;
  }

  /** Streams an Azure OpenAI answer about the selection; chunks arrive through `emit`. */
  askAi(
    sessionId: string,
    selection: Rect,
    question: string | undefined,
    streamId: string,
    emit: VisionEmit,
  ): void {
    const png = this.cropPng(sessionId, selection);
    this.stopAi();
    const abort = new AbortController();
    this.aiAbort = abort;
    void this.deps.ai.askAboutImage({ png, question, streamId }, abort.signal, emit).finally(() => {
      if (this.aiAbort === abort) this.aiAbort = null;
    });
  }

  stopAi(): void {
    this.aiAbort?.abort();
    this.aiAbort = null;
  }

  /** Reads the text inside a selection (overlay DIPs). A newer request cancels the previous one. */
  async recognize(sessionId: string, selection: Rect): Promise<OcrResultDto> {
    const record = this.require(sessionId);
    const crop = assertRect(selection, record.geometry);
    return this.runOcr(record, crop);
  }

  /** Reads one line around a tap and returns the word (or line) under the pointer. */
  async tap(
    sessionId: string,
    point: { x: number; y: number },
    whole: 'word' | 'line',
  ): Promise<{ rect: Rect; result: OcrResultDto } | null> {
    const record = this.require(sessionId);
    const band = tapBand(point, record.geometry.bounds);
    const crop = assertRect(band, record.geometry);
    const result = await this.runOcr(record, crop);
    const hit = pickTapTarget(result, point);
    if (!hit) return null;
    return {
      rect: tapSelection(hit, whole, record.geometry.bounds),
      result: tapResult(hit, whole),
    };
  }

  async copyImage(sessionId: string, selection: Rect): Promise<boolean> {
    const record = this.require(sessionId);
    await this.deps.actions.copyImage(this.cropOf(record, selection));
    return true;
  }

  async saveImage(sessionId: string, selection: Rect): Promise<{ path: string } | null> {
    const record = this.require(sessionId);
    const path = await this.deps.actions.savePng(this.cropOf(record, selection).toPNG());
    return { path };
  }

  /** Bing Visual Search cannot be fed a file from a desktop app, so the crop goes to the clipboard. */
  async searchImage(sessionId: string, selection: Rect): Promise<boolean> {
    const record = this.require(sessionId);
    await this.deps.actions.copyImage(this.cropOf(record, selection));
    return this.deps.actions.openExternal(BING_VISUAL_SEARCH_URL);
  }

  async openText(kind: 'search' | 'translate', text: string): Promise<boolean> {
    const trimmed = text.trim().slice(0, MAX_TEXT_FOR_URL);
    if (trimmed === '') return false;
    const url = kind === 'search' ? buildBingSearchUrl(trimmed) : buildBingTranslateUrl(trimmed);
    return this.deps.actions.openExternal(url);
  }

  async smartAction(
    type: 'url' | 'email' | 'phone' | 'date' | 'math',
    value: string,
  ): Promise<SmartActionResult> {
    const { actions } = this.deps;
    switch (type) {
      case 'url': {
        const opened = await actions.openExternal(value);
        return opened ? { ok: true } : { ok: false, message: 'That link cannot be opened.' };
      }
      case 'email': {
        const mailto = buildMailtoUrl(value);
        if (!mailto) return { ok: false, message: 'That e-mail address looks invalid.' };
        const opened = await actions.openExternal(mailto);
        return opened ? { ok: true } : { ok: false, message: 'No mail app could be opened.' };
      }
      case 'phone':
        await actions.copyText(value);
        return { ok: true, message: 'Phone number copied.' };
      case 'date': {
        const added = actions.addReminder(value, 'Reminder from Circle to Search');
        return added
          ? { ok: true, message: 'Reminder added.' }
          : { ok: false, message: 'That date has already passed.' };
      }
      case 'math': {
        const result = actions.calculate(value);
        if (result === null) return { ok: false, message: 'I could not calculate that.' };
        await actions.copyText(result);
        return { ok: true, message: `${value} = ${result} (copied)`, resultText: result };
      }
    }
  }

  /** PNG crop of a selection for Ask-AI, downscaled so the request stays small. */
  cropPng(sessionId: string, selection: Rect, maxSide = 1600): Buffer {
    let image = this.cropOf(this.require(sessionId), selection);
    const { width, height } = image.getSize();
    const longest = Math.max(width, height);
    if (longest > maxSide) {
      const ratio = maxSide / longest;
      image = image.resize({
        width: Math.max(1, Math.round(width * ratio)),
        height: Math.max(1, Math.round(height * ratio)),
      });
    }
    return image.toPNG();
  }

  private cropOf(record: CircleSessionRecord, selection: Rect): CircleImage {
    return record.image.crop(assertRect(selection, record.geometry));
  }

  private require(sessionId?: string): CircleSessionRecord {
    const record = this.session;
    if (!record || (sessionId !== undefined && record.id !== sessionId)) {
      throw new Error('Circle to Search is not active.');
    }
    return record;
  }

  private async runOcr(record: CircleSessionRecord, crop: Rect): Promise<OcrResultDto> {
    this.ocrAbort?.abort();
    const abort = new AbortController();
    this.ocrAbort = abort;

    const factor = ocrUpscaleFactor(crop, record.scaleFactor);
    let source = record.image.crop(crop);
    if (factor !== 1) {
      source = source.resize({
        width: Math.round(crop.width * factor),
        height: Math.round(crop.height * factor),
      });
    }
    try {
      const result = await this.deps.ocr.recognize(source.toPNG(), {
        signal: abort.signal,
        supersedePending: true,
      });
      return ocrResultToDip(result, crop, factor, record.geometry);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'aborted' && code !== 'superseded') {
        this.deps.logger.warn('Circle to Search OCR failed', code ?? 'unknown');
      }
      throw error;
    } finally {
      if (this.ocrAbort === abort) this.ocrAbort = null;
    }
  }
}
