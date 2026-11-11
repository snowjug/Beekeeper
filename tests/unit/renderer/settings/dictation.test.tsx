import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DictationSection } from '@renderer/settings/sections/DictationSection';
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

async function mount(options: StartOptions = {}) {
  const h = await startController(options);
  const ui = renderWithController(<DictationSection />, h.controller);
  return { h, ...ui };
}

afterEach(clearToasts);

const READY_WHISPER = makeSpeech({ 'whisper-small': readyPack('whisper-small') });

describe('Dictation section', () => {
  it('shows the defaults and every control sends one minimal patch', async () => {
    const user = userEvent.setup();
    const { h } = await mount({ speech: READY_WHISPER });
    expect(screen.getByRole('switch', { name: 'Dictation' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('combobox', { name: 'Dictation language' })).toHaveDisplayValue(
      'Same as Voice',
    );
    expect(screen.getByRole('combobox', { name: 'How the text is entered' })).toHaveDisplayValue(
      'Type with the keyboard',
    );
    expect(screen.getByRole('slider', { name: 'Stop after silence' })).toHaveAttribute(
      'aria-valuetext',
      '2.0 s',
    );
    expect(screen.getByRole('switch', { name: 'Spoken punctuation' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(screen.getByRole('switch', { name: 'Dictation' }));
    await user.click(screen.getByRole('switch', { name: 'Spoken punctuation' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dictation language' }), 'hi');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'How the text is entered' }),
      'paste',
    );
    expect(h.inputsOf('settings:update')).toEqual([
      { dictation: { enabled: false } },
      { dictation: { spokenPunctuation: false } },
      { dictation: { language: 'hi' } },
      { dictation: { method: 'paste' } },
    ]);
    h.stop();
  });

  it('offers Same as Voice, Auto, English and Hindi for the language', async () => {
    const { h } = await mount({ speech: READY_WHISPER });
    const language = screen.getByRole('combobox', { name: 'Dictation language' });
    expect(
      within(language)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Same as Voice', 'Auto (English + Hindi)', 'English (India)', 'Hindi']);
    h.stop();
  });

  it('the silence slider spans 0.8 to 8 seconds and commits once, when released', async () => {
    const { h } = await mount({ speech: READY_WHISPER });
    const slider = screen.getByRole('slider', { name: 'Stop after silence' });
    expect(slider).toHaveAttribute('min', '0.8');
    expect(slider).toHaveAttribute('max', '8');

    fireEvent.change(slider, { target: { value: '3.5' } });
    expect(screen.getByText('3.5 s')).toBeInTheDocument();
    expect(h.inputsOf('settings:update')).toHaveLength(0);
    fireEvent.pointerUp(slider);
    expect(h.inputsOf('settings:update')).toEqual([{ dictation: { silenceSeconds: 3.5 } }]);
    h.stop();
  });

  it('shows the shortcut and links to the Hotkeys page', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      speech: READY_WHISPER,
      view: makeView((view) => {
        view.hotkeys.dictation = 'Ctrl+Alt+J';
      }),
    });
    expect(screen.getByText('J')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Change shortcut/ }));
    expect(h.controller.store.getState().section).toBe('hotkeys');
    h.stop();
  });

  it('explains how dictation works', async () => {
    const { h } = await mount({ speech: READY_WHISPER });
    const steps = screen.getByRole('group', { name: 'How it works' });
    expect(within(steps).getByText('Press the shortcut and talk')).toBeInTheDocument();
    expect(within(steps).getByText(/Say “comma”, “full stop” or “new line”/)).toBeInTheDocument();
    h.stop();
  });

  it('warns, and links to Voice, when no speech recognition is ready', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      model: makeModel({ state: 'missing', receivedBytes: 0, totalBytes: 0, modelUrl: null }),
    });
    expect(
      await screen.findByText(/Dictation needs speech recognition and none is ready yet/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Voice' }));
    expect(h.controller.store.getState().section).toBe('voice');
    h.stop();
  });

  it('says that the offline model cannot dictate Hindi', async () => {
    const { h } = await mount({
      view: makeView((view) => {
        view.voice.sttEngine = 'offline';
      }),
    });
    expect(await screen.findByText(/understands English only/)).toBeInTheDocument();
    h.stop();
  });

  it('says nothing about the offline model when dictating English', async () => {
    const { h } = await mount({
      view: makeView((view) => {
        view.voice.sttEngine = 'offline';
        view.dictation.language = 'en';
      }),
    });
    await waitFor(() => expect(h.controller.store.getState().speech).not.toBeNull());
    expect(screen.queryByText(/understands English only/)).toBeNull();
    h.stop();
  });

  it('has no warning when Whisper is ready', async () => {
    const { h } = await mount({ speech: READY_WHISPER });
    await waitFor(() => expect(h.controller.store.getState().speech).not.toBeNull());
    expect(screen.queryByText(/Dictation needs speech recognition/)).toBeNull();
    expect(screen.queryByText(/understands English only/)).toBeNull();
    h.stop();
  });
});
