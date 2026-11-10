import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { silentLogger, type Logger } from '@shared/logger';

export interface JsonStoreOptions<T> {
  filePath: string;
  /** Value used when the file is missing or unreadable. */
  defaults: () => T;
  /** Optional validator/migrator. Throw to reject the stored value. */
  parse?: (raw: unknown) => T;
  /** Delay before a change is written to disk. Default 200 ms. */
  debounceMs?: number;
  logger?: Logger;
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Small persistent JSON document: synchronous reads, debounced atomic writes.
 * Windows (antivirus, OneDrive) can briefly lock files, so renames are retried.
 */
export class JsonStore<T> {
  private value: T;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;
  private readonly debounceMs: number;
  private readonly logger: Logger;

  constructor(private readonly options: JsonStoreOptions<T>) {
    this.debounceMs = options.debounceMs ?? 200;
    this.logger = options.logger ?? silentLogger;
    this.value = this.load();
  }

  get(): T {
    return this.value;
  }

  /** Replaces the value and schedules a write. */
  set(next: T): void {
    this.value = next;
    this.schedule();
  }

  /** Mutates in place (or returns a replacement) and schedules a write. */
  update(mutate: (current: T) => T | void): T {
    const result = mutate(this.value);
    if (result !== undefined) this.value = result;
    this.schedule();
    return this.value;
  }

  /** Writes pending changes now. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.writing = this.writing
      .then(() => this.write())
      .catch((error: unknown) => {
        this.logger.error('JsonStore write failed', this.options.filePath, error);
      });
    await this.writing;
  }

  /** Synchronous best-effort flush for process exit. */
  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    try {
      mkdirSync(dirname(this.options.filePath), { recursive: true });
      writeFileSync(this.options.filePath, this.serialize(), 'utf8');
      this.dirty = false;
    } catch (error) {
      this.logger.error('JsonStore sync write failed', this.options.filePath, error);
    }
  }

  private serialize(): string {
    return `${JSON.stringify(this.value, null, 2)}\n`;
  }

  private schedule(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
    this.timer.unref();
  }

  private load(): T {
    const { filePath, defaults, parse } = this.options;
    if (!existsSync(filePath)) return defaults();
    try {
      const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
      return parse ? parse(raw) : (raw as T);
    } catch (error) {
      this.logger.warn('JsonStore: unreadable file, starting fresh', filePath, error);
      try {
        renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
      } catch {
        rmSync(filePath, { force: true });
      }
      return defaults();
    }
  }

  private async write(): Promise<void> {
    if (!this.dirty) return;
    const { filePath } = this.options;
    const temp = `${filePath}.tmp`;
    const data = this.serialize();
    this.dirty = false;
    mkdirSync(dirname(filePath), { recursive: true });
    await writeFile(temp, data, 'utf8');
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temp, filePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? '';
        if (!RETRYABLE.has(code) || attempt >= 5) {
          this.dirty = true;
          throw error;
        }
        await sleep(40 * (attempt + 1));
      }
    }
  }
}
