import { expect, pageFor, test } from './fixtures';

interface GlowHooks {
  __beekeeper: {
    ctx: {
      edgeGlow: {
        show: (display: unknown) => void;
        hide: () => void;
        snapshot: () => {
          active: boolean;
          visible: boolean;
          focusable: boolean;
          clickThrough: boolean;
        };
      };
    };
  };
}

test('the edge glow is a click-through overlay that fades in and out', async ({ launched }) => {
  await launched.app.evaluate(({ screen }) => {
    const hooks = globalThis as unknown as GlowHooks;
    hooks.__beekeeper.ctx.edgeGlow.show(screen.getPrimaryDisplay());
  });
  const page = await pageFor(launched.app, 'edge-glow');
  await expect(page.locator('#frame')).toHaveAttribute('data-active', 'true');

  const shown = await launched.app.evaluate(() =>
    (globalThis as unknown as GlowHooks).__beekeeper.ctx.edgeGlow.snapshot(),
  );
  expect(shown).toEqual({ active: true, visible: true, focusable: false, clickThrough: true });

  await launched.app.evaluate(() => {
    (globalThis as unknown as GlowHooks).__beekeeper.ctx.edgeGlow.hide();
  });
  await expect(page.locator('#frame')).toHaveAttribute('data-active', 'false');
  await expect
    .poll(
      () =>
        launched.app.evaluate(
          () => (globalThis as unknown as GlowHooks).__beekeeper.ctx.edgeGlow.snapshot().visible,
        ),
      { timeout: 3_000 },
    )
    .toBe(false);
});
