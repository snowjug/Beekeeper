import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SynthesizeResult } from '@shared/ipc/types';
import { SAMPLE_TEXT } from '@renderer/settings/lib/samples';
import { VoiceSection } from '@renderer/settings/sections/VoiceSection';
import {
  clearToasts,
  gate,
  makeSpeech,
  makeView,
  readyPack,
  renderWithController,
  startController,
  toastTitles,
  type StartOptions,
} from './support';

const player = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn(), dispose: vi.fn() }));

vi.mock('@renderer/lib/voice/player', () => ({
  SpeechPlayer: class {
    play = player.play;
    stop = player.stop;
    dispose = player.dispose;
  },
}));

const RESULT: SynthesizeResult = {
  format: 'f32',
  sampleRate: 24_000,
  data: new ArrayBuffer(16),
  durationMs: 4000,
  engine: 'natural',
  lang: 'en',
  elapsedMs: 120,
};

const NATURAL_READY = makeSpeech({ 'supertonic-3': readyPack('supertonic-3') });

async function mount(options: StartOptions = {}) {
  const h = await startController(options);
  const ui = renderWithController(<VoiceSection />, h.controller);
  return { h, ...ui };
}

const group = (name: string) => screen.getByRole('group', { name });

beforeEach(() => {
  player.play.mockReset().mockResolvedValue(undefined);
  player.stop.mockReset();
  player.dispose.mockReset().mockResolvedValue(undefined);
});

afterEach(clearToasts);

