import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, launchApp, pageFor, test } from './fixtures';

interface CaptureStats {
  elapsedMs: number;
  width: number;
  height: number;
  expected: { width: number; height: number };
  opaque: boolean;
  litFraction: number;
}

interface Hooks {
  __beekeeper: {
    ctx: {
      assistant: { show: (event: object) => void; hide: (reason: string) => void };
    };
    circle: { toggle: (source: string) => Promise<void>; cancel: (reason: string) => void };
    captureStats: () => Promise<CaptureStats>;
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

test.describe('performance budgets (spec section 7)', () => {
  test.setTimeout(180_000);

  test('hotkey to assistant bar painted is fast', async () => {
    const launched = await launchApp();
    try {
      const page = await pageFor(launched.app, 'assistant');
      await new Promise((done) => setTimeout(done, 1500));
      await page.evaluate(() => {
        const state = window as unknown as { __paintedAt?: number };
        const observer = new MutationObserver(() => {
          if (!document.querySelector('[role="dialog"]')) return;
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              state.__paintedAt = performance.timeOrigin + performance.now();
            }),
          );
          observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });

      const samples: number[] = [];
      for (let round = 0; round < 5; round += 1) {
        await page.evaluate(() => {
          (window as unknown as { __paintedAt?: number }).__paintedAt = undefined;
          const observer = new MutationObserver(() => {
            if (!document.querySelector('[role="dialog"]')) return;
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                (window as unknown as { __paintedAt?: number }).__paintedAt =
                  performance.timeOrigin + performance.now();
              }),
            );
            observer.disconnect();
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
        const startedAt = await launched.app.evaluate(() => {
          const hooks = globalThis as unknown as Hooks;
          const now = Date.now();
          hooks.__beekeeper.ctx.assistant.show({ listen: false, source: 'api' });
          return now;
        });
        await expect
          .poll(() =>
            page.evaluate(() => (window as unknown as { __paintedAt?: number }).__paintedAt ?? 0),
          )
          .toBeGreaterThan(0);
        const paintedAt = await page.evaluate(
          () => (window as unknown as { __paintedAt?: number }).__paintedAt ?? 0,
        );
        samples.push(Math.round(paintedAt - startedAt));
        await new Promise((done) => setTimeout(done, 500));
        await launched.app.evaluate(() => {
          (globalThis as unknown as Hooks).__beekeeper.ctx.assistant.hide('api');
        });
        await expect(page.getByRole('dialog', { name: 'Beekeeper assistant' })).toBeHidden();
        await new Promise((done) => setTimeout(done, 600));
      }
      console.log(
        `PERF assistant show -> painted (ms): ${samples.join(', ')} | median ${median(samples)}`,
      );
      expect(median(samples)).toBeLessThan(300);
    } finally {
      await launched.close();
    }
  });

  test('hotkey to Circle to Search overlay is fast', async () => {
    const launched = await launchApp();
    try {
      await pageFor(launched.app, 'assistant');
      await new Promise((done) => setTimeout(done, 3000));
      const samples: number[] = [];
      for (let round = 0; round < 4; round += 1) {
        await launched.app.evaluate(async () => {
          await (globalThis as unknown as Hooks).__beekeeper.circle.toggle('perf');
        });
        await new Promise((done) => setTimeout(done, 700));
        await launched.app.evaluate(() => {
          (globalThis as unknown as Hooks).__beekeeper.circle.cancel('api');
        });
        await new Promise((done) => setTimeout(done, 900));
      }
      const log = readFileSync(join(launched.userData, 'logs', 'main.log'), 'utf8');
      for (const match of log.matchAll(/captured in (\d+) ms, overlay visible after (\d+) ms/g)) {
        samples.push(Number(match[2]));
      }
      console.log(
        `PERF circle trigger -> overlay visible (ms): ${samples.join(', ')} | median ${median(samples)}`,
      );
      expect(samples.length).toBeGreaterThan(0);
      expect(median(samples)).toBeLessThan(400);
    } finally {
      await launched.close();
    }
  });

  test('a real screenshot is native size, opaque and fast (needs an unlocked desktop)', async () => {
    const launched = await launchApp();
    try {
      await pageFor(launched.app, 'assistant');
      await new Promise((done) => setTimeout(done, 2000));
      const runs: CaptureStats[] = [];
      for (let round = 0; round < 3; round += 1) {
        runs.push(
          await launched.app.evaluate(() =>
            (globalThis as unknown as Hooks).__beekeeper.captureStats(),
          ),
        );
      }
      console.log(`PERF screenshot: ${JSON.stringify(runs)}`);
      for (const run of runs) {
        expect(Math.abs(run.width - run.expected.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(run.height - run.expected.height)).toBeLessThanOrEqual(1);
        expect(run.opaque).toBe(true);
        expect(run.litFraction).toBeGreaterThan(0.01);
      }
      expect(median(runs.map((run) => run.elapsedMs))).toBeLessThan(400);
    } finally {
      await launched.close();
    }
  });
});
