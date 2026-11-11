import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { button, goTo, heading, liveRegion, renderApp, stubCanvas } from './appHarness';
import { APP_INFO, createFakeBridge } from './testUtils';

stubCanvas();

describe('chrome and navigation', () => {
  it('opens on the welcome screen with a focused heading, progress and announcement', async () => {
    renderApp();
    const title = await heading('Meet Beekeeper');
    expect(title).toHaveFocus();
    expect(screen.getByRole('progressbar', { name: 'Step 1 of 5' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
    expect(screen.getByText(/Your voice-first assistant for Windows/)).toBeInTheDocument();
    for (const label of [
      'Voice & text commands',
      'English, Hindi & Hinglish',
      'Circle to Search',
      'Private by default, works offline',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(liveRegion()).toHaveTextContent('Step 1 of 5: Welcome');
    expect(button('Get started')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(button('Skip tour')).toBeInTheDocument();
  });

  it('moves forward and back, announcing every screen and moving focus to its heading', async () => {
    const { user } = renderApp();
    await heading('Meet Beekeeper');
    await user.click(button('Get started'));
    const title = await heading(/language & voice/i);
    await waitFor(() => expect(title).toHaveFocus());
    expect(screen.getByRole('progressbar', { name: 'Step 2 of 5' })).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('Step 2 of 5: Language & voice');

    await user.click(button('Back'));
    await heading('Meet Beekeeper');
    expect(screen.getByRole('progressbar', { name: 'Step 1 of 5' })).toBeInTheDocument();
  });

  it('plays the orb intro once: dots orbit, then settle into the breathing idle row', async () => {
    const { user, container } = renderApp();
    await heading('Meet Beekeeper');
    const orbState = () =>
      container.querySelector('[data-orb-state]')?.getAttribute('data-orb-state');
    expect(orbState()).toBe('thinking');
    await waitFor(() => expect(orbState()).toBe('idle'), { timeout: 4000 });

    await user.click(button('Get started'));
    await heading(/language & voice/i);
    await user.click(button('Back'));
    await heading('Meet Beekeeper');
    expect(orbState()).toBe('idle');
  }, 15_000);

  it('drifts four ambient blobs and lets the title strip drag the window', async () => {
    const { container } = renderApp();
    await heading('Meet Beekeeper');
    for (const drift of ['a', 'b', 'c', 'd']) {
      expect(container.querySelectorAll(`.ob-drift-${drift}`)).toHaveLength(1);
    }
    expect(screen.getByRole('banner')).toHaveClass('ob-titlebar', 'ob-drag');
    expect(button('Skip tour')).toHaveClass('ob-no-drag');
  });

  it('keeps a persistent navigation footer outside the sliding screens', async () => {
    const { user } = renderApp();
    await heading('Meet Beekeeper');
    const footer = screen.getByRole('contentinfo');
    const primary = within(footer).getByRole('button', { name: 'Get started' });
    await user.click(primary);
    await heading(/language & voice/i);
    expect(screen.getByRole('contentinfo')).toBe(footer);
    expect(within(footer).getByRole('button', { name: 'Download' })).toBe(primary);
  });

  it('walks through all five screens', async () => {
    const { user } = renderApp();
    await goTo(user, 'done');
    expect(screen.getByRole('progressbar', { name: 'Step 5 of 5' })).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('Step 5 of 5: All set');
  });

  it('absorbs a double click instead of skipping a screen or pressing the next button', async () => {
    const { user, fake, openMic } = renderApp({ cooldown: 450 });
    await heading('Meet Beekeeper');
    await user.dblClick(button('Get started'));
    await heading(/language & voice/i);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.getByRole('progressbar', { name: 'Step 2 of 5' })).toBeInTheDocument();
    expect(fake.inputsOf('speech:ensurePack')).toHaveLength(0);
    expect(openMic).not.toHaveBeenCalled();
  });

  it('Enter runs the primary action while focus is on the heading, never on a control', async () => {
    const { user, openMic } = renderApp();
    await heading('Meet Beekeeper');
    await user.keyboard('{Enter}');
    await heading(/language & voice/i);
    await user.click(button('Skip for now'));
    await heading(/try your microphone/i);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openMic).toHaveBeenCalledTimes(1));

    button('Back').focus();
    await user.keyboard('{Enter}');
    await heading(/language & voice/i);
    expect(openMic).toHaveBeenCalledTimes(1);
  });

  it('never closes or finishes on Escape', async () => {
    const { fake, user } = renderApp();
    await heading('Meet Beekeeper');
    await user.keyboard('{Escape}');
    const channels = fake.calls.map((call) => call.channel);
    expect(channels).not.toContain('onboarding:finish');
    expect(channels).not.toContain('window:closeSelf');
    expect(screen.getByRole('heading', { level: 1, name: 'Meet Beekeeper' })).toBeInTheDocument();
  });

  it('skips the whole tour from the first screen and not from the last one', async () => {
    const { fake, user } = renderApp();
    await heading('Meet Beekeeper');
    await user.click(button('Skip tour'));
    expect(fake.inputsOf('onboarding:finish')).toHaveLength(1);

    await goTo(user, 'done');
    expect(screen.queryByRole('button', { name: 'Skip tour' })).toBeNull();
  });

  it('shows a friendly message when finishing fails and keeps the app usable', async () => {
    const fake = createFakeBridge();
    fake.handle('onboarding:finish', () => {
      throw new Error('main is busy');
    });
    const { user } = renderApp({ fake });
    await heading('Meet Beekeeper');
    await user.click(button('Skip tour'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t finish setup just now. Please try again.',
    );
    await user.click(button('Get started'));
    await heading(/language & voice/i);
  });

  it('follows the theme and paints a solid surface when there is no system backdrop', async () => {
    const fake = createFakeBridge();
    fake.handle('app:info', () => ({ ...APP_INFO, theme: 'light', material: 'none' }));
    const { container } = renderApp({ fake });
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('light'));
    expect(container.firstElementChild).toHaveClass('bg-surface-solid');
    act(() => fake.emit('theme:changed', { theme: 'dark' }));
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('dark'));
  });

  it('keeps the page transparent over Mica and subscribes/unsubscribes cleanly', async () => {
    const { container, fake, unmount } = renderApp();
    await heading('Meet Beekeeper');
    expect(container.firstElementChild).not.toHaveClass('bg-surface-solid');
    expect(fake.listenerCount('voice:modelProgress')).toBe(1);
    expect(fake.listenerCount('speech:state')).toBe(1);
    unmount();
    for (const channel of [
      'voice:modelProgress',
      'speech:state',
      'settings:changed',
      'theme:changed',
      'voice:wakeStatus',
    ]) {
      expect(fake.listenerCount(channel)).toBe(0);
    }
  });

  it('survives every read failing and logs them', async () => {
    const fake = createFakeBridge();
    const reads = [
      'app:info',
      'settings:get',
      'hotkeys:status',
      'voice:modelStatus',
      'speech:status',
    ] as const;
    for (const channel of reads) {
      fake.handle(channel, () => {
        throw new Error(`${channel} is down`);
      });
    }
    const { user } = renderApp({ fake });
    await heading('Meet Beekeeper');
    await user.click(button('Get started'));
    await heading(/language & voice/i);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t check the downloads');
    expect(button('Download')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(await screen.findByText(/Couldn’t check the voice model/)).toBeInTheDocument();
    const logged = fake.inputsOf('app:log').map((input) => (input as { message: string }).message);
    for (const channel of reads) {
      expect(logged.some((message) => message.startsWith(`${channel}:`))).toBe(true);
    }
  });
});
