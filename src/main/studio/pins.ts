import type { Point, Size } from '@shared/geometry';
import type { Logger } from '@shared/logger';
import type { PinAction, PinInfo } from '@shared/ipc/types';
import { APP_ORIGIN } from '@shared/windows';
import type { CaptureStore } from '../capture/store';
import { pickDisplay } from '../windows/placement';
import {
  cascadedBounds,
  clampBoundsToDisplays,
  clampPinScale,
  initialPinScale,
  movedBounds,
  pinWindowSize,
  zoomedBounds,
} from './pinMath';
import { buildPinMenu } from './pinMenu';
import type { DisplayInfo, PinWindow, PinWindows, StudioPlatform } from './platform';

/** Pinned screenshots stay in memory for as long as their window is open. */
const PIN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_OPACITY = 0.1;

export interface PinManagerDeps {
  windows: PinWindows;
  captures: Pick<CaptureStore, 'put' | 'delete'>;
  platform: Pick<
    StudioPlatform,
    'displays' | 'onDisplayChange' | 'writeClipboardImage' | 'notify' | 'revealInFolder'
  >;
  /** Saves the image into the screenshots folder and returns the file's path. */
  saveImage: (png: Buffer) => Promise<string>;
  newId: () => string;
  logger: Logger;
}

interface PinRecord {
  id: string;
  png: Buffer;
  size: Size;
  scale: number;
  opacity: number;
  clickThrough: boolean;
  window: PinWindow;
}

/**
 * Every pinned screenshot: one frameless always-on-top window per pin. Pins are independent of the
 * Studio (they survive it closing) and are identified by the web contents that sends a request.
 */
export class PinManager {
  private readonly pins = new Map<number, PinRecord>();
  private stopDisplayWatch: (() => void) | null = null;

  constructor(private readonly deps: PinManagerDeps) {}

  get count(): number {
    return this.pins.size;
  }

  /** Pins `png` on `display`: sized to at most 40 % of it, centred, offset from the pins already there. */
  create(png: Buffer, size: Size, display: DisplayInfo): PinInfo {
    const id = this.deps.newId();
    const scale = initialPinScale(size, display);
    const bounds = cascadedBounds(
      pinWindowSize(size, scale, display.scaleFactor),
      display,
      this.pins.size,
    );
    this.deps.captures.put(id, png, 'image/png', PIN_TTL_MS);
    let window: PinWindow;
    try {
      window = this.deps.windows.create(bounds, `id=${id}`);
    } catch (error) {
      this.deps.captures.delete(id);
      throw error;
    }
    const record: PinRecord = { id, png, size, scale, opacity: 1, clickThrough: false, window };
    this.pins.set(window.webContentsId, record);
    window.onClosed(() => this.forget(window.webContentsId));
    this.watchDisplays();
    return this.infoOf(record);
  }

  info(webContentsId: number): PinInfo | null {
    const record = this.pins.get(webContentsId);
    return record ? this.infoOf(record) : null;
  }

  /** Runs one action of a pin's page; a request from an unknown window is ignored. */
  async act(webContentsId: number, action: PinAction): Promise<void> {
    const record = this.pins.get(webContentsId);
    if (!record) return;
    switch (action.type) {
      case 'close':
        this.close(record);
        return;
      case 'copy':
        await this.deps.platform.writeClipboardImage(record.png);
        return;
      case 'save':
        await this.save(record);
        return;
      case 'opacity':
        this.setOpacity(record, action.value);
        return;
      case 'scale':
        this.zoom(record, action.value, action.anchor);
        return;
      case 'resetScale':
        this.zoom(record, 1);
        return;
      case 'clickThrough':
        record.clickThrough = action.value;
        record.window.setClickThrough(action.value);
        this.publish(record);
        return;
      case 'interactive':
        if (record.clickThrough) record.window.setClickThrough(!action.value);
        return;
      case 'move':
        this.move(record, { x: action.x, y: action.y });
        return;
      case 'menu':
        record.window.popupMenu(
          buildPinMenu(
            this.infoOf(record),
            {
              copy: () => void this.runQuietly(() => this.act(webContentsId, { type: 'copy' })),
              save: () => void this.runQuietly(() => this.act(webContentsId, { type: 'save' })),
              setOpacity: (value) => this.setOpacity(record, value),
              setScale: (value) => this.zoom(record, value),
              toggleClickThrough: () => {
                record.clickThrough = !record.clickThrough;
                record.window.setClickThrough(record.clickThrough);
                this.publish(record);
              },
              close: () => this.close(record),
              closeAll: () => this.closeAll(),
            },
            this.pins.size,
          ),
        );
        return;
    }
  }

  closeAll(): void {
    for (const record of [...this.pins.values()]) this.close(record);
  }

  private async runQuietly(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.deps.logger.warn('A pinned screenshot action failed', error);
    }
  }

  private async save(record: PinRecord): Promise<void> {
    const path = await this.deps.saveImage(record.png);
    this.deps.platform.notify({
      title: 'Pinned screenshot saved',
      body: path,
      onClick: () => this.deps.platform.revealInFolder(path),
    });
  }

  private infoOf(record: PinRecord): PinInfo {
    return {
      id: record.id,
      imageUrl: `${APP_ORIGIN}/capture/${record.id}.png`,
      width: record.size.width,
      height: record.size.height,
      scale: record.scale,
      opacity: record.opacity,
      clickThrough: record.clickThrough,
    };
  }

  private publish(record: PinRecord): void {
    record.window.send(this.infoOf(record));
  }

  private setOpacity(record: PinRecord, value: number): void {
    record.opacity = Math.min(1, Math.max(MIN_OPACITY, value));
    record.window.setOpacity(record.opacity);
    this.publish(record);
  }

  private displayOf(record: PinRecord): DisplayInfo | null {
    const bounds = record.window.getBounds();
    const displays = this.deps.platform.displays();
    if (displays.length === 0) return null;
    return pickDisplay(displays, {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
  }

  private zoom(record: PinRecord, requested: number, anchor?: Point): void {
    const bounds = record.window.getBounds();
    const displays = this.deps.platform.displays();
    const factor = this.displayOf(record)?.scaleFactor ?? 1;
    const scale = clampPinScale(requested, record.size, factor);
    const next = pinWindowSize(record.size, scale, factor);
    record.scale = scale;
    record.window.setBounds(clampBoundsToDisplays(zoomedBounds(bounds, next, anchor), displays));
    this.publish(record);
  }

  private move(record: PinRecord, target: Point): void {
    const current = record.window.getBounds();
    record.window.setBounds(
      movedBounds(current, target, record.size, record.scale, this.deps.platform.displays()),
    );
  }

  private close(record: PinRecord): void {
    record.window.close();
    this.forget(record.window.webContentsId);
  }

  private forget(webContentsId: number): void {
    const record = this.pins.get(webContentsId);
    if (!record) return;
    this.pins.delete(webContentsId);
    this.deps.captures.delete(record.id);
    if (this.pins.size === 0) {
      this.stopDisplayWatch?.();
      this.stopDisplayWatch = null;
    }
  }

  /** A monitor that goes away must not strand pins off screen. */
  private watchDisplays(): void {
    if (this.stopDisplayWatch) return;
    this.stopDisplayWatch = this.deps.platform.onDisplayChange(() => {
      const displays = this.deps.platform.displays();
      for (const record of this.pins.values()) {
        const current = record.window.getBounds();
        record.window.setBounds(movedBounds(current, current, record.size, record.scale, displays));
      }
    });
  }
}
