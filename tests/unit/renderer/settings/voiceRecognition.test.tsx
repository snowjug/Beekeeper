import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { VoiceSection } from '@renderer/settings/sections/VoiceSection';
import {
  clearToasts,
  makeModel,
  makeSpeech,
  makeView,
  readyPack,
  renderWithController,
  startController,
  type StartOptions,
} from './support';

const MB = 1024 * 1024;
const MISSING_MODEL = makeModel({
  state: 'missing',
  receivedBytes: 0,
  totalBytes: 0,
  modelUrl: null,
});

async function mount(options: StartOptions = {}) {
  const h = await startController(options);
  const ui = renderWithController(<VoiceSection />, h.controller);
  return { h, ...ui };
}

const card = (name: string) => screen.getByRole('group', { name });
const radio = (name: string) => screen.getByRole('radio', { name });

afterEach(clearToasts);

describe('Voice section: language', () => {
  it('offers Auto, English (India) and Hindi and explains what Beekeeper understands', async () => {
    const user = userEvent.setup();
    const { h } = await mount();
    expect(
      screen.getByText(/Beekeeper understands Hindi, English and Hinglish/),
    ).toBeInTheDocument();
    expect(radio('Auto (English + Hindi)')).toHaveAttribute('aria-checked', 'true');

    await user.click(radio('Hindi'));
    await user.click(radio('English (India)'));
    expect(h.inputsOf('settings:update')).toEqual([
      { voice: { language: 'hi' } },
      { voice: { language: 'en' } },
    ]);
    h.stop();
  });
});

