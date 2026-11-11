import { describe, expect, it } from 'vitest';
import {
  assertValidManifest,
  getModelUrlPath,
  modelManifest,
  type ModelManifest,
} from '@shared/models';

describe('model manifest', () => {
  it('describes an archive that can be downloaded and verified', () => {
    expect(modelManifest.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isInteger(modelManifest.sizeBytes)).toBe(true);
    expect(modelManifest.sizeBytes).toBeGreaterThan(0);
    expect(modelManifest.fileName.endsWith('.tar.gz')).toBe(true);
    expect(modelManifest.archiveRoot).not.toBe('');
    expect(modelManifest.urls.length).toBeGreaterThan(0);
    for (const source of modelManifest.urls) {
      const url = new URL(source);
      expect(url.protocol).toBe('https:');
      expect(url.pathname.endsWith(`/${modelManifest.fileName}`)).toBe(true);
    }
    expect(() => assertValidManifest(modelManifest)).not.toThrow();
  });
});

describe('assertValidManifest', () => {
  it.each<[string, Partial<ModelManifest>, string]>([
    ['an empty id', { id: '' }, 'id is empty'],
    ['an empty display name', { displayName: '' }, 'displayName is empty'],
    ['an empty license', { license: '' }, 'license is empty'],
    ['an empty archive root', { archiveRoot: '' }, 'archiveRoot is empty'],
    ['an upper-case checksum', { sha256: modelManifest.sha256.toUpperCase() }, 'sha256'],
    ['a short checksum', { sha256: 'abc123' }, 'sha256'],
    ['a zero size', { sizeBytes: 0 }, 'sizeBytes'],
    ['a fractional size', { sizeBytes: 1.5 }, 'sizeBytes'],
    ['a path-traversing file name', { fileName: '../model.tar.gz' }, 'fileName'],
    ['a non tar.gz file name', { fileName: 'model.zip' }, 'fileName'],
    ['no sources', { urls: [] }, 'urls is empty'],
    ['a plain http source', { urls: ['http://example.com/model.tar.gz'] }, 'not https'],
    ['an unparsable source', { urls: ['not a url'] }, 'not https'],
  ])('rejects %s', (_name, override, problem) => {
    expect(() => assertValidManifest({ ...modelManifest, ...override })).toThrow(problem);
  });

  it('allows plain http for loopback servers only', () => {
    const local = { ...modelManifest, urls: ['http://127.0.0.1:8080/model.tar.gz'] };
    expect(() => assertValidManifest(local)).not.toThrow();
  });
});

describe('getModelUrlPath', () => {
  it('maps the manifest to the same-origin path the app protocol serves', () => {
    expect(getModelUrlPath(modelManifest)).toBe(`/models/${modelManifest.fileName}`);
    expect(getModelUrlPath()).toBe(getModelUrlPath(modelManifest));
  });

  it('encodes characters that are not URL safe', () => {
    const odd = { ...modelManifest, fileName: 'a b#c.tar.gz' };
    expect(getModelUrlPath(odd)).toBe('/models/a%20b%23c.tar.gz');
  });
});
