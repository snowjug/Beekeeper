import { describe, expect, it } from 'vitest';
import {
  assertWindows,
  defaultExecFile,
  defaultSpawnDetached,
  getEnv,
  resolveSystemPaths,
  toSystemError,
} from '@main/system/exec';
import { SystemError } from '@main/system/types';
import { childProcessError } from './support';

describe('getEnv', () => {
  it('looks variables up case-insensitively', () => {
    const env = { SystemRoot: 'C:\\Windows', Path: 'x' };
    expect(getEnv(env, 'SystemRoot')).toBe('C:\\Windows');
    expect(getEnv(env, 'SYSTEMROOT')).toBe('C:\\Windows');
    expect(getEnv(env, 'path')).toBe('x');
    expect(getEnv(env, 'missing')).toBeUndefined();
  });
});

describe('resolveSystemPaths', () => {
  it('returns absolute Windows paths below SystemRoot', () => {
    expect(resolveSystemPaths({ SystemRoot: 'D:\\Win' })).toEqual({
      powershell: 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      explorer: 'D:\\Win\\explorer.exe',
      cmd: 'D:\\Win\\System32\\cmd.exe',
      rundll32: 'D:\\Win\\System32\\rundll32.exe',
      shutdown: 'D:\\Win\\System32\\shutdown.exe',
      taskkill: 'D:\\Win\\System32\\taskkill.exe',
    });
  });

  it('falls back to windir and then to C:\\Windows', () => {
    expect(resolveSystemPaths({ windir: 'E:\\W' }).cmd).toBe('E:\\W\\System32\\cmd.exe');
    expect(resolveSystemPaths({}).cmd).toBe('C:\\Windows\\System32\\cmd.exe');
  });
});

describe('assertWindows', () => {
  it('only accepts win32', () => {
    expect(() => assertWindows('win32')).not.toThrow();
    expect(() => assertWindows('linux')).toThrow(SystemError);
    expect(() => assertWindows('darwin')).toThrowError(/only available on Windows/);
  });
});

describe('toSystemError', () => {
  it.each([
    [{ code: 'ENOENT' }, 'unsupported', 'Thing is not available on this PC.'],
    [{ killed: true }, 'timeout', 'Thing took too long.'],
    [{ code: 'ETIMEDOUT' }, 'timeout', 'Thing took too long.'],
    [{ code: 1, stderr: '\r\n  Access denied\r\nmore' }, 'failed', 'Thing failed: Access denied'],
    [{ code: 2, stderr: '' }, 'failed', 'Thing failed: Command failed'],
  ] as const)('maps %j to %s', (fields, code, message) => {
    const error = toSystemError(childProcessError(fields), 'Thing');
    expect(error).toBeInstanceOf(SystemError);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });

  it('keeps the original error as the cause and truncates long details', () => {
    const original = childProcessError({ code: 1, stderr: 'x'.repeat(500) });
    const error = toSystemError(original, 'Thing');
    expect(error.cause).toBe(original);
    expect(error.message.length).toBeLessThan(330);
  });

  it('passes SystemErrors through and copes with non-error values', () => {
    const original = new SystemError('not-found', 'nope');
    expect(toSystemError(original, 'Thing')).toBe(original);
    expect(toSystemError('boom', 'Thing').message).toBe('Thing failed.');
    expect(toSystemError(undefined, 'Thing').code).toBe('failed');
  });
});

describe('defaultExecFile', () => {
  const node = process.execPath;

  it('runs a program with an argument array and returns its output', async () => {
    const result = await defaultExecFile(node, [
      '-e',
      'process.stdout.write("héllo ✓ " + process.argv[1])',
      'a b',
    ]);
    expect(result).toEqual({ stdout: 'héllo ✓ a b', stderr: '' });
  });

  it('rejects with the exit code and the captured output', async () => {
    await expect(
      defaultExecFile(node, ['-e', 'process.stderr.write("bad"); process.exit(3)']),
    ).rejects.toMatchObject({ code: 3, stderr: 'bad' });
  });

  it('kills a program that exceeds the timeout', async () => {
    const failure = await defaultExecFile(node, ['-e', 'setTimeout(() => {}, 20000)'], {
      timeout: 200,
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ killed: true });
    expect(toSystemError(failure, 'Thing').code).toBe('timeout');
  });

  it('reports a missing program', async () => {
    const failure = await defaultExecFile('C:\\definitely\\missing\\program.exe', []).catch(
      (error: unknown) => error,
    );
    expect(toSystemError(failure, 'Thing').code).toBe('unsupported');
  });
});

describe('defaultSpawnDetached', () => {
  it('resolves once the program has started', async () => {
    await expect(
      defaultSpawnDetached(process.execPath, ['-e', ''], { hidden: true }),
    ).resolves.toBeUndefined();
  });

  it('rejects when the program cannot be started', async () => {
    await expect(
      defaultSpawnDetached('C:\\definitely\\missing\\program.exe', []),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
