import { execFile } from 'node:child_process';
import { join } from 'node:path';

/** Reads Windows Energy (Battery) Saver through the WinRT PowerManager; fixed script, no input. */
const SCRIPT =
  '[void][Windows.System.Power.PowerManager,Windows.System.Power,ContentType=WindowsRuntime];' +
  '[Windows.System.Power.PowerManager]::EnergySaverStatus';

const TIMEOUT_MS = 8000;

export type RunPowerShell = (file: string, args: readonly string[]) => Promise<string>;

/** "On" means the user (or low battery) turned Battery Saver on; anything else means it is not. */
export function parseEnergySaver(output: string): boolean {
  return output.trim().toLowerCase() === 'on';
}

const runWithExecFile: RunPowerShell = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) reject(error instanceof Error ? error : new Error('PowerShell failed'));
        else resolve(stdout);
      },
    );
  });

/** True while Battery Saver is on. Failures (no PowerShell, desktop PC) count as "off". */
export async function isBatterySaverOn(
  run: RunPowerShell = runWithExecFile,
  systemRoot: string = process.env['SystemRoot'] ?? 'C:\\Windows',
): Promise<boolean> {
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    return parseEnergySaver(
      await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', SCRIPT]),
    );
  } catch {
    return false;
  }
}
