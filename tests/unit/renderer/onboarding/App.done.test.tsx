import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { button, goTo, heading, renderApp, stubCanvas } from './appHarness';
import { createFakeBridge, modelState, readyPack, speechState } from './testUtils';

stubCanvas();

describe('done screen', () => {
  it('summarises the choices, celebrates and finishes on the primary button', async () => {
    const fake = createFakeBridge();
    fake.handle('voice:modelStatus', () => modelState({ state: 'ready' }));
    const { user, mic } = renderApp({ fake });
    await heading('Meet Beekeeper');
    await user.click(button('Get started'));
    await heading(/language & voice/i);
    await user.click(screen.getByRole('radio', { name: 'हिन्दी' }));
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await heading(/try your microphone/i);
    await user.click(button('Allow & test microphone'));
    await screen.findByText('Say something…');
    mic.level.value = 0.3;
    await screen.findByText('I can hear you', {}, { timeout: 4000 });
    await user.click(button('Continue'));
    await heading(/anywhere/i);
    await user.click(screen.getByRole('switch', { name: 'Hey Beekeeper' }));
    await user.click(button('Continue'));
    await heading(/all set/i);

    const summary = screen.getByRole('list', { name: 'Setup summary' });
    expect(within(summary).getByText('Heard you loud and clear')).toBeInTheDocument();
    expect(within(summary).getByText('Hindi')).toBeInTheDocument();
    expect(within(summary).getByText('Ready — voice works offline')).toBeInTheDocument();
    expect(within(summary).getByText('On — say “Hey Beekeeper”')).toBeInTheDocument();

    const tries = screen.getByRole('list', { name: 'Things to try' });
    for (const text of ["What's the weather?", 'Open Notepad', 'Circle to Search']) {
      expect(within(tries).getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText('Alt+Shift+S')).toBeInTheDocument();
    expect(screen.getByText('Alt+Shift+D')).toBeInTheDocument();
    expect(screen.getByText(/takes a screenshot/)).toBeInTheDocument();
    expect(document.querySelector('[data-celebration="confetti"]')).not.toBeNull();
    expect(document.querySelector('[data-celebration="sparkle"]')).toBeNull();
    expect(button('Back')).toBeInTheDocument();

    await user.click(button('Start using Beekeeper'));
    expect(fake.inputsOf('onboarding:finish')).toHaveLength(1);
  }, 20_000);

  it('reflects skipped steps and a Best download that is still running', async () => {
    const { fake, user } = renderApp();
    await goTo(user, 'language');
    await user.click(button('Download'));
    const half = {
      state: 'downloading' as const,
      receivedBytes: 50_000_000,
      totalBytes: 100_000_000,
      bytesPerSecond: 1_000_000,
      etaSeconds: 50,
    };
    act(() =>
      fake.emit('speech:state', speechState({ 'whisper-small': half, 'supertonic-3': half })),
    );
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await heading(/try your microphone/i);
    await user.click(button('Skip for now'));
    await heading(/anywhere/i);
    await user.click(button('Continue'));
    await heading(/all set/i);

    const summary = screen.getByRole('list', { name: 'Setup summary' });
    expect(within(summary).getByText(/^Skipped — test it any time/)).toBeInTheDocument();
    expect(within(summary).getByText('Hindi and English')).toBeInTheDocument();
    expect(
      within(summary).getByText('Downloading… 50% — it keeps going in the background'),
    ).toBeInTheDocument();
    expect(within(summary).getByText(/^Off — turn it on/)).toBeInTheDocument();
    expect(fake.inputsOf('speech:cancelPack')).toHaveLength(0);

    act(() =>
      fake.emit(
        'speech:state',
        speechState({
          'whisper-small': readyPack('whisper-small'),
          'supertonic-3': readyPack('supertonic-3'),
        }),
      ),
    );
    expect(
      await within(summary).findByText('Ready — natural voice and accurate recognition'),
    ).toBeInTheDocument();
  }, 20_000);

  it('reflects a Light download that is still running', async () => {
    const { fake, user } = renderApp();
    await heading('Meet Beekeeper');
    await user.click(button('Get started'));
    await heading(/language & voice/i);
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    await user.click(button('Download'));
    act(() =>
      fake.emit(
        'voice:modelProgress',
        modelState({ state: 'downloading', receivedBytes: 20_592_431, bytesPerSecond: 1_000_000 }),
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await heading(/try your microphone/i);
    await user.click(button('Skip for now'));
    await heading(/anywhere/i);
    await user.click(button('Continue'));
    await heading(/all set/i);

    const summary = screen.getByRole('list', { name: 'Setup summary' });
    expect(within(summary).getByText('Downloading… 50%')).toBeInTheDocument();

    act(() => fake.emit('voice:modelProgress', modelState({ state: 'ready' })));
    expect(await within(summary).findByText('Ready — voice works offline')).toBeInTheDocument();
  }, 20_000);
});
