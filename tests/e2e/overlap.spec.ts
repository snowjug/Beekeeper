import { spawn, type ChildProcess } from 'node:child_process';
import { test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { expect, launchApp } from './fixtures';
import { describeIntruder, windowsOverApp, type Area, type Intruder } from './overlap';

/**
 * The README screenshot generator takes its pictures from the screen, so a chat notification that
 * pops up meanwhile would end up in them. This checks the guard that stops that (see overlap.ts)
 * with a real topmost window of another program (a throw-away PowerShell form).
 */
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const PROBE = (x: number, y: number): string => `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(${x}, ${y})
$form.Size = New-Object System.Drawing.Size(300, 200)
$form.BackColor = [System.Drawing.Color]::DarkOrange
$form.Show()
$end = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $end) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 40 }
$form.Close()
`;

/** True when the app can grab the display (a locked or disconnected session cannot). */
async function screenCanBeCaptured(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(async () => {
    const hooks = (
      globalThis as unknown as { __beekeeper: { captureStats: () => Promise<unknown> } }
    ).__beekeeper;
    try {
      await hooks.captureStats();
      return true;
    } catch {
      return false;
    }
  });
}

async function until(
  what: string,
  check: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

test('the screenshot guard sees a topmost window of another program, and only while it is there', async () => {
  test.setTimeout(120_000);
  const launched = await launchApp();
  const { app } = launched;
  let probe: ChildProcess | null = null;
  try {
    test.skip(!(await screenCanBeCaptured(app)), 'This session cannot capture the screen');

    // A backdrop like the generator's: an opaque window of the app, with the area inside it.
    const backdrop = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      const win = new BrowserWindow({
        x: work.x + 100,
        y: work.y + 80,
        width: 760,
        height: 500,
        frame: false,
        show: false,
        focusable: false,
      });
      await win.loadURL(
        'data:text/html;charset=utf-8,<body style="margin:0;background:%23245"></body>',
      );
      win.showInactive();
      return win.getBounds();
    });
    const area: Area = {
      x: backdrop.x + 30,
      y: backdrop.y + 30,
      width: backdrop.width - 60,
      height: backdrop.height - 60,
    };
    await sleep(800);
    const baseline = await windowsOverApp(app, area);
    const baselinePids = new Set(baseline.map((intruder) => intruder.pid));
    // The app's own windows (the backdrop, the E2E helper windows) are never "another program".
    const appPid = await app.evaluate(() => process.pid);
    expect(baseline.map((intruder) => intruder.pid)).not.toContain(appPid);

    // The probe is placed well inside the area (device-independent coordinates, like the area).
    probe = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        PROBE(backdrop.x + 200, backdrop.y + 150),
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    const probePid = probe.pid;
    expect(probePid).toBeGreaterThan(0);

    let seen: Intruder[] = [];
    await until(
      'the guard to see the probe window',
      async () => {
        seen = await windowsOverApp(app, area);
        return seen.some((intruder) => intruder.pid === probePid);
      },
      30_000,
    );
    const mine = seen.find((intruder) => intruder.pid === probePid);
    expect(mine?.program.toLowerCase()).toBe('powershell.exe');
    expect(describeIntruder(mine as Intruder)).toContain(`pid ${String(probePid)}`);
    // Nothing else appeared because of the probe (what was there before may still be there).
    expect(seen.filter((intruder) => !baselinePids.has(intruder.pid)).map((i) => i.pid)).toEqual([
      probePid,
    ]);

    // An area that the probe does not touch does not report it.
    const apart: Area = { x: backdrop.x + 5, y: backdrop.y + 5, width: 120, height: 60 };
    expect((await windowsOverApp(app, apart)).some((intruder) => intruder.pid === probePid)).toBe(
      false,
    );

    // Once the probe is gone the area is clear of it again.
    probe.kill();
    await until(
      'the probe window to be gone',
      async () => !(await windowsOverApp(app, area)).some((intruder) => intruder.pid === probePid),
      15_000,
    );
  } finally {
    if (probe && probe.exitCode === null) probe.kill();
    await launched.close();
  }
});
