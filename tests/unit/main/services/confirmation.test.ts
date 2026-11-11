import { describe, expect, it, vi } from 'vitest';
import type { ConfirmRequest } from '@main/commands/types';
import {
  CONFIRM_TTL_MS,
  createConfirmationService,
  type ConfirmationSettledEvent,
} from '@main/services/confirmation';
import { FakeClock } from '../commands/productivity/fakes';

const START = Date.UTC(2026, 10, 10, 10, 0, 0);

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function setup() {
  const clock = new FakeClock(START);
  let counter = 0;
  const settled: ConfirmationSettledEvent[] = [];
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = createConfirmationService({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    newId: () => {
      counter += 1;
      return `id${counter}`;
    },
    logger,
    onSettled: (event) => settled.push(event),
  });
  return { service, clock, settled, logger };
}

function build(overrides: Partial<ConfirmRequest> = {}) {
  const run = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const request: ConfirmRequest = {
    action: 'empty-recycle-bin',
    title: 'Empty the Recycle Bin?',
    confirmLabel: 'Empty it',
    danger: true,
    run,
    ...overrides,
  };
  return { request, run };
}

describe('request', () => {
  it('returns a confirm card for the pending action', () => {
    const { service } = setup();
    const { request } = build({
      action: 'shutdown',
      title: 'Shut down your PC?',
      detail: 'Unsaved work will be lost.',
      confirmLabel: 'Shut down',
      countdownSeconds: 10,
    });
    expect(service.request(request)).toEqual({
      kind: 'confirm',
      id: 'id2',
      createdAt: START,
      confirmId: 'id1',
      action: 'shutdown',
      title: 'Shut down your PC?',
      detail: 'Unsaved work will be lost.',
      confirmLabel: 'Shut down',
      danger: true,
      countdownSeconds: 10,
    });
    expect(service.pendingCount()).toBe(1);
  });

  it('leaves out the optional fields that were not requested', () => {
    const { service } = setup();
    const card = service.request(build({ countdownSeconds: 0 }).request);
    expect('detail' in card).toBe(false);
    expect('countdownSeconds' in card).toBe(false);
  });

  it('does not run anything until the user confirms', () => {
    const { service } = setup();
    const { request, run } = build();
    service.request(request);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('confirm without a countdown', () => {
  it('runs the action once and reports it', async () => {
    const { service, settled } = setup();
    const { request, run } = build();
    const card = service.request(request);

    await expect(service.confirm(card.confirmId)).resolves.toEqual({ status: 'executed' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(settled).toEqual([
      { confirmId: card.confirmId, action: 'empty-recycle-bin', status: 'executed' },
    ]);
    expect(service.pendingCount()).toBe(0);
  });

  it('never runs the action twice when the button is double clicked', async () => {
    const { service, settled } = setup();
    const { request, run } = build();
    const card = service.request(request);

    const outcomes = await Promise.all([
      service.confirm(card.confirmId),
      service.confirm(card.confirmId),
      service.confirm(card.confirmId),
    ]);
    expect(outcomes).toEqual([
      { status: 'executed' },
      { status: 'executed' },
      { status: 'executed' },
    ]);
    await expect(service.confirm(card.confirmId)).resolves.toEqual({ status: 'executed' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(settled).toHaveLength(1);
  });

  it('forgets finished requests after a short while', async () => {
    const { service, clock } = setup();
    const card = service.request(build().request);
    await service.confirm(card.confirmId);
    clock.advance(31_000);
    await expect(service.confirm(card.confirmId)).resolves.toEqual({ status: 'unknown' });
  });

  it('reports a failing action with a friendly message', async () => {
    const { service, settled, logger } = setup();
    const { request, run } = build();
    run.mockRejectedValue(new Error('Access is denied.'));
    const card = service.request(request);

    const expected = {
      status: 'failed',
      message: "I couldn't empty the Recycle Bin. Access is denied.",
    };
    await expect(service.confirm(card.confirmId)).resolves.toEqual(expected);
    await expect(service.confirm(card.confirmId)).resolves.toEqual(expected);
    expect(run).toHaveBeenCalledTimes(1);
    expect(settled).toEqual([
      {
        confirmId: card.confirmId,
        action: 'empty-recycle-bin',
        status: 'failed',
        message: expected.message,
      },
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  it.each<[ConfirmRequest['action'], string]>([
    ['shutdown', "I couldn't shut down the PC."],
    ['restart', "I couldn't restart the PC."],
    ['sleep', "I couldn't put the PC to sleep."],
    ['force-close', "I couldn't close that app."],
  ])('words the failure of %s without leaking odd error values', async (action, message) => {
    const { service } = setup();
    const { request, run } = build({ action });
    run.mockRejectedValue('not an error object');
    const card = service.request(request);
    await expect(service.confirm(card.confirmId)).resolves.toEqual({ status: 'failed', message });
  });

  it('treats an action that throws synchronously as failed', async () => {
    const { service } = setup();
    const { request } = build({
      run: () => {
        throw new Error('sync failure');
      },
    });
    const card = service.request(request);
    await expect(service.confirm(card.confirmId)).resolves.toMatchObject({ status: 'failed' });
  });

  it('does not expire once confirmed', async () => {
    const { service, clock, settled } = setup();
    const card = service.request(build().request);
    await service.confirm(card.confirmId);
    clock.advance(CONFIRM_TTL_MS + 1);
    expect(settled.map((event) => event.status)).toEqual(['executed']);
  });

  it('answers "unknown" for ids it never issued', async () => {
    const { service } = setup();
    await expect(service.confirm('nope')).resolves.toEqual({ status: 'unknown' });
    expect(service.cancel('nope')).toBe(false);
  });
});

describe('confirm with a countdown', () => {
  function shutdown(extra: Partial<ConfirmRequest> = {}) {
    return build({
      action: 'shutdown',
      title: 'Shut down your PC?',
      detail: 'Your PC will shut down.',
      confirmLabel: 'Shut down',
      countdownSeconds: 10,
      ...extra,
    });
  }

  it('starts a countdown card and runs the action when it elapses', async () => {
    const { service, clock, settled } = setup();
    const { request, run } = shutdown();
    const card = service.request(request);

    const outcome = await service.confirm(card.confirmId);
    expect(outcome).toEqual({
      status: 'countdown',
      card: {
        kind: 'countdown',
        id: 'id3',
        createdAt: START,
        confirmId: card.confirmId,
        action: 'shutdown',
        title: 'Shutting down',
        detail: 'Your PC will shut down.',
        startedAt: START,
        endsAt: START + 10_000,
      },
    });
    expect(run).not.toHaveBeenCalled();
    expect(service.pendingCount()).toBe(1);

    clock.advance(9_900);
    await flush();
    expect(run).not.toHaveBeenCalled();

    clock.advance(100);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(settled).toEqual([
      { confirmId: card.confirmId, action: 'shutdown', status: 'executed' },
    ]);
    expect(service.pendingCount()).toBe(0);
  });

  it('hands the same countdown to a double click and still runs once', async () => {
    const { service, clock } = setup();
    const { request, run } = shutdown();
    const card = service.request(request);
    const [first, second] = await Promise.all([
      service.confirm(card.confirmId),
      service.confirm(card.confirmId),
    ]);
    expect(second).toEqual(first);

    clock.advance(10_000);
    await flush();
    await expect(service.confirm(card.confirmId)).resolves.toEqual({ status: 'executed' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled during the countdown', async () => {
    const { service, clock, settled } = setup();
    const { request, run } = shutdown();
    const card = service.request(request);
    await service.confirm(card.confirmId);

    clock.advance(4_000);
    expect(service.cancel(card.confirmId)).toBe(true);
    expect(service.cancel(card.confirmId)).toBe(false);
    clock.advance(60_000);
    await flush();

    expect(run).not.toHaveBeenCalled();
    expect(settled).toEqual([
      { confirmId: card.confirmId, action: 'shutdown', status: 'cancelled' },
    ]);
    expect(service.pendingCount()).toBe(0);
    await expect(service.confirm(card.confirmId)).resolves.toEqual({ status: 'unknown' });
  });

  it('cannot be cancelled once the action is running', async () => {
    const { service, clock } = setup();
    let release: () => void = () => undefined;
    const run = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { request } = shutdown({ run });
    const card = service.request(request);
    await service.confirm(card.confirmId);
    clock.advance(10_000);

    expect(service.cancel(card.confirmId)).toBe(false);
    expect(service.pendingCount()).toBe(0);
    release();
    await flush();
    await expect(service.confirm(card.confirmId)).resolves.toEqual({ status: 'executed' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports a failing action after the countdown', async () => {
    const { service, clock, settled } = setup();
    const { request, run } = shutdown();
    run.mockRejectedValue(new Error('Not allowed.'));
    const card = service.request(request);
    await service.confirm(card.confirmId);
    clock.advance(10_000);
    await flush();

    expect(settled).toEqual([
      {
        confirmId: card.confirmId,
        action: 'shutdown',
        status: 'failed',
        message: "I couldn't shut down the PC. Not allowed.",
      },
    ]);
    await expect(service.confirm(card.confirmId)).resolves.toMatchObject({ status: 'failed' });
  });

  it('does not let the confirmation expire while counting down', async () => {
    const { service, clock, settled } = setup();
    const { request, run } = shutdown({ countdownSeconds: 30 });
    const card = service.request(request);
    clock.advance(CONFIRM_TTL_MS - 1_000);
    await service.confirm(card.confirmId);
    clock.advance(30_000);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(settled.map((event) => event.status)).toEqual(['executed']);
  });
});

describe('cancel and expiry', () => {
  it('never runs a cancelled action, even if its timer still fires', async () => {
    const callbacks: Array<() => void> = [];
    const service = createConfirmationService({
      setTimer: (fn) => {
        callbacks.push(fn);
        return callbacks.length;
      },
      clearTimer: () => undefined,
    });
    const { request, run } = build({ countdownSeconds: 10 });
    const card = service.request(request);
    await service.confirm(card.confirmId);
    expect(service.cancel(card.confirmId)).toBe(true);

    callbacks.forEach((fn) => fn());
    await flush();
    expect(run).not.toHaveBeenCalled();
  });

  it('cancels a request that was never confirmed', async () => {
    const { service, settled } = setup();
    const { request, run } = build();
    const card = service.request(request);

    expect(service.cancel(card.confirmId)).toBe(true);
    await expect(service.confirm(card.confirmId)).resolves.toEqual({ status: 'unknown' });
    expect(run).not.toHaveBeenCalled();
    expect(settled).toEqual([
      { confirmId: card.confirmId, action: 'empty-recycle-bin', status: 'cancelled' },
    ]);
  });

  it('cancels everything that has not run and reports how many', async () => {
    const { service, clock, settled } = setup();
    const waiting = service.request(build().request);
    const counting = service.request(build({ action: 'sleep', countdownSeconds: 10 }).request);
    const done = service.request(build({ action: 'restart' }).request);
    await service.confirm(counting.confirmId);
    await service.confirm(done.confirmId);

    expect(service.pendingCount()).toBe(2);
    expect(service.cancelAll()).toBe(2);
    expect(service.cancelAll()).toBe(0);
    expect(service.pendingCount()).toBe(0);
    expect(settled.filter((event) => event.status === 'cancelled').map((e) => e.confirmId)).toEqual(
      [waiting.confirmId, counting.confirmId],
    );
    clock.advance(60_000);
    await flush();
  });

  it('expires after two minutes without an answer', async () => {
    const { service, clock, settled } = setup();
    const { request, run } = build();
    const card = service.request(request);

    clock.advance(CONFIRM_TTL_MS - 1);
    expect(service.pendingCount()).toBe(1);
    clock.advance(1);

    expect(service.pendingCount()).toBe(0);
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      confirmId: card.confirmId,
      action: 'empty-recycle-bin',
      status: 'expired',
    });
    expect(settled[0]?.message).toMatch(/expired/i);
    await expect(service.confirm(card.confirmId)).resolves.toEqual({ status: 'unknown' });
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps going when the settled listener throws', async () => {
    const clock = new FakeClock(START);
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const service = createConfirmationService({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      logger,
      onSettled: () => {
        throw new Error('ui closed');
      },
    });
    const { request, run } = build();
    await expect(service.confirm(service.request(request).confirmId)).resolves.toEqual({
      status: 'executed',
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('with real timers', () => {
  it('runs after a short countdown', async () => {
    const service = createConfirmationService();
    const { request, run } = build({ countdownSeconds: 0.02 });
    const card = service.request(request);
    expect(card.confirmId).toMatch(/^[0-9a-f-]{36}$/);

    await service.confirm(card.confirmId);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it('does not run when cancelled in time', async () => {
    const service = createConfirmationService();
    const { request, run } = build({ countdownSeconds: 0.2 });
    const card = service.request(request);
    await service.confirm(card.confirmId);
    expect(service.cancel(card.confirmId)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(run).not.toHaveBeenCalled();
  });
});
