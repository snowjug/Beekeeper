import { describe, expect, it, vi } from 'vitest';
import { buildScriptArgs, createPowerShellRunner, parseScriptReply } from '@main/system/powershell';
import { SystemError } from '@main/system/types';
import { silentLogger } from '@shared/logger';
import { childProcessError, failureReply, fakeExec, successReply } from './support';

describe('buildScriptArgs', () => {
  it('turns typed values into named arguments', () => {
    expect(
      buildScriptArgs({
        Action: 'set',
        Percent: 40,
        Delta: -10,
        Force: true,
        Skip: false,
        Missing: undefined,
      }),
    ).toEqual(['-Action', 'set', '-Percent', '40', '-Delta', '-10', '-Force']);
  });

  it('keeps values with spaces, quotes and separators as single arguments', () => {
    expect(
      buildScriptArgs({ Targets: '12:notepad|34:my app', CacheDir: 'C:\\Users\\me\\App Data' }),
    ).toEqual(['-Targets', '12:notepad|34:my app', '-CacheDir', 'C:\\Users\\me\\App Data']);
  });

  it.each([
    [{ 'Bad Name': 'x' }, /Invalid script argument name/],
    [{ '-Name': 'x' }, /Invalid script argument name/],
    [{ Name: '-WhatIf' }, /unsafe value/],
    [{ Name: 'a\nb' }, /unsafe value/],
    [{ Name: 'a\u0000b' }, /unsafe value/],
    [{ Name: Number.NaN }, /finite number/],
    [{ Name: Number.POSITIVE_INFINITY }, /finite number/],
  ])('rejects %j', (args, message) => {
    expect(() => buildScriptArgs(args)).toThrowError(message);
    try {
      buildScriptArgs(args);
    } catch (error) {
      expect(error).toBeInstanceOf(SystemError);
      expect((error as SystemError).code).toBe('invalid-argument');
    }
  });
});

describe('parseScriptReply', () => {
  it('returns the data of a successful reply', () => {
    expect(parseScriptReply('audio', successReply({ percent: 40 }))).toEqual({ percent: 40 });
    expect(parseScriptReply('audio', successReply(null))).toBeNull();
  });

  it('ignores a byte order mark, blank lines and extra output before the reply', () => {
    const stdout = `\uFEFF\r\nWhat if: something\r\n${successReply([1, 2])}\r\n`;
    expect(parseScriptReply('x', stdout)).toEqual([1, 2]);
  });

  it('uses the last JSON line', () => {
    expect(parseScriptReply('x', `${successReply(1)}\n${successReply(2)}`)).toBe(2);
  });

  it.each([
    ['unsupported', 'No audio output device is available.'],
    ['failed', 'Something broke.'],
    ['not-found', 'Nothing there.'],
    ['invalid-argument', 'Bad input.'],
  ] as const)('maps a %s failure to a SystemError', (code, message) => {
    const run = (): unknown => parseScriptReply('x', failureReply(code, message));
    expect(run).toThrowError(message);
    try {
      run();
    } catch (error) {
      expect((error as SystemError).code).toBe(code);
    }
  });

  it('treats unknown codes and missing messages as plain failures', () => {
    try {
      parseScriptReply('audio', JSON.stringify({ ok: false, code: 'weird' }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'failed', message: 'The "audio" helper failed.' });
    }
  });

  it.each([
    '',
    'not json',
    '{broken',
    '[1,2]',
    '"text"',
    '{"ok":"yes"}',
    '{"data":1}',
    'Error: boom',
  ])('rejects the unexpected output %j', (stdout) => {
    expect(() => parseScriptReply('audio', stdout)).toThrowError(
      /The "audio" helper returned an unexpected reply/,
    );
  });
});

