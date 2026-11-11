import { describe, expect, it } from 'vitest';
import {
  validateApiKey,
  validateApiVersion,
  validateAzureVoice,
  validateCity,
  validateDeployment,
  validateEndpoint,
  validateSpeechRegion,
  type FieldCheck,
} from '@renderer/settings/lib/validation';

type Case = readonly [value: string, valid: boolean];

function check(validate: FieldCheck, cases: readonly Case[]): void {
  for (const [value, valid] of cases) {
    const problem = validate(value);
    expect(problem === null, `${JSON.stringify(value)} -> ${String(problem)}`).toBe(valid);
  }
}

describe('field validators (backed by the shared zod schemas)', () => {
  it('speech region', () => {
    check(validateSpeechRegion, [
      ['westeurope', true],
      ['East-US2', true],
      ['', true],
      ['west europe', false],
      ['x'.repeat(41), false],
    ]);
  });

  it('deployment name', () => {
    check(validateDeployment, [
      ['gpt-4o', true],
      ['my_model.v2', true],
      ['', true],
      ['has space', false],
      ['y'.repeat(65), false],
    ]);
  });

  it('api version', () => {
    check(validateApiVersion, [
      ['2024-10-21', true],
      ['2025-01-01-preview', true],
      ['Bad Version', false],
    ]);
  });

  it('azure voice needs a real name', () => {
    check(validateAzureVoice, [
      ['en-US-AriaNeural', true],
      ['', false],
      ['not a voice', false],
    ]);
  });

  it('city allows up to 80 characters', () => {
    check(validateCity, [
      ['Seattle', true],
      ['', true],
      ['z'.repeat(80), true],
      ['z'.repeat(81), false],
    ]);
  });

  it('endpoint must be https (or empty)', () => {
    check(validateEndpoint, [
      ['https://my-resource.openai.azure.com', true],
      ['', true],
      ['http://my-resource.openai.azure.com', false],
      ['my-resource.openai.azure.com', false],
      [`https://${'a'.repeat(300)}.com`, false],
    ]);
    expect(validateEndpoint('http://x.test')).toContain('https');
    expect(validateEndpoint('nope')).toContain('https://');
  });
});

describe('validateApiKey', () => {
  it.each([
    ['', 'Paste your key first.'],
    ['   ', 'Paste your key first.'],
    ['short', 'That looks too short to be an API key.'],
    ['k'.repeat(401), 'That is too long.'],
  ])('rejects %j', (value, message) => {
    expect(validateApiKey('speech', value)).toBe(message);
  });

  it('accepts 8-400 characters, ignoring surrounding spaces', () => {
    expect(validateApiKey('openai', '  abcd1234  ')).toBeNull();
    expect(validateApiKey('speech', 'k'.repeat(400))).toBeNull();
  });
});