describe('Voice section: recognition cards', () => {
  it('lists the four engines with Whisper accurate recommended and selected by default', async () => {
    const { h } = await mount();
    const group = screen.getByRole('radiogroup', { name: 'Recognition engine' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((input) => input.getAttribute('value')),
    ).toEqual(['whisper-small', 'whisper-base', 'offline', 'azure']);
    expect(radio('Whisper accurate')).toBeChecked();
    expect(within(card('Whisper accurate')).getByText('Recommended')).toBeInTheDocument();
    expect(within(card('Whisper fast')).queryByText('Recommended')).toBeNull();
    expect(
      within(card('Whisper accurate')).getByText(/accented English and Hindi/),
    ).toBeInTheDocument();
    expect(within(card('Whisper accurate')).getByText(/About 358 MB/)).toBeInTheDocument();
    expect(within(card('Whisper fast')).getByText(/About 153 MB/)).toBeInTheDocument();
    h.stop();
  });

  it('choosing a card sends one patch with only what changes (engine and Whisper model)', async () => {
    const user = userEvent.setup();
    const { h } = await mount();

    await user.click(radio('Whisper fast'));
    await user.click(radio('Offline small (Vosk)'));
    await user.click(radio('Whisper accurate'));
    expect(h.inputsOf('settings:update')).toEqual([
      { voice: { whisperModel: 'base' } },
      { voice: { sttEngine: 'offline' } },
      { voice: { sttEngine: 'whisper', whisperModel: 'small' } },
    ]);
    expect(radio('Whisper accurate')).toBeChecked();
    h.stop();
  });

  it('downloads a pack, follows its progress and speaks the milestones', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      handlers: {
        'speech:ensurePack': () =>
          makeSpeech({ 'whisper-small': { state: 'downloading', totalBytes: 100 * MB } }),
      },
    });
    const whisper = card('Whisper accurate');
    await user.click(within(whisper).getByRole('button', { name: 'Download' }));
    expect(h.inputsOf('speech:ensurePack')).toEqual([{ pack: 'whisper-small' }]);
    expect(await within(whisper).findByText('Downloading')).toBeInTheDocument();
    expect(within(whisper).getByText('Downloading Whisper accurate.')).toBeInTheDocument();

    h.emit(
      'speech:state',
      makeSpeech({
        'whisper-small': {
          state: 'downloading',
          receivedBytes: 30 * MB,
          totalBytes: 100 * MB,
          bytesPerSecond: 2 * MB,
          etaSeconds: 35,
        },
      }),
    );
    const bar = await within(whisper).findByRole('progressbar', {
      name: 'Whisper accurate download',
    });
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    expect(
      within(whisper).getByText('30.0 MB of 100 MB \u00b7 2.00 MB/s \u00b7 about 35 s left'),
    ).toBeInTheDocument();
    expect(
      within(whisper).getByText('Whisper accurate: 25 percent downloaded.'),
    ).toBeInTheDocument();
    expect(within(whisper).queryByRole('button', { name: 'Download' })).toBeNull();

    h.emit(
      'speech:state',
      makeSpeech({
        'whisper-small': {
          state: 'downloading',
          receivedBytes: 60 * MB,
          totalBytes: 100 * MB,
          bytesPerSecond: 2 * MB,
          etaSeconds: 20,
        },
      }),
    );
    expect(
      await within(whisper).findByText('Whisper accurate: 50 percent downloaded.'),
    ).toBeInTheDocument();
    h.stop();
  });

  it('shows the checking and unpacking steps, then the ready pack with Remove', async () => {
    const { h } = await mount();
    const whisper = card('Whisper accurate');
    h.emit(
      'speech:state',
      makeSpeech({
        'whisper-small': { state: 'verifying', receivedBytes: 100 * MB, totalBytes: 100 * MB },
      }),
    );
    expect(await within(whisper).findByText('Checking')).toBeInTheDocument();
    expect(within(whisper).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

    h.emit(
      'speech:state',
      makeSpeech({
        'whisper-small': { state: 'extracting', receivedBytes: 100 * MB, totalBytes: 100 * MB },
      }),
    );
    expect(await within(whisper).findByText('Unpacking')).toBeInTheDocument();

    h.emit('speech:state', makeSpeech({ 'whisper-small': readyPack('whisper-small') }));
    expect(await within(whisper).findByText('Ready')).toBeInTheDocument();
    expect(within(whisper).getByText('Whisper accurate is ready.')).toBeInTheDocument();
    expect(within(whisper).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(within(whisper).queryByRole('progressbar')).toBeNull();
    h.stop();
  });

  it('cancels a running download and removes a ready pack only after a second press', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      speech: makeSpeech({
        'whisper-small': { state: 'downloading', receivedBytes: 10 * MB, totalBytes: 100 * MB },
        'whisper-base': readyPack('whisper-base'),
      }),
      handlers: {
        'speech:cancelPack': () => makeSpeech({ 'whisper-base': readyPack('whisper-base') }),
        'speech:removePack': () => makeSpeech(),
      },
    });
    await waitFor(() =>
      expect(within(card('Whisper accurate')).getByText('Downloading')).toBeInTheDocument(),
    );

    await user.click(within(card('Whisper accurate')).getByRole('button', { name: 'Cancel' }));
    expect(h.inputsOf('speech:cancelPack')).toEqual([{ pack: 'whisper-small' }]);
    expect(await within(card('Whisper accurate')).findByText('Not downloaded')).toBeInTheDocument();

    const fast = card('Whisper fast');
    await user.click(within(fast).getByRole('button', { name: 'Remove' }));
    expect(h.inputsOf('speech:removePack')).toHaveLength(0);
    await user.click(within(fast).getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() =>
      expect(h.inputsOf('speech:removePack')).toEqual([{ pack: 'whisper-base' }]),
    );
    expect(await within(fast).findByText('Not downloaded')).toBeInTheDocument();
    h.stop();
  });

  it('explains a failed download and retries it', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      speech: makeSpeech({
        'whisper-small': {
          state: 'error',
          receivedBytes: 5 * MB,
          totalBytes: 100 * MB,
          message: 'The checksum did not match.',
        },
      }),
      handlers: { 'speech:ensurePack': () => makeSpeech() },
    });
    const whisper = card('Whisper accurate');
    expect(await within(whisper).findByRole('alert')).toHaveTextContent(
      'The checksum did not match.',
    );
    await user.click(within(whisper).getByRole('button', { name: 'Retry' }));
    expect(h.inputsOf('speech:ensurePack')).toEqual([{ pack: 'whisper-small' }]);
    h.stop();
  });

  it('treats a cancelled download as paused and offers to resume it', async () => {
    const { h } = await mount({
      speech: makeSpeech({
        'whisper-base': {
          state: 'error',
          receivedBytes: 40 * MB,
          totalBytes: 100 * MB,
          message: 'The download was cancelled',
        },
      }),
    });
    const fast = card('Whisper fast');
    expect(await within(fast).findByText('Partly downloaded')).toBeInTheDocument();
    expect(within(fast).getByRole('button', { name: 'Resume download' })).toBeInTheDocument();
    expect(within(fast).queryByRole('alert')).toBeNull();
    h.stop();
  });

  it('shows a friendly message in the card when the main process refuses a download', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      handlers: {
        'speech:ensurePack': () => {
          throw new Error(
            "Error invoking remote method 'speech:ensurePack': Error: Speech is not available yet",
          );
        },
      },
    });
    const whisper = card('Whisper accurate');
    await user.click(within(whisper).getByRole('button', { name: 'Download' }));
    expect(await within(whisper).findByRole('alert')).toHaveTextContent(
      'Speech is not available yet',
    );
    expect(within(whisper).getByRole('button', { name: 'Download' })).toBeEnabled();
    expect(within(card('Whisper fast')).queryByRole('alert')).toBeNull();
    h.stop();
  });

  it('keeps working when the pack status cannot be read, and can try again', async () => {
    const user = userEvent.setup();
    let available = false;
    const { h } = await mount({
      handlers: {
        'speech:status': () => {
          if (!available) throw new Error('Speech is not available yet');
          return makeSpeech({ 'whisper-small': readyPack('whisper-small') });
        },
      },
    });
    const whisper = card('Whisper accurate');
    expect(await within(whisper).findByText('Unavailable')).toBeInTheDocument();
    expect(within(whisper).getByText('Speech is not available yet')).toBeInTheDocument();
    expect(radio('Whisper fast')).toBeEnabled();

    available = true;
    await user.click(within(whisper).getByRole('button', { name: 'Try again' }));
    expect(await within(whisper).findByText('Ready')).toBeInTheDocument();
    h.stop();
  });
});

