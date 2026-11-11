import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@shared/logger';
import { DEFAULT_SETTINGS } from '@shared/settings';
import type { OcrResult, OcrService } from '@main/capture/ocr';
import { CaptureStore } from '@main/capture/store';
import {
  CircleService,
  type CircleActions,
  type CircleCapture,
  type CircleImage,
} from '@main/circle/service';

class FakeImage implements CircleImage {
  readonly crops: Array<{ x: number; y: number; width: number; height: number }> = [];
  constructor(
    private readonly size: { width: number; height: number },
    private readonly parent?: FakeImage,
  ) {}
  getSize() {
    return this.size;
  }
  crop(rect: { x: number; y: number; width: number; height: number }): CircleImage {
    (this.parent ?? this).crops.push(rect);
    return new FakeImage({ width: rect.width, height: rect.height }, this.parent ?? this);
  }
  resize(size: { width: number; height: number }): CircleImage {
    return new FakeImage(size, this.parent ?? this);
  }
  toPNG(): Buffer {
    return Buffer.from(`png:${this.size.width}x${this.size.height}`);
  }
  toJPEG(): Buffer {
    return Buffer.from('jpeg');
  }
}

function capture(): CircleCapture {
  return {
    image: new FakeImage({ width: 1920, height: 1080 }),
    width: 1920,
    height: 1080,
    scaleFactor: 1.5,
    display: { id: 7, bounds: { x: 0, y: 0, width: 1280, height: 720 } },
  };
}

function ocrResult(text: string): OcrResult {
  const words = text.split(' ').map((word, index) => ({
    text: word,
    confidence: 90,
    bbox: { x: 10 + index * 120, y: 10, width: 100, height: 30 },
    lineIndex: 0,
  }));
  return {
    text,
    confidence: 90,
    durationMs: 5,
    words,
    lines: [{ text, confidence: 90, bbox: { x: 10, y: 10, width: 240, height: 30 }, words }],
  };
}

function setup(options: { aiConfigured?: boolean; text?: string } = {}) {
  const store = new CaptureStore();
  const recognize = vi.fn((_image: Uint8Array, _options?: unknown) =>
    Promise.resolve(ocrResult(options.text ?? 'Hello world')),
  );
  const ocr: OcrService = {
    warmUp: () => Promise.resolve(),
    recognize,
    dispose: () => Promise.resolve(),
  };
  const mocks = {
    copyImage: vi.fn(() => Promise.resolve()),
    copyText: vi.fn((_text: string) => Promise.resolve()),
    savePng: vi.fn((_png: Buffer) => Promise.resolve('C:\\Pictures\\Beekeeper\\Circle-1.png')),
    openExternal: vi.fn((_url: string) => Promise.resolve(true)),
    addReminder: vi.fn((_iso: string, _label: string) => true),
    calculate: vi.fn((expression: string) => (expression === '2+2' ? '4' : null)),
  };
  const actions: CircleActions = mocks;
  const askAboutImage = vi.fn(() => Promise.resolve());
  const service = new CircleService({
    ocr,
    store,
    actions,
    ai: { isConfigured: () => options.aiConfigured ?? false, askAboutImage },
    settings: () => DEFAULT_SETTINGS,
    newId: () => 'session-12345678',
    logger: silentLogger,
  });
  return { service, store, recognize, mocks, askAboutImage };
}

describe('CircleService session', () => {
  it('registers a capture, serves it from the store and describes it for the overlay', () => {
    const { service, store } = setup({ aiConfigured: true });
    const session = service.register(capture());
    expect(session).toMatchObject({
      id: 'session-12345678',
      imageUrl: 'beekeeper://app/capture/session-12345678.jpg',
      width: 1920,
      height: 1080,
      scaleFactor: 1.5,
      aiAvailable: true,
      defaultAction: 'show',
    });
    expect(store.get('session-12345678')?.mime).toBe('image/jpeg');
  });

  it('frees the capture when the session ends and rejects later requests', async () => {
    const { service, store } = setup();
    service.register(capture());
    service.end();
    expect(store.size).toBe(0);
    expect(service.current()).toBeNull();
    await expect(
      service.recognize('session-12345678', { x: 0, y: 0, width: 50, height: 20 }),
    ).rejects.toThrow(/not active/);
  });

  it('refuses a request for another session id', async () => {
    const { service } = setup();
    service.register(capture());
    await expect(
      service.recognize('other', { x: 0, y: 0, width: 50, height: 20 }),
    ).rejects.toThrow();
  });
});