describe('Voice section: assistant voice engine', () => {
  it('offers four engines, defaults to the natural voice and swaps the panel under it', async () => {
    const user = userEvent.setup();
    const { h } = await mount();
    const engines = screen.getByRole('radiogroup', { name: 'Voice engine' });
    expect(
      within(engines)
        .getAllByRole('radio')
        .map((option) => option.textContent),
    ).toEqual(['Natural voice', 'Windows voices', 'ElevenLabs', 'Azure']);
    expect(screen.getByRole('radio', { name: 'Natural voice' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(group('Natural voice')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'ElevenLabs' })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'ElevenLabs' }));
    await user.click(screen.getByRole('radio', { name: 'Windows voices' }));
    await user.click(screen.getByRole('radio', { name: 'Azure' }));
    expect(h.inputsOf('settings:update')).toEqual([
      { voice: { ttsEngine: 'elevenlabs' } },
      { voice: { ttsEngine: 'system' } },
      { voice: { ttsEngine: 'azure' } },
    ]);
    expect(await screen.findByRole('group', { name: 'Azure voice' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Natural voice' })).toBeNull();
    expect(screen.getByText(/Azure Speech is not set up yet/)).toBeInTheDocument();
    h.stop();
  });

  it('says that the Windows voice is used until the natural voice is downloaded', async () => {
    const { h } = await mount();
    expect(
      await screen.findByText('Using the Windows voice until the natural voice is downloaded.'),
    ).toBeInTheDocument();

    h.emit(
      'speech:state',
      makeSpeech({
        'supertonic-3': { state: 'downloading', receivedBytes: 1000, totalBytes: 9000 },
      }),
    );
    expect(
      await screen.findByText(
        'Using the Windows voice until the natural voice finishes downloading.',
      ),
    ).toBeInTheDocument();

    h.emit('speech:state', NATURAL_READY);
    await waitFor(() => expect(screen.queryByText(/^Using the Windows voice/)).toBeNull());
    h.stop();
  });
});

describe('Voice section: natural voice', () => {
  it('shows the voice pack with its size and downloads it on request', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      handlers: {
        'speech:ensurePack': () =>
          makeSpeech({ 'supertonic-3': { state: 'downloading', totalBytes: 123_000_000 } }),
      },
    });
    const pack = group('Voice pack');
    expect(within(pack).getByText(/About 123 MB/)).toBeInTheDocument();
    expect(within(pack).getByText(/ten voices/)).toBeInTheDocument();
    await user.click(within(pack).getByRole('button', { name: 'Download' }));
    expect(h.inputsOf('speech:ensurePack')).toEqual([{ pack: 'supertonic-3' }]);
    expect(await within(pack).findByText('Downloading')).toBeInTheDocument();
    h.stop();
  });

  it('lists the ten voices with gender and tone, and saves the one you pick', async () => {
    const user = userEvent.setup();
    const { h } = await mount();
    const voices = screen.getByRole('radiogroup', { name: 'Natural voices' });
    const radios = within(voices).getAllByRole('radio');
    expect(radios).toHaveLength(10);
    expect(radios.map((input) => input.getAttribute('value'))).toEqual([
      'asha',
      'anaya',
      'meera',
      'diya',
      'kavya',
      'arjun',
      'vihaan',
      'rohan',
      'kabir',
      'dev',
    ]);
    expect(screen.getByRole('radio', { name: 'Asha' })).toBeChecked();
    expect(within(voices).getByText('Female · Warm and clear')).toBeInTheDocument();
    expect(within(voices).getByText('Male · Deep and rich')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Kabir' }));
    expect(h.inputsOf('settings:update')).toEqual([{ voice: { naturalVoice: 'kabir' } }]);
    h.stop();
  });

  it('cannot play samples until the pack is installed, and says why', async () => {
    const { h } = await mount();
    expect(
      screen.getByText('Download the voice pack above to hear the voices.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play sample of Asha' })).toBeDisabled();
    expect(player.play).not.toHaveBeenCalled();
    h.stop();
  });

  it('renders the English sample with the chosen voice and speed and plays it', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      speech: NATURAL_READY,
      view: makeView((view) => {
        view.voice.naturalSpeed = 1.2;
      }),
      handlers: { 'speech:synthesize': () => RESULT },
    });
    expect(screen.queryByText(/Download the voice pack above/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Play sample of Meera' }));
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));
    expect(h.inputsOf('speech:synthesize')).toEqual([
      { text: SAMPLE_TEXT.en, lang: 'en', voice: 'meera', speed: 1.2 },
    ]);
    expect(SAMPLE_TEXT.en).toBe(
      'Good morning! It is twenty-three degrees and sunny. You have two reminders today.',
    );
    expect(player.play).toHaveBeenCalledWith(RESULT);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Play sample of Meera' })).toBeEnabled(),
    );
    h.stop();
  });

  it('plays the Hindi sample when you speak Hindi, and English for Auto', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      speech: NATURAL_READY,
      view: makeView((view) => {
        view.voice.language = 'hi';
      }),
      handlers: { 'speech:synthesize': () => ({ ...RESULT, lang: 'hi' as const }) },
    });
    expect(screen.getByText(/Samples are in Hindi because you speak Hindi/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Play sample of Diya' }));
    await waitFor(() => expect(h.inputsOf('speech:synthesize')).toHaveLength(1));
    expect(h.inputsOf('speech:synthesize')[0]).toEqual({
      text: 'नमस्ते! आज मौसम साफ़ है और आपके दो रिमाइंडर हैं।',
      lang: 'hi',
      voice: 'diya',
      speed: 1,
    });

    await user.click(screen.getByRole('radio', { name: 'Auto (English + Hindi)' }));
    await user.click(await screen.findByRole('button', { name: 'Play sample of Diya' }));
    await waitFor(() => expect(h.inputsOf('speech:synthesize')).toHaveLength(2));
    expect(h.inputsOf('speech:synthesize')[1]).toMatchObject({ lang: 'en', text: SAMPLE_TEXT.en });
    h.stop();
  });

  it('shows that the sample is being prepared, then playing, and can be stopped', async () => {
    const user = userEvent.setup();
    const rendering = gate();
    const playing = gate();
    player.play.mockImplementation(() => playing.promise);
    const { h } = await mount({
      speech: NATURAL_READY,
      handlers: {
        'speech:synthesize': async () => {
          await rendering.promise;
          return RESULT;
        },
      },
    });

    await user.click(screen.getByRole('button', { name: 'Play sample of Asha' }));
    const stop = await screen.findByRole('button', { name: 'Stop sample of Asha' });
    expect(stop).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Preparing the sample of Asha...')).toBeInTheDocument();
    expect(player.play).not.toHaveBeenCalled();

    rendering.open();
    expect(await screen.findByText('Playing the sample of Asha.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop sample of Asha' })).toHaveAttribute(
      'aria-busy',
      'false',
    );

    await user.click(screen.getByRole('button', { name: 'Stop sample of Asha' }));
    expect(player.stop).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Play sample of Asha' })).toBeEnabled();
    playing.open();
    h.stop();
  });

  it('pressing another voice replaces the sample that is playing', async () => {
    const user = userEvent.setup();
    player.play.mockImplementation(() => new Promise<void>(() => undefined));
    const { h } = await mount({
      speech: NATURAL_READY,
      handlers: { 'speech:synthesize': () => RESULT },
    });
    await user.click(screen.getByRole('button', { name: 'Play sample of Asha' }));
    await screen.findByText('Playing the sample of Asha.');

    await user.click(screen.getByRole('button', { name: 'Play sample of Dev' }));
    await waitFor(() => expect(h.inputsOf('speech:synthesize')).toHaveLength(2));
    expect(player.stop).toHaveBeenCalled();
    expect(await screen.findByText('Playing the sample of Dev.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play sample of Asha' })).toBeInTheDocument();
    h.stop();
  });

  it('shows a friendly message when the sample cannot be rendered or played', async () => {
    const user = userEvent.setup();
    let failure: 'render' | 'audio' = 'render';
    const { h } = await mount({
      speech: NATURAL_READY,
      handlers: {
        'speech:synthesize': () => {
          if (failure === 'render') {
            throw new Error(
              "Error invoking remote method 'speech:synthesize': Error: The voice engine is not available",
            );
          }
          return RESULT;
        },
      },
    });
    await user.click(screen.getByRole('button', { name: 'Play sample of Asha' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The voice engine is not available');
    expect(screen.getByRole('button', { name: 'Play sample of Asha' })).toBeEnabled();

    failure = 'audio';
    player.play.mockRejectedValueOnce(new Error('Forbidden'));
    await user.click(screen.getByRole('button', { name: 'Play sample of Asha' }));
    expect(await screen.findByText(/Could not play the sample/)).toBeInTheDocument();
    h.stop();
  });

  it('stops playing and releases the audio when you leave the page', async () => {
    const user = userEvent.setup();
    player.play.mockImplementation(() => new Promise<void>(() => undefined));
    const { h, unmount } = await mount({
      speech: NATURAL_READY,
      handlers: { 'speech:synthesize': () => RESULT },
    });
    await user.click(screen.getByRole('button', { name: 'Play sample of Asha' }));
    await screen.findByText('Playing the sample of Asha.');
    unmount();
    expect(player.dispose).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('the speed slider spans 0.7 to 1.4 and commits one rounded value when released', async () => {
    const { h } = await mount();
    const slider = screen.getByRole('slider', { name: 'Speaking speed' });
    expect(slider).toHaveAttribute('min', '0.7');
    expect(slider).toHaveAttribute('max', '1.4');
    expect(slider).toHaveAttribute('aria-valuetext', '1.0\u00d7');

    fireEvent.change(slider, { target: { value: '1.2' } });
    fireEvent.change(slider, { target: { value: '1.3' } });
    expect(h.inputsOf('settings:update')).toHaveLength(0);
    fireEvent.pointerUp(slider);
    expect(h.inputsOf('settings:update')).toEqual([{ voice: { naturalSpeed: 1.3 } }]);
    h.stop();
  });
});

describe('Voice section: ElevenLabs', () => {
  const KEY_HINT = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221a2b';
  const elevenLabs = (configure?: (view: ReturnType<typeof makeView>) => void) =>
    makeView((view) => {
      view.voice.ttsEngine = 'elevenlabs';
      configure?.(view);
    });

  it('says that the replies are sent to ElevenLabs and offers key, voice ID and model', async () => {
    const { h } = await mount({ view: elevenLabs() });
    const panel = group('ElevenLabs');
    expect(
      within(panel).getByText(/text of Beekeeper's replies is sent to ElevenLabs/),
    ).toBeInTheDocument();
    expect(within(panel).getByLabelText('ElevenLabs API key')).toHaveAttribute('type', 'password');
    expect(
      within(panel).getByText('Paste a voice ID from your ElevenLabs Voice Library.'),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('combobox', { name: 'ElevenLabs model' })).toHaveDisplayValue(
      'Flash v2.5 (fast)',
    );
    expect(within(panel).getByRole('button', { name: 'Test voice' })).toBeDisabled();
    expect(
      screen.getByText(
        'ElevenLabs needs an API key and a voice ID. Using the Windows voice until you add them.',
      ),
    ).toBeInTheDocument();
    h.stop();
  });

  it('stores the key through ai:setKey under the name elevenlabs and shows only its hint', async () => {
    const user = userEvent.setup();
    const { h, container } = await mount({
      view: elevenLabs(),
      handlers: {
        'ai:setKey': () =>
          elevenLabs((view) => {
            view.secrets.elevenLabsKey = KEY_HINT;
          }),
      },
    });
    const panel = group('ElevenLabs');
    await user.type(within(panel).getByLabelText('ElevenLabs API key'), 'xi-secret-0123456789');
    await user.click(within(panel).getByRole('button', { name: 'Save key' }));

    await waitFor(() =>
      expect(h.inputsOf('ai:setKey')).toEqual([
        { name: 'elevenlabs', value: 'xi-secret-0123456789' },
      ]),
    );
    expect(await within(panel).findByText(KEY_HINT)).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('xi-secret-0123456789');
    expect(toastTitles()).toEqual(['Key saved']);
    h.stop();
  });

  it('validates the voice ID (letters and digits, up to 40) before saving it', async () => {
    const user = userEvent.setup();
    const { h } = await mount({ view: elevenLabs() });
    const id = screen.getByRole('textbox', { name: 'ElevenLabs voice ID' });

    await user.type(id, 'bad-id!');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A voice ID has letters and digits only (up to 40).',
    );
    expect(id).toHaveAttribute('aria-invalid', 'true');
    expect(h.inputsOf('settings:update')).toHaveLength(0);

    await user.clear(id);
    await user.type(id, 'a'.repeat(41));
    await user.tab();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(h.inputsOf('settings:update')).toHaveLength(0);

    await user.clear(id);
    await user.type(id, '21m00Tcm4TlvDq8ikWAM');
    await user.tab();
    await waitFor(() =>
      expect(h.inputsOf('settings:update')).toEqual([
        { voice: { elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM' } },
      ]),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    h.stop();
  });

  it('chooses the model with a one-key patch', async () => {
    const user = userEvent.setup();
    const { h } = await mount({ view: elevenLabs() });
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'ElevenLabs model' }),
      'eleven_multilingual_v2',
    );
    expect(h.inputsOf('settings:update')).toEqual([
      { voice: { elevenLabsModel: 'eleven_multilingual_v2' } },
    ]);
    h.stop();
  });

  it('tests the voice with service elevenlabs once the key and voice ID are saved', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      view: elevenLabs((view) => {
        view.voice.elevenLabsVoiceId = '21m00Tcm4TlvDq8ikWAM';
        view.secrets.elevenLabsKey = KEY_HINT;
      }),
      handlers: {
        'ai:test': () => ({ ok: true, message: 'ElevenLabs answered.', latencyMs: 640 }),
      },
    });
    expect(
      screen.queryByText(
        'ElevenLabs needs an API key and a voice ID. Using the Windows voice until you add them.',
      ),
    ).toBeNull();
    const panel = group('ElevenLabs');
    expect(
      within(panel).getByText('Checks the saved key and voice ID with ElevenLabs.'),
    ).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Test voice' }));
    expect(await within(panel).findByText('Connected')).toBeInTheDocument();
    expect(within(panel).getByText(/in 640 ms/)).toBeInTheDocument();
    expect(h.inputsOf('ai:test')).toEqual([{ service: 'elevenlabs' }]);
    h.stop();
  });

  it('reports a failing voice test without crashing', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      view: elevenLabs((view) => {
        view.voice.elevenLabsVoiceId = '21m00Tcm4TlvDq8ikWAM';
        view.secrets.elevenLabsKey = KEY_HINT;
      }),
      handlers: { 'ai:test': () => ({ ok: false, message: 'The key was rejected (401).' }) },
    });
    const panel = group('ElevenLabs');
    await user.click(within(panel).getByRole('button', { name: 'Test voice' }));
    expect(await within(panel).findByText('Connection failed')).toBeInTheDocument();
    expect(within(panel).getByText(/The key was rejected \(401\)/)).toBeInTheDocument();
    h.stop();
  });
});
