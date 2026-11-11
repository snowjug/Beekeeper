export interface BinaryStore {
  get(id: string): { data: Buffer; mime: string } | undefined;
}

interface Entry {
  data: Buffer;
  mime: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * In-memory binary blobs served through `beekeeper://app/capture/<id>.<ext>` (frozen screenshots for
 * Circle to Search). Entries expire so a capture never lingers in memory.
 */
export class CaptureStore implements BinaryStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  put(id: string, data: Buffer, mime: string, ttlMs: number = DEFAULT_TTL_MS): void {
    this.sweep();
    this.entries.set(id, { data, mime, expiresAt: this.now() + ttlMs });
  }

  get(id: string): { data: Buffer; mime: string } | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(id);
      return undefined;
    }
    return { data: entry.data, mime: entry.mime };
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }
}
