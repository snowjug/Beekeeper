import { act, screen, waitFor, within } from '@testing-library/react';
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
import { createFakeBridge, readyPack, settingsView, speechState } from './testUtils';

stubCanvas();

async function openLanguageScreen(options: RenderOptions = {}) {
  const rendered = renderApp(options);
  await goTo(rendered.user, 'language');
  return rendered;
}

const radio = (name: string) => screen.getByRole('radio', { name });

const MIB = 1024 * 1024;

/** Both packs 50 % done (100 MiB each, 2 MiB/s each, so every figure below is exact). */
const HALF = {
  state: 'downloading' as const,
  receivedBytes: 50 * MIB,
  totalBytes: 100 * MIB,
  bytesPerSecond: 2 * MIB,
  etaSeconds: 25,
};
const halfway = () => speechState({ 'whisper-small': HALF, 'supertonic-3': HALF });
const bothReady = () =>
  speechState({
    'whisper-small': readyPack('whisper-small'),
    'supertonic-3': readyPack('supertonic-3'),
  });

describe('language & voice screen: choices', () => {
  it('asks for the language and the quality, with Both and Best chosen by default', async () => {
    await openLanguageScreen();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: /Pick your language & voice/ }),
      ).toHaveFocus(),
    );
    expect(
      screen.getByRole('radiogroup', { name: 'Which language do you speak?' }),
    ).toBeInTheDocument();
    expect(radio('English')).not.toBeChecked();
    expect(radio('हिन्दी')).not.toBeChecked();
    expect(radio('Both')).toBeChecked();
    expect(document.querySelector('[lang="hi"]')?.textContent).toBe('हिन्दी');

    expect(
      screen.getByRole('radiogroup', { name: 'How should it sound and listen?' }),
    ).toBeInTheDocument();
    expect(radio('Best')).toBeChecked();
    expect(radio('Light')).not.toBeChecked();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText('≈ 500 MB download')).toBeInTheDocument();
    expect(screen.getByText('≈ 40 MB · English')).toBeInTheDocument();
    expect(screen.getByText(/Natural voice \+ accurate recognition/)).toBeInTheDocument();
  });

  it('saves the language at once with settings:update', async () => {
    const { fake, user } = await openLanguageScreen();
    await user.click(radio('हिन्दी'));
    await user.click(radio('English'));
    await user.click(radio('Both'));
    expect(fake.inputsOf('settings:update')).toEqual([
      { voice: { language: 'hi' } },
      { voice: { language: 'en' } },
      { voice: { language: 'auto' } },
    ]);
    await waitFor(() => expect(radio('Both')).toBeChecked());
  });

  it('shows the saved language when the tour is replayed', async () => {
    const fake = createFakeBridge();
    fake.handle('settings:get', () => settingsView({ voice: { language: 'hi' } }));
    await openLanguageScreen({ fake });
    await waitFor(() => expect(radio('हिन्दी')).toBeChecked());
  });

  it('saves the quality as one change of recognition and voice engine', async () => {
    const { fake, user } = await openLanguageScreen();
    await user.click(radio('Light'));
    await waitFor(() => expect(radio('Light')).toBeChecked());
    await user.click(radio('Best'));
    expect(fake.inputsOf('settings:update')).toEqual([
      { voice: { sttEngine: 'offline', ttsEngine: 'system' } },
      { voice: { sttEngine: 'whisper', whisperModel: 'small', ttsEngine: 'natural' } },
    ]);
    await waitFor(() => expect(radio('Best')).toBeChecked());
  });

  it('rolls a choice back and says so when saving fails', async () => {
    const fake = createFakeBridge();
    fake.handle('settings:update', () => {
      throw new Error('disk is full');
    });
    const { user } = await openLanguageScreen({ fake });
    await user.click(radio('English'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that setting');
    await waitFor(() => expect(radio('Both')).toBeChecked());
  });
});