describe('createPowerShellRunner', () => {
  const base = {
    powershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    scriptsDir: 'C:\\App\\resources\\scripts',
    cacheDir: 'C:\\Users\\me\\AppData\\Local\\Beekeeper\\cache',
    platform: 'win32' as const,
    logger: silentLogger,
  };

  it('starts the script through PowerShell with an argument array and a timeout', async () => {
    const { exec, calls } = fakeExec(() => ({ stdout: successReply({ percent: 40 }), stderr: '' }));
    const runner = createPowerShellRunner({ ...base, exec });

    await expect(runner.run('audio', { Action: 'set', Percent: 40 })).resolves.toEqual({
      percent: 40,
    });
    expect(calls).toEqual([
      {
        file: base.powershellPath,
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          'C:\\App\\resources\\scripts\\audio.ps1',
          '-Action',
          'set',
          '-Percent',
          '40',
          '-CacheDir',
          base.cacheDir,
        ],
        options: { timeout: 15_000, windowsHide: true },
      },
    ]);
  });

  it('only passes the cache directory to scripts that compile helpers', async () => {
    const { exec, calls } = fakeExec(() => ({ stdout: successReply(null), stderr: '' }));
    const runner = createPowerShellRunner({ ...base, exec });
    for (const script of ['audio', 'theme', 'windows', 'close-windows'] as const)
      await runner.run(script);
    for (const script of ['battery', 'brightness', 'uwp-apps', 'recycle-bin', 'sleep'] as const) {
      await runner.run(script);
    }
    const withCache = calls.map((call) => call.args.includes('-CacheDir'));
    expect(withCache).toEqual([true, true, true, true, false, false, false, false, false]);
  });

  it('compiles in memory when no cache directory is configured', async () => {
    const { exec, calls } = fakeExec(() => ({ stdout: successReply(null), stderr: '' }));
    await createPowerShellRunner({ ...base, cacheDir: undefined, exec }).run('audio');
    await createPowerShellRunner({ ...base, cacheDir: '', exec }).run('audio');
    expect(calls.every((call) => !call.args.includes('-CacheDir'))).toBe(true);
  });

  it('applies a custom timeout and allows none', async () => {
    const { exec, calls } = fakeExec(() => ({ stdout: successReply(null), stderr: '' }));
    const runner = createPowerShellRunner({ ...base, exec });
    await runner.run('uwp-apps', {}, { timeoutMs: 30_000 });
    await runner.run('sleep', {}, { timeoutMs: 0 });
    expect(calls.map((call) => call.options?.timeout)).toEqual([30_000, 0]);
  });

  it('turns a reported failure into a SystemError', async () => {
    const { exec } = fakeExec(() => ({
      stdout: failureReply('unsupported', 'No display.'),
      stderr: '',
    }));
    const runner = createPowerShellRunner({ ...base, exec });
    await expect(runner.run('brightness')).rejects.toMatchObject({
      code: 'unsupported',
      message: 'No display.',
    });
  });

  it.each([
    [childProcessError({ killed: true }), 'timeout'],
    [childProcessError({ code: 'ENOENT' }), 'unsupported'],
    [childProcessError({ code: 1, stderr: 'Cannot validate argument' }), 'failed'],
  ] as const)('maps the process failure %# to %s', async (failure, code) => {
    const { exec } = fakeExec(() => Promise.reject(failure));
    const warn = vi.fn();
    const runner = createPowerShellRunner({ ...base, exec, logger: { ...silentLogger, warn } });
    await expect(runner.run('battery')).rejects.toMatchObject({ code });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('rejects garbled output', async () => {
    const { exec } = fakeExec(() => ({ stdout: 'Welcome to PowerShell', stderr: '' }));
    await expect(createPowerShellRunner({ ...base, exec }).run('battery')).rejects.toMatchObject({
      code: 'failed',
    });
  });

  it('refuses to run anywhere but Windows, before starting anything', async () => {
    const { exec, calls } = fakeExec();
    const runner = createPowerShellRunner({ ...base, platform: 'linux', exec });
    await expect(runner.run('battery')).rejects.toMatchObject({ code: 'unsupported' });
    expect(calls).toHaveLength(0);
  });

  it('rejects unsafe arguments before starting anything', async () => {
    const { exec, calls } = fakeExec();
    const runner = createPowerShellRunner({ ...base, exec });
    await expect(runner.run('audio', { Action: '-WhatIf' })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(calls).toHaveLength(0);
  });

  it('measures the run with the injected clock', async () => {
    const times = [1000, 1250];
    const debug = vi.fn();
    const { exec } = fakeExec(() => ({ stdout: successReply(null), stderr: '' }));
    const runner = createPowerShellRunner({
      ...base,
      exec,
      now: () => times.shift() ?? 0,
      logger: { ...silentLogger, debug },
    });
    await runner.run('battery');
    expect(debug).toHaveBeenCalledWith('PowerShell script battery finished in 250 ms');
  });
});
