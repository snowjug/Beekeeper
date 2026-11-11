import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@shared/logger';
import type { SpeechPackId, SpeechPackSpec } from '@shared/speech/packs';
import { SPEECH_PACKS } from '@shared/speech/packs';
import { SpeechPackManager, type ArchiveExtractor } from '@main/speech/packManager';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const FILE_A = Buffer.from('encoder-data'.repeat(100));
const FILE_B = Buffer.from('tokens'.repeat(50));
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const ARCHIVE = Buffer.from('fake-archive-bytes'.repeat(200));

const specs: Record<SpeechPackId, SpeechPackSpec> = {
  'supertonic-3': {
    ...SPEECH_PACKS['supertonic-3'],
    sizeBytes: ARCHIVE.length,
    archive: {
      url: 'https://example.test/voice.tar.bz2',
      bytes: ARCHIVE.length,
      sha256: sha(ARCHIVE),
      format: 'tar.bz2',
      files: { 'model.onnx': 4, 'tts.json': 2 },
    },
  },
  'whisper-small': {
    ...SPEECH_PACKS['whisper-small'],
    sizeBytes: FILE_A.length + FILE_B.length,
    files: [
      {
        name: 'small-encoder.int8.onnx',
        bytes: FILE_A.length,
        sha256: sha(FILE_A),
        url: 'https://example.test/a',
      },
      {
        name: 'small-tokens.txt',
        bytes: FILE_B.length,
        sha256: sha(FILE_B),
        url: 'https://example.test/b',
      },
    ],
  },
  'whisper-base': { ...SPEECH_PACKS['whisper-base'], sizeBytes: 1 },
};

const bodies: Record<string, Buffer> = {
  'https://example.test/a': FILE_A,
  'https://example.test/b': FILE_B,
  'https://example.test/voice.tar.bz2': ARCHIVE,
};

const fakeFetch = vi.fn((url: string) => {
  const body = bodies[url];
  if (!body) return Promise.resolve(new Response(null, { status: 404 }));
  return Promise.resolve(new Response(new Uint8Array(body), { status: 200 }));
}) as unknown as typeof fetch;

/** Pretends to untar into <dest>/pack-folder/ (the archive has one top-level folder). */
const extractor: ArchiveExtractor = async (_archive, destination) => {
  const folder = join(destination, 'pack-folder');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'model.onnx'), 'abcd');
  await writeFile(join(folder, 'tts.json'), 'xy');
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'bk-packs-'));
  vi.mocked(fakeFetch as unknown as (u: string) => unknown).mockClear();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function manager(extra: Partial<ConstructorParameters<typeof SpeechPackManager>[0]> = {}) {
  return new SpeechPackManager({
    rootDir: root,
    fetch: fakeFetch,
    logger,
    specs,
    extract: extractor,
    backoffMs: () => 0,
    ...extra,
  });
}

describe('SpeechPackManager', () => {
  it('starts with every pack missing', () => {
    const packs = manager();
    expect(packs.readyPacks()).toEqual([]);
    expect(packs.status()['whisper-small']).toMatchObject({
      state: 'missing',
      receivedBytes: 0,
      totalBytes: FILE_A.length + FILE_B.length,
    });
  });

  it('downloads a file pack, verifies it and reports progress', async () => {
    const packs = manager();
    const states: string[] = [];
    packs.onChange(() => states.push(packs.status()['whisper-small'].state));

    await packs.ensure('whisper-small');

    expect(packs.isReady('whisper-small')).toBe(true);
    expect(packs.status()['whisper-small']).toMatchObject({
      state: 'ready',
      receivedBytes: FILE_A.length + FILE_B.length,
    });
    expect(states).toContain('downloading');
    expect(states.at(-1)).toBe('ready');
    expect((await readdir(packs.dir('whisper-small'))).sort()).toEqual([
      'pack.json',
      'small-encoder.int8.onnx',
      'small-tokens.txt',
    ]);
  });

  it('recognises an installed pack after a restart without downloading again', async () => {
    await manager().ensure('whisper-small');
    const again = manager();
    expect(again.isReady('whisper-small')).toBe(true);
    vi.mocked(fakeFetch as unknown as (u: string) => unknown).mockClear();
    await again.ensure('whisper-small');
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('does not trust a pack whose file changed on disk', async () => {
    const packs = manager();
    await packs.ensure('whisper-small');
    await writeFile(join(packs.dir('whisper-small'), 'small-tokens.txt'), 'broken');
    expect(manager().isReady('whisper-small')).toBe(false);
  });

  it('reuses verified files and only downloads what is missing', async () => {
    const packs = manager();
    await mkdir(packs.dir('whisper-small'), { recursive: true });
    await writeFile(join(packs.dir('whisper-small'), 'small-encoder.int8.onnx'), FILE_A);
    await packs.ensure('whisper-small');
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(packs.isReady('whisper-small')).toBe(true);
  });

  it('downloads and extracts an archive pack', async () => {
    const packs = manager();
    const states: string[] = [];
    packs.onChange(() => states.push(packs.status()['supertonic-3'].state));
    await packs.ensure('supertonic-3');
    expect(packs.isReady('supertonic-3')).toBe(true);
    expect(states).toContain('extracting');
    expect((await readdir(packs.dir('supertonic-3'))).sort()).toEqual([
      'model.onnx',
      'pack.json',
      'tts.json',
    ]);
    // The scratch folder is cleaned up.
    expect(await readdir(root)).not.toContain('.downloads-left');
  });

  it('reports a failed download without throwing and can be retried', async () => {
    const failing = manager({
      fetch: (() =>
        Promise.resolve(new Response(null, { status: 404 }))) as unknown as typeof fetch,
    });
    await failing.ensure('whisper-small');
    expect(failing.status()['whisper-small']).toMatchObject({ state: 'error' });
    expect(failing.status()['whisper-small'].message).toContain('HTTP 404');

    const healthy = manager();
    await healthy.ensure('whisper-small');
    expect(healthy.isReady('whisper-small')).toBe(true);
  });

  it('fails clearly when the archive does not contain the expected files', async () => {
    const empty: ArchiveExtractor = async (_archive, destination) => {
      await mkdir(join(destination, 'wrong'), { recursive: true });
    };
    const packs = manager({ extract: empty });
    await packs.ensure('supertonic-3');
    expect(packs.status()['supertonic-3'].state).toBe('error');
    expect(packs.isReady('supertonic-3')).toBe(false);
  });

  it('joins a download that is already running', async () => {
    const packs = manager();
    const first = packs.ensure('whisper-small');
    const second = packs.ensure('whisper-small');
    await Promise.all([first, second]);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('goes back to missing when the download is cancelled', async () => {
    const packs = manager({
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        })) as unknown as typeof fetch,
    });
    const run = packs.ensure('whisper-small');
    packs.cancel('whisper-small');
    await run;
    expect(packs.status()['whisper-small'].state).toBe('missing');
  });

  it('removes an installed pack', async () => {
    const packs = manager();
    await packs.ensure('whisper-small');
    await packs.remove('whisper-small');
    expect(packs.isReady('whisper-small')).toBe(false);
    expect(await readdir(root)).not.toContain('whisper-small');
  });
});