describe('Voice section: what is used until a model is ready', () => {
  it('uses the offline model until Whisper has finished downloading', async () => {
    const { h } = await mount();
    expect(
      await screen.findByText('Using the offline model until Whisper accurate is downloaded.'),
    ).toBeInTheDocument();

    h.emit(
      'speech:state',
      makeSpeech({
        'whisper-small': { state: 'downloading', receivedBytes: MB, totalBytes: 100 * MB },
      }),
    );
    expect(
      await screen.findByText(
        'Using the offline model until Whisper accurate finishes downloading.',
      ),
    ).toBeInTheDocument();

    h.emit('speech:state', makeSpeech({ 'whisper-small': readyPack('whisper-small') }));
    await waitFor(() => expect(screen.queryByText(/^Using the offline model/)).toBeNull());
    h.stop();
  });

  it('falls back to the other Whisper model while the chosen one is missing', async () => {
    const { h } = await mount({
      speech: makeSpeech({ 'whisper-base': readyPack('whisper-base') }),
    });
    expect(
      await screen.findByText('Using Whisper fast until Whisper accurate is downloaded.'),
    ).toBeInTheDocument();
    h.stop();
  });

  it('says that only typed commands work when nothing can recognise speech yet', async () => {
    const { h } = await mount({ model: MISSING_MODEL });
    expect(
      await screen.findByText(/No speech recognition is ready yet, so only typed commands work/),
    ).toBeInTheDocument();
    h.stop();
  });

  it('names the recogniser that is used when the offline model is chosen but missing', async () => {
    const { h } = await mount({
      model: MISSING_MODEL,
      speech: makeSpeech({ 'whisper-small': readyPack('whisper-small') }),
      view: makeView((view) => {
        view.voice.sttEngine = 'offline';
      }),
    });
    expect(
      await screen.findByText('Using Whisper accurate until the offline model is downloaded.'),
    ).toBeInTheDocument();
    h.stop();
  });
});
