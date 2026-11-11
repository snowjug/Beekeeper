import { maskSecret } from '@shared/redact';
import { silentLogger, type Logger } from '@shared/logger';
import { JsonStore } from './jsonStore';

export type SecretName = 'speech' | 'openai' | 'elevenlabs';

interface SecretsFile {
  version: 1;
  /** base64 of the DPAPI-encrypted value (safeStorage). */
  entries: Partial<Record<SecretName, string>>;
}

/** Subset of Electron's safeStorage used here (injected so it can be faked in tests). */
export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SecureKeysOptions {
  filePath: string;
  cipher: SecretCipher;
  /** Fallback values (e.g. from .env). Never persisted and never shown, only used when nothing is stored. */
  fallbacks?: Partial<Record<SecretName, string>>;
  logger?: Logger;
}

function parseSecretsFile(raw: unknown): SecretsFile {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid secrets file');
  const entries = (raw as { entries?: unknown }).entries;
  if (typeof entries !== 'object' || entries === null) throw new Error('invalid secrets file');
  const clean: SecretsFile['entries'] = {};
  for (const name of ['speech', 'openai', 'elevenlabs'] as const) {
    const value = (entries as Record<string, unknown>)[name];
    if (typeof value === 'string' && value.length > 0) clean[name] = value;
  }
  return { version: 1, entries: clean };
}

/**
 * API keys encrypted with Windows DPAPI through Electron safeStorage (spec 4.7/6). The ciphertext
 * lives in its own file next to the settings; plaintext only exists transiently in main memory.
 */
export class SecureKeys {
  private readonly store: JsonStore<SecretsFile>;
  private readonly cipher: SecretCipher;
  private readonly fallbacks: Partial<Record<SecretName, string>>;
  private readonly logger: Logger;

  constructor(options: SecureKeysOptions) {
    this.cipher = options.cipher;
    this.fallbacks = options.fallbacks ?? {};
    this.logger = options.logger ?? silentLogger;
    this.store = new JsonStore<SecretsFile>({
      filePath: options.filePath,
      defaults: () => ({ version: 1, entries: {} }),
      parse: parseSecretsFile,
      debounceMs: 50,
      logger: this.logger,
    });
  }

  get encryptionAvailable(): boolean {
    return this.cipher.isEncryptionAvailable();
  }

  /** Stores a key encrypted. Throws when the OS cannot encrypt (never falls back to plaintext). */
  async set(name: SecretName, value: string): Promise<void> {
    if (!this.cipher.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system, so the key was not saved.');
    }
    const encrypted = this.cipher.encryptString(value).toString('base64');
    this.store.update((file) => {
      file.entries[name] = encrypted;
    });
    await this.store.flush();
  }

  /** Decrypted value (stored, else fallback) or null. Only call from main-process code paths. */
  get(name: SecretName): string | null {
    const stored = this.store.get().entries[name];
    if (stored) {
      try {
        return this.cipher.decryptString(Buffer.from(stored, 'base64'));
      } catch (error) {
        this.logger.warn(
          `Could not decrypt the stored ${name} key`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    return this.fallbacks[name] ?? null;
  }

  has(name: SecretName): boolean {
    return this.get(name) !== null;
  }

  async delete(name: SecretName): Promise<void> {
    this.store.update((file) => {
      delete file.entries[name];
    });
    await this.store.flush();
  }

  /** "••••••••abcd" for the UI. */
  mask(name: SecretName): string | null {
    const value = this.get(name);
    return value === null ? null : maskSecret(value);
  }
}
