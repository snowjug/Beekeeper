import { describe, expect, it } from 'vitest';
import {
  canInvoke,
  canReceive,
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  isEventChannel,
  isInvokeChannel,
} from '@shared/ipc/channels';
import { contractIsConsistent, invokeSchemas } from '@shared/ipc/schemas';
import { isWindowRole, ROLE_PAGE, WINDOW_ROLES } from '@shared/windows';
import { validateInvoke } from '@main/ipc/validate';

describe('IPC contract', () => {
  it('describes the same channels in channels.ts and schemas.ts', () => {
    expect(contractIsConsistent()).toBe(true);
  });

  it('gives every channel at least one allowed window and only known roles', () => {
    for (const roles of [...Object.values(INVOKE_CHANNELS), ...Object.values(EVENT_CHANNELS)]) {
      expect(roles.length).toBeGreaterThan(0);
      for (const role of roles) expect(isWindowRole(role)).toBe(true);
    }
  });

  it('maps every window role to a renderer page', () => {
    expect(Object.keys(ROLE_PAGE).sort()).toEqual([...WINDOW_ROLES].sort());
    expect(isWindowRole('hacker')).toBe(false);
  });

  it('enforces per-window access', () => {
    expect(canInvoke('assistant', 'assistant:submit')).toBe(true);
    expect(canInvoke('settings', 'assistant:submit')).toBe(false);
    expect(canInvoke('assistant', 'settings:update')).toBe(false);
    expect(canInvoke('settings', 'settings:update')).toBe(true);
    expect(canInvoke('circle', 'circle:ocr')).toBe(true);
    expect(canInvoke('edgeGlow', 'settings:get')).toBe(true);
    expect(canInvoke('edgeGlow', 'app:openExternal')).toBe(false);
    expect(canReceive('edgeGlow', 'glow:state')).toBe(true);
    expect(canReceive('assistant', 'glow:state')).toBe(false);
  });

  it('rejects unknown channels', () => {
    expect(isInvokeChannel('shell:exec')).toBe(false);
    expect(isInvokeChannel('__proto__')).toBe(false);
    expect(isInvokeChannel('constructor')).toBe(false);
    expect(isEventChannel('toString')).toBe(false);
    expect(canInvoke('assistant', 'shell:exec')).toBe(false);
    expect(canReceive('assistant', 'nope')).toBe(false);
  });

  it('only lets the settings windows change settings and keys', () => {
    for (const channel of [
      'settings:update',
      'hotkeys:set',
      'ai:setKey',
      'ai:clearKey',
      'ai:test',
    ] as const) {
      expect(canInvoke('assistant', channel)).toBe(false);
      expect(canInvoke('circle', channel)).toBe(false);
      expect(canInvoke('worker', channel)).toBe(false);
    }
  });
});

describe('validateInvoke', () => {
  it('accepts and normalises valid payloads', () => {
    const result = validateInvoke('assistant:submit', {
      text: '  what time is it  ',
      source: 'text',
    });
    expect(result).toEqual({ ok: true, data: { text: 'what time is it', source: 'text' } });
    expect(validateInvoke('app:info', undefined)).toEqual({ ok: true, data: undefined });
  });

  it.each([
    ['assistant:submit', { text: '', source: 'text' }],
    ['assistant:submit', { text: 'hi', source: 'telepathy' }],
    ['assistant:submit', { text: 'x'.repeat(2001), source: 'text' }],
    ['assistant:submit', null],
    ['assistant:cardAction', { action: { type: 'shell', command: 'calc' } }],
    ['circle:ocr', { sessionId: 'abc', rect: { x: 0, y: 0, width: -1, height: 10 } }],
    ['circle:ocr', { sessionId: 'abc', rect: { x: 0, y: 0, width: Number.NaN, height: 10 } }],
    ['circle:smartAction', { type: 'shell', value: 'calc.exe' }],
    ['hotkeys:set', { id: 'evil', accelerator: 'Ctrl+A' }],
    ['ai:setKey', { name: 'speech', value: 'short' }],
    ['settings:update', { hotkeys: { assistant: 'Ctrl+Alt+Del' } }],
    ['app:info', { unexpected: true }],
  ] as const)('rejects %s with %j', (channel, payload) => {
    expect(validateInvoke(channel, payload).ok).toBe(false);
  });

  it('reports which field failed without echoing the payload', () => {
    const result = validateInvoke('circle:ocr', {
      sessionId: 'abc',
      rect: { x: 0, y: 0, width: -5, height: 10 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('circle:ocr');
      expect(result.message).toContain('rect.width');
      expect(result.message).not.toContain('-5');
    }
  });

  it('validates card actions as a discriminated union', () => {
    const schema = invokeSchemas['assistant:cardAction'].input;
    expect(
      schema.safeParse({ action: { type: 'url', label: 'Open', url: 'https://example.com' } })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ action: { type: 'path', label: 'Open', path: 'C:\\x.png', mode: 'open' } })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ action: { type: 'path', label: 'Open', path: 'C:\\x.png', mode: 'run' } })
        .success,
    ).toBe(false);
  });
});
