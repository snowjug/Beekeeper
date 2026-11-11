import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  button,
  goTo,
  heading,
  liveRegion,
  renderApp,
  stubCanvas,
  type RenderOptions,
} from './appHarness';
import { createFakeBridge, modelState } from './testUtils';

stubCanvas();

async function openModelScreen(options: RenderOptions = {}) {
  const rendered = renderApp(options);
  await goTo(rendered.user, 'model');
  return rendered;
}

const downloading = (receivedBytes: number) =>
  modelState({
    state: 'downloading',
    receivedBytes,
    bytesPerSecond: 2_097_152,
    etaSeconds: 10,
    attempt: 2,
    maxAttempts: 4,
  });

describe('voice model screen', () => {
  it('reads the size and name from the state and never downloads on its own', async () => {
    const { fake } = await openModelScreen();
    expect(await screen.findByText(/about 39\.3 MB/)).toBeInTheDocument();
    expect(screen.getByText('Not downloaded yet')).toBeInTheDocument();
    expect(
      screen.getByText(/English \(US\) speech model, small · 0\.0 MB of 39\.3 MB/),
    ).toBeInTheDocument();
    expect(fake.inputsOf('voice:modelStatus')).toHaveLength(1);
    expect(fake.inputsOf('voice:modelEnsure')).toHaveLength(0);
    expect(button('Download')).toBeInTheDocument();
    expect(button('Not now')).toBeInTheDocument();
  });

  it('downloads after a click and shows percentage, size, speed, ETA and attempt', async () => {
    const { fake, user } = await openModelScreen();
    await user.click(button('Download'));
    expect(fake.inputsOf('voice:modelEnsure')).toHaveLength(1);

    act(() => fake.emit('voice:modelProgress', downloading(20_592_431)));
    expect(
      await screen.findByRole('img', { name: 'Voice model download, 50 percent' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2.0 MB/s')).toBeInTheDocument();
    expect(screen.getByText('10 s')).toBeInTheDocument();
    expect(screen.getByText('2 of 4')).toBeInTheDocument();
    expect(screen.getByText(/19\.6 MB of 39\.3 MB/)).toBeInTheDocument();
    expect(screen.getByText(/keeps going in the background/)).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('50 percent');
    expect(button('Continue')).toBeInTheDocument();
  });

  it('pauses without treating the cancellation as an error, then resumes', async () => {
    const { fake, user } = await openModelScreen();
    await user.click(button('Download'));
    act(() => fake.emit('voice:modelProgress', downloading(20_592_431)));
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(fake.inputsOf('voice:modelCancel')).toHaveLength(1);
    expect(await screen.findByText('Paused')).toBeInTheDocument();

    act(() =>
      fake.emit(
        'voice:modelProgress',
        modelState({
          state: 'error',
          receivedBytes: 20_592_431,
          message: 'The download was cancelled — it will resume next time',
        }),
      ),
    );
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.queryByText(/didn’t finish/)).toBeNull();
    expect(screen.getByText(/50% is already on your PC/)).toBeInTheDocument();

    await user.click(button('Resume'));
    expect(fake.inputsOf('voice:modelEnsure')).toHaveLength(2);
    act(() => fake.emit('voice:modelProgress', downloading(24_000_000)));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('shows a partial download from an earlier session as resumable', async () => {
    const fake = createFakeBridge();
    fake.handle('voice:modelStatus', () =>
      modelState({ state: 'partial', receivedBytes: 10_296_216 }),
    );
    await openModelScreen({ fake });
    expect(await screen.findByText('Download not finished')).toBeInTheDocument();
    expect(screen.getByText(/25% is already on your PC/)).toBeInTheDocument();
    expect(button('Resume')).toBeInTheDocument();
  });

  it('explains a failed download and retries without losing progress', async () => {
    const { fake, user } = await openModelScreen();
    await user.click(button('Download'));
    act(() =>
      fake.emit(
        'voice:modelProgress',
        modelState({ state: 'error', receivedBytes: 5_000_000, message: 'No internet connection' }),
      ),
    );
    expect(await screen.findByText('The download didn’t finish')).toBeInTheDocument();
    expect(screen.getByText(/No internet connection\. Your progress is kept/)).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('Voice model download failed. No internet connection');

    await user.click(button('Retry'));
    expect(fake.inputsOf('voice:modelEnsure')).toHaveLength(2);
    act(() => fake.emit('voice:modelProgress', downloading(6_000_000)));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('celebrates a ready model and lets the user continue', async () => {
    const { fake } = await openModelScreen();
    act(() =>
      fake.emit(
        'voice:modelProgress',
        modelState({ state: 'ready', modelUrl: 'beekeeper://app/models/x' }),
      ),
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Voice model ready' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Voice model ready' })).toBeInTheDocument();
    expect(screen.getByText(/work offline/)).toBeInTheDocument();
    expect(button('Continue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    expect(liveRegion()).toHaveTextContent('Voice model ready.');
  });

  it('keeps the click undone and says so when the download cannot be started', async () => {
    const fake = createFakeBridge();
    fake.handle('voice:modelEnsure', () => {
      throw new Error('ipc down');
    });
    const { user } = await openModelScreen({ fake });
    await user.click(button('Download'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t start the download');
    expect(button('Download')).toBeInTheDocument();
    expect(screen.getByText('Not downloaded yet')).toBeInTheDocument();
  });

  it('keeps downloading in the background while the user moves on', async () => {
    const { fake, user } = await openModelScreen();
    await user.click(button('Download'));
    act(() => fake.emit('voice:modelProgress', downloading(8_000_000)));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await heading(/anywhere/i);
    expect(fake.inputsOf('voice:modelCancel')).toHaveLength(0);
    expect(fake.listenerCount('voice:modelProgress')).toBe(1);
  });
});