describe('language & voice screen: the Best download', () => {
  it('never downloads on its own and offers Download or Skip for now', async () => {
    const { fake } = await openLanguageScreen();
    expect(await screen.findByText('Not downloaded yet')).toBeInTheDocument();
    expect(fake.inputsOf('speech:status')).toHaveLength(1);
    expect(fake.inputsOf('speech:ensurePack')).toHaveLength(0);
    expect(fake.inputsOf('voice:modelEnsure')).toHaveLength(0);
    expect(button('Download')).toBeInTheDocument();
    expect(button('Skip for now')).toBeInTheDocument();
    const lines = screen.getByRole('list', { name: 'Downloads' });
    expect(within(lines).getByText('Accurate recognition')).toBeInTheDocument();
    expect(within(lines).getByText('Natural voice')).toBeInTheDocument();
  });

  it('starts the accurate recognition and the natural voice with speech:ensurePack', async () => {
    const { fake, user } = await openLanguageScreen();
    await user.click(button('Download'));
    expect(fake.inputsOf('speech:ensurePack')).toEqual(
      expect.arrayContaining([{ pack: 'whisper-small' }, { pack: 'supertonic-3' }]),
    );
    expect(fake.inputsOf('speech:ensurePack')).toHaveLength(2);
    expect(fake.inputsOf('voice:modelEnsure')).toHaveLength(0);
    expect(await screen.findByText('Downloading…')).toBeInTheDocument();
    expect(button('Continue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
  });

  it('shows one combined progress with speed, time left and a line per download', async () => {
    const { fake, user } = await openLanguageScreen();
    await user.click(button('Download'));
    act(() => fake.emit('speech:state', halfway()));

    expect(
      await screen.findByRole('img', { name: 'Voice and recognition download, 50 percent' }),
    ).toBeInTheDocument();
    expect(screen.getByText('4.0 MB/s')).toBeInTheDocument();
    expect(screen.getByText('25 s')).toBeInTheDocument();
    expect(
      screen.getByText(/Accurate recognition \+ Natural voice · 100\.0 MB of 200\.0 MB/),
    ).toBeInTheDocument();
    const lines = screen.getByRole('list', { name: 'Downloads' });
    expect(within(lines).getAllByText('50%')).toHaveLength(2);
    expect(liveRegion()).toHaveTextContent('Natural voice and recognition 50 percent downloaded.');
  });

  it('counts a finished download as done while the other one is still running', async () => {
    const { fake, user } = await openLanguageScreen();
    await user.click(button('Download'));
    act(() =>
      fake.emit(
        'speech:state',
        speechState({
          'whisper-small': {
            ...readyPack('whisper-small'),
            totalBytes: 100 * MIB,
            receivedBytes: 100 * MIB,
          },
          'supertonic-3': { ...HALF, receivedBytes: 0 },
        }),
      ),
    );
    expect(
      await screen.findByRole('img', { name: 'Voice and recognition download, 50 percent' }),
    ).toBeInTheDocument();
    const lines = screen.getByRole('list', { name: 'Downloads' });
    expect(within(lines).getByText('Ready')).toBeInTheDocument();
    expect(within(lines).getByText('0%')).toBeInTheDocument();
  });

  it('celebrates when both downloads are ready and lets the user continue', async () => {
    const { fake } = await openLanguageScreen();
    act(() => fake.emit('speech:state', bothReady()));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Voice and recognition ready' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Voice and recognition ready' })).toBeInTheDocument();
    expect(button('Continue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
  });

  it('opens already finished when the downloads exist from an earlier run', async () => {
    const fake = createFakeBridge();
    fake.handle('speech:status', () => bothReady());
    await openLanguageScreen({ fake });
    expect(await screen.findByText('Voice and recognition ready')).toBeInTheDocument();
    expect(button('Continue')).toBeInTheDocument();
  });

  it('keeps downloading in the background while the user moves on', async () => {
    const { fake, user } = await openLanguageScreen();
    await user.click(button('Download'));
    act(() => fake.emit('speech:state', halfway()));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await heading(/try your microphone/i);
    expect(fake.inputsOf('speech:cancelPack')).toHaveLength(0);
    expect(fake.listenerCount('speech:state')).toBe(1);

    act(() => fake.emit('speech:state', bothReady()));
    await user.click(button('Back'));
    expect(await screen.findByText('Voice and recognition ready')).toBeInTheDocument();
  });

  it('skips the downloads but keeps the language that was chosen', async () => {
    const { fake, user } = await openLanguageScreen();
    await user.click(radio('हिन्दी'));
    await user.click(button('Skip for now'));
    await heading(/try your microphone/i);
    expect(fake.inputsOf('speech:ensurePack')).toHaveLength(0);
    expect(fake.inputsOf('settings:update')).toEqual([{ voice: { language: 'hi' } }]);
  });

  it('pauses what is running, shows Paused, and resumes with the rest', async () => {
    const { fake, user } = await openLanguageScreen();
    await user.click(button('Download'));
    act(() => fake.emit('speech:state', halfway()));
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(fake.inputsOf('speech:cancelPack')).toHaveLength(2);

    act(() =>
      fake.emit(
        'speech:state',
        speechState({
          'whisper-small': {
            state: 'error',
            receivedBytes: 50 * MIB,
            totalBytes: 100 * MIB,
            message: 'The download was cancelled',
          },
          'supertonic-3': {
            state: 'error',
            receivedBytes: 50 * MIB,
            totalBytes: 100 * MIB,
            message: 'The download was cancelled',
          },
        }),
      ),
    );
    expect(await screen.findByRole('heading', { level: 2, name: 'Paused' })).toBeInTheDocument();
    expect(screen.queryByText(/didn’t finish/)).toBeNull();
    expect(screen.getByText(/50% is already on your PC/)).toBeInTheDocument();
    expect(button('Resume')).toBeInTheDocument();

    await user.click(button('Resume'));
    expect(fake.inputsOf('speech:ensurePack')).toHaveLength(4);
  });

  it('explains a failed download and retries it', async () => {
    const { fake, user } = await openLanguageScreen();
    await user.click(button('Download'));
    act(() =>
      fake.emit(
        'speech:state',
        speechState({
          'whisper-small': HALF,
          'supertonic-3': {
            state: 'error',
            receivedBytes: 10_000_000,
            message: 'No internet connection',
          },
        }),
      ),
    );
    expect(await screen.findByText('The download didn’t finish')).toBeInTheDocument();
    expect(screen.getByText(/No internet connection\. Your progress is kept/)).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('download failed. No internet connection');

    await user.click(button('Retry'));
    expect(fake.inputsOf('speech:ensurePack').length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the click undone and says so when a download cannot be started', async () => {
    const fake = createFakeBridge();
    fake.handle('speech:ensurePack', () => {
      throw new Error('speech is not available');
    });
    const { user } = await openLanguageScreen({ fake });
    await user.click(button('Download'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t start the download');
    await waitFor(() => expect(screen.getByText('Not downloaded yet')).toBeInTheDocument());
    expect(button('Download')).toBeInTheDocument();
  });

  it('says so, and still lets the user continue, when the pack status cannot be read', async () => {
    const fake = createFakeBridge();
    fake.handle('speech:status', () => {
      throw new Error('ipc down');
    });
    const { user } = await openLanguageScreen({ fake });
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t check the downloads');
    await user.click(button('Skip for now'));
    await heading(/try your microphone/i);
  });

  it('locks the quality while a download runs, until it is paused', async () => {
    const { fake, user } = await openLanguageScreen();
    await user.click(button('Download'));
    act(() => fake.emit('speech:state', halfway()));
    expect(
      await screen.findByText(/Pause the download to switch between Best and Light/),
    ).toBeInTheDocument();
    expect(radio('Light')).toBeDisabled();
    expect(radio('English')).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => fake.emit('speech:state', speechState()));
    await waitFor(() => expect(radio('Light')).toBeEnabled());
  });

  it('applies settings changed elsewhere', async () => {
    const { fake } = await openLanguageScreen();
    act(() => fake.emit('settings:changed', settingsView({ voice: { language: 'en' } })));
    await waitFor(() => expect(radio('English')).toBeChecked());
  });
});
