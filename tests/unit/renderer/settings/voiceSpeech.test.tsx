import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceSection } from '@renderer/settings/sections/VoiceSection';
import {
  clearToasts,
  makeModel,
  makeView,
  renderWithController,
  startController,
  type StartOptions,
} from './support';

const WAKE = 'Wake word \u201cHey Beekeeper\u201d';
const MISSING = makeModel({ state: 'missing', receivedBytes: 0, totalBytes: 0, modelUrl: null });

async function mount(options: StartOptions = {}) {
  const h = await startController(options);
  const ui = renderWithController(<VoiceSection />, h.controller);
  return { h, ...ui };
}

afterEach(() => {
  clearToasts();
  vi.unstubAllGlobals();
});

describe('Voice section: wake word and voice model', () => {
  it('locks the wake word until the offline model exists, and offers the download right there', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      model: MISSING,
      handlers: {
        'voice:modelEnsure': () =>
          makeModel({
            state: 'downloading',
            receivedBytes: 1_000_000,
            totalBytes: 40_000_000,
            bytesPerSecond: 500_000,
            etaSeconds: 70,
            attempt: 1,
            maxAttempts: 3,
            modelUrl: null,
          }),
      },
    });

    const wake = screen.getByRole('switch', { name: WAKE });
    expect(wake).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Pause wake word on battery saver' })).toBeDisabled();
    expect(screen.getByText(/The wake word needs the offline voice model/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download voice model' }));
    expect(h.inputsOf('voice:modelEnsure')).toHaveLength(1);

    const bar = await screen.findByRole('progressbar', { name: 'Voice model download' });
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(screen.getByText(/488 KB\/s/)).toBeInTheDocument();
    expect(screen.getByText(/about 1 min 10 s left/)).toBeInTheDocument();
    expect(screen.getByText('Attempt 1 of 3')).toBeInTheDocument();
    expect(screen.getByText(/Downloading the voice model/)).toBeInTheDocument();
    h.stop();
  });

  it('follows live progress, can cancel, and unlocks the wake word when the model is ready', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      model: MISSING,
      handlers: { 'voice:modelCancel': () => MISSING },
    });

    h.emit(
      'voice:modelProgress',
      makeModel({
        state: 'downloading',
        receivedBytes: 20_000_000,
        totalBytes: 40_000_000,
        bytesPerSecond: 1_000_000,
        etaSeconds: 20,
        modelUrl: null,
      }),
    );
    expect(
      await screen.findByRole('progressbar', { name: 'Voice model download' }),
    ).toHaveAttribute('aria-valuenow', '50');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.inputsOf('voice:modelCancel')).toHaveLength(1);

    h.emit('voice:modelProgress', makeModel());
    const wake = screen.getByRole('switch', { name: WAKE });
    await waitFor(() => expect(wake).toBeEnabled());
    await user.click(wake);
    expect(h.inputsOf('settings:update')).toEqual([{ voice: { wakeWord: true } }]);
    h.stop();
  });

  it('shows the wake-word worker status and its explanation', async () => {
    const { h } = await mount({
      view: makeView((view) => {
        view.voice.wakeWord = true;
      }),
    });
    expect(screen.queryByText(/Listening for/)).toBeNull();

    h.emit('voice:wakeStatus', { state: 'armed' });
    expect(await screen.findByText(/Listening for \u201cHey Beekeeper\u201d/)).toBeInTheDocument();

    h.emit('voice:wakeStatus', { state: 'paused', message: 'Battery saver is on.' });
    expect(await screen.findByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('Battery saver is on.')).toBeInTheDocument();

    h.emit('voice:wakeStatus', { state: 'error', message: 'The model failed to load.' });
    expect(await screen.findByText('Problem')).toBeInTheDocument();
    h.stop();
  });

  it('lets you turn the wake word off even if the model was removed', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      model: MISSING,
      view: makeView((view) => {
        view.voice.wakeWord = true;
      }),
    });
    const wake = screen.getByRole('switch', { name: WAKE });
    expect(wake).toBeEnabled();
    await user.click(wake);
    expect(h.inputsOf('settings:update')).toEqual([{ voice: { wakeWord: false } }]);
    h.stop();
  });

  it('retries a failed download and shows the reason', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      model: makeModel({
        state: 'error',
        receivedBytes: 5_000_000,
        message: 'The checksum did not match.',
        modelUrl: null,
      }),
      handlers: { 'voice:modelEnsure': () => MISSING },
    });
    const card = screen.getByRole('group', { name: 'Voice model' });
    expect(within(card).getByRole('alert')).toHaveTextContent('The checksum did not match.');

    await user.click(within(card).getByRole('button', { name: 'Retry' }));
    expect(h.inputsOf('voice:modelEnsure')).toHaveLength(1);
    h.stop();
  });

  it('removes the model only after a confirming second press', async () => {
    const user = userEvent.setup();
    const { h } = await mount({ handlers: { 'voice:modelRemove': () => MISSING } });
    const card = screen.getByRole('group', { name: 'Voice model' });

    await user.click(within(card).getByRole('button', { name: 'Remove' }));
    expect(h.inputsOf('voice:modelRemove')).toHaveLength(0);
    await user.click(within(card).getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(h.inputsOf('voice:modelRemove')).toHaveLength(1));
    await waitFor(() => expect(within(card).getByText('Not downloaded')).toBeInTheDocument());
    h.stop();
  });

  it('shows the ready model with its name and a Remove action', async () => {
    const { h } = await mount();
    const card = screen.getByRole('group', { name: 'Voice model' });
    expect(within(card).getByText('English (US) speech model, small')).toBeInTheDocument();
    expect(within(card).getByText('Ready')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(within(card).queryByRole('progressbar')).toBeNull();
    h.stop();
  });
});