describe('CircleService OCR', () => {
  it('upscales small crops 2x for OCR and returns DIP boxes in the overlay space', async () => {
    const { service, recognize } = setup({ text: 'Hello world' });
    const record = service.register(capture());
    const result = await service.recognize(record.id, { x: 100, y: 40, width: 200, height: 80 });
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(recognize.mock.calls[0]?.[0]).toEqual(Buffer.from('png:600x240'));
    expect(recognize.mock.calls[0]?.[1]).toMatchObject({ supersedePending: true });
    expect(result.text).toBe('Hello world');
    // crop origin 150 px; the word sits at x=10 px of the 2x copy = 5 px -> (150 + 5) / 1.5 DIP
    expect(result.words[0]?.bbox.x).toBeCloseTo(155 / 1.5, 1);
  });

  it('tap returns the word under the pointer, or the line for a double tap', async () => {
    const { service } = setup({ text: 'Hello world' });
    const record = service.register(capture());
    // OCR boxes are relative to the tap band (starting at 0,0 for a tap near the corner).
    const hit = await service.tap(record.id, { x: 20, y: 15 }, 'word');
    expect(hit?.result.text).toBe('Hello');
    const line = await service.tap(record.id, { x: 20, y: 15 }, 'line');
    expect(line?.result.text).toBe('Hello world');
    expect(await service.tap(record.id, { x: 600, y: 400 }, 'word')).toBeNull();
  });

  it('a newer OCR request aborts the previous one', async () => {
    const { service, recognize } = setup();
    const record = service.register(capture());
    const signals: AbortSignal[] = [];
    recognize.mockImplementation((_image, options) => {
      signals.push((options as { signal: AbortSignal }).signal);
      return new Promise(() => undefined);
    });
    void service.recognize(record.id, { x: 0, y: 0, width: 100, height: 40 });
    void service.recognize(record.id, { x: 0, y: 0, width: 120, height: 40 });
    await Promise.resolve();
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});

describe('CircleService actions', () => {
  const rect = { x: 0, y: 0, width: 100, height: 40 };

  it('copies and saves the cropped image', async () => {
    const { service, mocks } = setup();
    const record = service.register(capture());
    expect(await service.copyImage(record.id, rect)).toBe(true);
    expect(mocks.copyImage).toHaveBeenCalledOnce();
    expect(await service.saveImage(record.id, rect)).toEqual({
      path: 'C:\\Pictures\\Beekeeper\\Circle-1.png',
    });
    expect(mocks.savePng).toHaveBeenCalledWith(Buffer.from('png:150x60'));
  });

  it('image search copies the crop and opens Bing Visual Search', async () => {
    const { service, mocks } = setup();
    const record = service.register(capture());
    expect(await service.searchImage(record.id, rect)).toBe(true);
    expect(mocks.copyImage).toHaveBeenCalled();
    expect(mocks.openExternal).toHaveBeenCalledWith('https://www.bing.com/visualsearch');
  });

  it('builds search and translate links from the text', async () => {
    const { service, mocks } = setup();
    expect(await service.openText('search', '  hello world  ')).toBe(true);
    expect(await service.openText('translate', 'bonjour')).toBe(true);
    expect(await service.openText('search', '   ')).toBe(false);
    const urls = mocks.openExternal.mock.calls.map(([url]) => url);
    expect(urls[0]).toContain('hello');
    expect(urls[0]).toMatch(/^https:\/\/www\.bing\.com\/search/);
    expect(urls[1]).toMatch(/^https:\/\/www\.bing\.com\/translator/);
  });

  it.each([
    ['url', 'https://example.com', 'openExternal'],
    ['email', 'a@example.com', 'openExternal'],
    ['phone', '+4915112345678', 'copyText'],
    ['date', '2999-01-01', 'addReminder'],
    ['math', '2+2', 'copyText'],
  ] as const)('handles a %s smart action', async (type, value, method) => {
    const { service, mocks } = setup();
    const result = await service.smartAction(type, value);
    expect(result.ok).toBe(true);
    expect(mocks[method]).toHaveBeenCalled();
    if (type === 'email') {
      expect(mocks.openExternal).toHaveBeenCalledWith('mailto:a@example.com');
    }
    if (type === 'math') expect(result.resultText).toBe('4');
  });

  it('reports failures of smart actions', async () => {
    const { service, mocks } = setup();
    mocks.openExternal.mockResolvedValue(false);
    mocks.addReminder.mockReturnValue(false);
    expect((await service.smartAction('url', 'https://example.com')).ok).toBe(false);
    expect((await service.smartAction('email', 'not-an-email')).ok).toBe(false);
    expect((await service.smartAction('date', '2000-01-01')).ok).toBe(false);
    expect((await service.smartAction('math', '1/0')).ok).toBe(false);
  });
});

describe('CircleService Ask AI', () => {
  it('sends a downscaled crop to the AI service and can stop the stream', () => {
    const { service, askAboutImage } = setup({ aiConfigured: true });
    const record = service.register(capture());
    const emit = vi.fn();
    service.askAi(record.id, { x: 0, y: 0, width: 1280, height: 720 }, 'what is this?', 's1', emit);
    expect(askAboutImage).toHaveBeenCalledOnce();
    const [request, signal] = askAboutImage.mock.calls[0] as unknown as [
      { png: Buffer; question: string; streamId: string },
      AbortSignal,
    ];
    expect(request.streamId).toBe('s1');
    expect(request.question).toBe('what is this?');
    expect(request.png.toString()).toBe('png:1600x900');
    service.stopAi();
    expect(signal.aborted).toBe(true);
  });

  it('cancels the running AI request when the session ends', () => {
    const { service, askAboutImage } = setup({ aiConfigured: true });
    const record = service.register(capture());
    service.askAi(record.id, { x: 0, y: 0, width: 100, height: 100 }, undefined, 's2', vi.fn());
    const signal = (askAboutImage.mock.calls[0] as unknown as [unknown, AbortSignal])[1];
    service.end();
    expect(signal.aborted).toBe(true);
  });
});