describe('Voice section: recognition engine and toggles', () => {
  it('Azure Speech engine explains the missing setup and links to the AI section', async () => {
    const user = userEvent.setup();
    const { h } = await mount();
    expect(screen.queryByText(/Azure Speech is not set up yet/)).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Azure Speech' }));
    expect(h.inputsOf('settings:update')).toEqual([{ voice: { sttEngine: 'azure' } }]);
    expect(await screen.findByText(/Azure Speech is not set up yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open AI settings' }));
    expect(h.controller.store.getState().section).toBe('ai');
    h.stop();
  });

  it('does not nag once Azure Speech is configured', async () => {
    const { h } = await mount({
      view: makeView((view) => {
        view.voice.sttEngine = 'azure';
        view.ai.useAzureSpeech = true;
        view.ai.speechRegion = 'westeurope';
        view.secrets.speechKey = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221a2b';
      }),
    });
    expect(screen.queryByText(/Azure Speech is not set up yet/)).toBeNull();
    h.stop();
  });

  it('push-to-talk names the current hotkey and every toggle sends one minimal patch', async () => {
    const user = userEvent.setup();
    const { h } = await mount();
    expect(screen.getByText(/Hold Ctrl\+Shift\+Space to talk/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Push-to-talk' }));
    await user.click(screen.getByRole('switch', { name: 'Sound effects' }));
    await user.click(screen.getByRole('switch', { name: 'Spoken replies' }));
    expect(h.inputsOf('settings:update')).toEqual([
      { voice: { pushToTalk: true } },
      { voice: { earcons: false } },
      { voice: { ttsEnabled: false } },
    ]);
    h.stop();
  });
});

describe('Voice section: spoken replies', () => {
  class FakeUtterance {
    voice: unknown = null;
    lang = '';
    rate = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onboundary: (() => void) | null = null;
    constructor(readonly text: string) {}
  }

  function stubSpeech(
    voices: Array<{ voiceURI: string; name: string; lang: string; localService: boolean }>,
  ) {
    const speak = vi.fn((utterance: FakeUtterance) => {
      queueMicrotask(() => utterance.onstart?.());
    });
    const synth = {
      getVoices: vi.fn(() => voices),
      speak,
      cancel: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    return { synth, speak };
  }

  const VOICES = [
    { voiceURI: 'zira', name: 'Microsoft Zira', lang: 'en-US', localService: true },
    { voiceURI: 'david', name: 'Microsoft David', lang: 'en-US', localService: true },
    { voiceURI: 'katja', name: 'Microsoft Katja', lang: 'de-DE', localService: true },
  ];

  it('lists installed voices, saves the choice and previews it at the chosen speed', async () => {
    const user = userEvent.setup();
    const { speak } = stubSpeech(VOICES);
    const { h } = await mount({
      view: makeView((view) => {
        view.voice.ttsRate = 1.5;
      }),
    });

    const select = screen.getByRole('combobox', { name: 'Voice' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Automatic (best English voice)',
      'Microsoft David',
      'Microsoft Zira',
      'Microsoft Katja',
    ]);
    await user.selectOptions(select, 'zira');
    expect(h.inputsOf('settings:update')).toEqual([{ voice: { ttsVoiceUri: 'zira' } }]);

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
    const utterance = speak.mock.calls[0]?.[0];
    expect(utterance?.text).toContain('Beekeeper');
    expect(utterance?.rate).toBe(1.5);
    expect((utterance?.voice as { voiceURI: string } | null)?.voiceURI).toBe('zira');

    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    h.stop();
  });

  it('the speed slider shows its value and commits once, when released', async () => {
    stubSpeech(VOICES);
    const { h } = await mount();
    const slider = screen.getByRole('slider', { name: 'Speaking speed' });
    expect(slider).toHaveAttribute('min', '0.5');
    expect(slider).toHaveAttribute('max', '2');
    expect(slider).toHaveAttribute('aria-valuetext', '1.0\u00d7');

    fireEvent.change(slider, { target: { value: '1.3' } });
    fireEvent.change(slider, { target: { value: '1.6' } });
    expect(screen.getByText('1.6\u00d7')).toBeInTheDocument();
    expect(h.inputsOf('settings:update')).toHaveLength(0);

    fireEvent.pointerUp(slider);
    expect(h.inputsOf('settings:update')).toEqual([{ voice: { ttsRate: 1.6 } }]);
    h.stop();
  });

  it('falls back gracefully without system voices', async () => {
    const { h } = await mount();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Voice' })).toBeDisabled();
    h.stop();
  });

  it('the Azure engine swaps the voice list for an Azure voice name and cannot preview', async () => {
    const user = userEvent.setup();
    stubSpeech(VOICES);
    const { h } = await mount({
      view: makeView((view) => {
        view.voice.ttsEngine = 'azure';
      }),
    });
    expect(screen.queryByRole('combobox', { name: 'Voice' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();

    const name = screen.getByRole('textbox', { name: 'Azure voice' });
    await user.clear(name);
    await user.type(name, 'en-GB-SoniaNeural');
    await user.tab();
    await waitFor(() =>
      expect(h.inputsOf('settings:update').at(-1)).toEqual({
        voice: { azureVoice: 'en-GB-SoniaNeural' },
      }),
    );
    h.stop();
  });
});
