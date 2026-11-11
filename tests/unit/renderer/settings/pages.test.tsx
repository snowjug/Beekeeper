import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PrivacySection } from '@renderer/settings/sections/PrivacySection';
import { AboutSection } from '@renderer/settings/sections/AboutSection';
import { CircleSection } from '@renderer/settings/sections/CircleSection';
import { UpdatesSection } from '@renderer/settings/sections/UpdatesSection';
import { ISSUES_URL, RELEASES_URL, REPO_URL } from '@renderer/settings/lib/links';
import { THIRD_PARTY_NOTICES } from '@renderer/settings/sections/about/notices';
import {
  clearToasts,
  makeInfo,
  makeView,
  renderWithController,
  startController,
  toastTitles,
  type StartOptions,
} from './support';

afterEach(clearToasts);

async function mount(ui: ReactElement, options: StartOptions = {}) {
  const h = await startController(options);
  const rendered = renderWithController(ui, h.controller);
  return { h, ...rendered };
}

describe('Privacy section', () => {
  const history = () => ({ entries: [], total: 3 });

  it('states there is no telemetry and lists what can use the network', async () => {
    const { h } = await mount(<PrivacySection />, { handlers: { 'assistant:history': history } });
    expect(
      screen.getByText(/no telemetry: nothing is collected or sent about you/),
    ).toBeInTheDocument();

    const network = screen.getByRole('group', { name: 'What can use the internet' });
    for (const name of [
      'Weather',
      'Dictionary',
      'Voice model download',
      'Natural voice download',
      'Whisper speech models',
      'Azure (optional)',
      'ElevenLabs (optional)',
      'Update check',
    ]) {
      expect(within(network).getByText(name)).toBeInTheDocument();
    }
    expect(within(network).getByText(/Open-Meteo/)).toBeInTheDocument();
    expect(within(network).getByText(/dictionaryapi\.dev/)).toBeInTheDocument();
    expect(within(network).getByText(/ccoreilly\.github\.io/)).toBeInTheDocument();
    expect(within(network).getByText(/GitHub Releases/)).toBeInTheDocument();
    h.stop();
  });

  it('names the hosts of the speech downloads and what ElevenLabs receives', async () => {
    const { h } = await mount(<PrivacySection />, { handlers: { 'assistant:history': history } });
    const network = screen.getByRole('group', { name: 'What can use the internet' });
    expect(
      within(network).getByText(/Only when you download the natural voice.*from github\.com/),
    ).toBeInTheDocument();
    expect(
      within(network).getByText(/Only when you download Whisper.*from huggingface\.co/),
    ).toBeInTheDocument();
    expect(
      within(network).getByText(/the text of Beekeeper's replies is sent to api\.elevenlabs\.io/),
    ).toBeInTheDocument();
    h.stop();
  });

  it('save history is a one-key patch', async () => {
    const user = userEvent.setup();
    const { h } = await mount(<PrivacySection />, { handlers: { 'assistant:history': history } });
    await user.click(screen.getByRole('switch', { name: 'Save conversation history' }));
    expect(h.inputsOf('settings:update')).toEqual([{ privacy: { saveHistory: false } }]);
    h.stop();
  });

  it('clearing history needs a second press, then reports how many items went', async () => {
    const user = userEvent.setup();
    const { h } = await mount(<PrivacySection />, {
      handlers: { 'assistant:history': history, 'assistant:clearHistory': () => 3 },
    });
    expect(
      await screen.findByText('Deletes 3 saved conversations from this PC.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(h.inputsOf('assistant:clearHistory')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes, clear it' }));
    await waitFor(() => expect(toastTitles()).toEqual(['Cleared 3 items']));
    expect(h.inputsOf('assistant:clearHistory')).toHaveLength(1);
    expect(
      await screen.findByText('Deletes 0 saved conversations from this PC.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear history' })).toBeDisabled();
    h.stop();
  });

  it('cancelling the confirmation does nothing', async () => {
    const user = userEvent.setup();
    const { h } = await mount(<PrivacySection />, {
      handlers: { 'assistant:history': history, 'privacy:clearNotes': () => 2 },
    });
    await user.click(screen.getByRole('button', { name: 'Clear notes' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Clear notes' })).toBeInTheDocument();
    expect(h.inputsOf('privacy:clearNotes')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Clear notes' }));
    await user.click(screen.getByRole('button', { name: 'Yes, clear them' }));
    await waitFor(() => expect(toastTitles()).toEqual(['Cleared 2 notes']));
    h.stop();
  });

  it('reports a failure to clear instead of claiming success, and opens the logs folder', async () => {
    const user = userEvent.setup();
    const { h } = await mount(<PrivacySection />, {
      handlers: {
        'assistant:history': history,
        'assistant:clearHistory': () => {
          throw new Error('The history file is in use');
        },
        'privacy:openLogs': () => undefined,
      },
    });
    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    await user.click(screen.getByRole('button', { name: 'Yes, clear it' }));
    await waitFor(() => expect(toastTitles()).toEqual(['Could not clear the history']));

    await user.click(screen.getByRole('button', { name: 'Open logs folder' }));
    expect(h.inputsOf('privacy:openLogs')).toHaveLength(1);
    h.stop();
  });
});

describe('Updates section', () => {
  it('shows the version and status, and checks on demand', async () => {
    const user = userEvent.setup();
    const { h } = await mount(<UpdatesSection />, {
      handlers: { 'updates:check': () => ({ status: 'none' as const }) },
    });
    expect(screen.getByText('Beekeeper 1.0.0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart to update' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Up to date')).toBeInTheDocument();
    expect(h.inputsOf('updates:check')).toHaveLength(1);
    h.stop();
  });

  it('shows download progress from update events and offers a restart only when ready', async () => {
    const user = userEvent.setup();
    const { h } = await mount(<UpdatesSection />, {
      handlers: { 'updates:install': () => undefined },
    });

    h.emit('updates:state', { status: 'downloading', version: '1.1.0', progress: 42 });
    expect(await screen.findByRole('progressbar', { name: 'Update download' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
    expect(screen.getByText('Downloading version 1.1.0 (42%).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Restart to update' })).toBeNull();

    h.emit('updates:state', { status: 'ready', version: '1.1.0' });
    await user.click(await screen.findByRole('button', { name: 'Restart to update' }));
    expect(h.inputsOf('updates:install')).toHaveLength(1);
    expect(screen.queryByRole('progressbar')).toBeNull();
    h.stop();
  });

  it('auto-update is a one-key patch', async () => {
    const user = userEvent.setup();
    const { h } = await mount(<UpdatesSection />);
    await user.click(screen.getByRole('switch', { name: 'Update automatically' }));
    expect(h.inputsOf('settings:update')).toEqual([{ updates: { autoUpdate: false } }]);
    h.stop();
  });

  it('explains that the portable build does not self-update and links to the releases page', async () => {
    const user = userEvent.setup();
    const { h } = await mount(<UpdatesSection />, {
      info: makeInfo({ portable: true }),
      handlers: {
        'updates:state': () => ({
          status: 'disabled' as const,
          message: 'The portable build does not update itself.',
        }),
        'app:openExternal': () => true,
      },
    });
    expect(await screen.findByText('Updates off')).toBeInTheDocument();
    expect(screen.getByText(/This is the portable build/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Update automatically' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Open the releases page' }));
    expect(h.inputsOf('app:openExternal')).toEqual([{ url: RELEASES_URL }]);
    expect(RELEASES_URL).toBe('https://github.com/snowjug/Beekeeper/releases');
    h.stop();
  });
});

describe('About section', () => {
  it('shows version details, the licence excerpt and third-party notices', async () => {
    const { h } = await mount(<AboutSection />);
    expect(screen.getByRole('img', { name: 'Beekeeper logo' })).toBeInTheDocument();
    expect(
      screen.getByText('A voice-first desktop assistant for Windows with Circle to Search.'),
    ).toBeInTheDocument();
    expect(screen.getByText('45.2.1')).toBeInTheDocument();
    expect(screen.getByText('140.0.0.0')).toBeInTheDocument();
    expect(screen.getByText('26100')).toBeInTheDocument();
    expect(screen.getByText('MIT License')).toBeInTheDocument();

    const notices = screen.getByRole('group', { name: 'Third-party notices' });
    expect(within(notices).getAllByRole('listitem')).toHaveLength(THIRD_PARTY_NOTICES.length);
    expect(within(notices).getByText('Vosk (vosk-browser)')).toBeInTheDocument();
    expect(within(notices).getAllByText('Apache-2.0')).toHaveLength(
      THIRD_PARTY_NOTICES.filter((notice) => notice.license === 'Apache-2.0').length,
    );
    h.stop();
  });

  it('credits the speech models and the optional online voice with their licenses', async () => {
    const { h } = await mount(<AboutSection />);
    const notices = screen.getByRole('group', { name: 'Third-party notices' });
    const row = (name: string) => within(notices).getByText(name).closest('li') as HTMLElement;

    expect(
      within(row('Supertonic 3 (Supertone Inc.)')).getByText('OpenRAIL-M'),
    ).toBeInTheDocument();
    expect(
      within(row('Supertonic sample code (Supertone Inc.)')).getByText('MIT'),
    ).toBeInTheDocument();
    expect(within(row('OpenAI Whisper')).getByText('MIT')).toBeInTheDocument();
    expect(within(row('sherpa-onnx (k2-fsa)')).getByText('Apache-2.0')).toBeInTheDocument();
    expect(within(row('ElevenLabs')).getByText('Online service')).toBeInTheDocument();
    h.stop();
  });

  it('opens the repository and the issue form, and copies the data folder', async () => {
    const user = userEvent.setup();
    const { h } = await mount(<AboutSection />, {
      handlers: { 'app:openExternal': () => true, 'app:copyText': () => undefined },
    });

    await user.click(screen.getByRole('button', { name: 'Open on GitHub' }));
    await user.click(screen.getByRole('button', { name: 'Report an issue' }));
    expect(h.inputsOf('app:openExternal')).toEqual([{ url: REPO_URL }, { url: ISSUES_URL }]);
    expect(ISSUES_URL).toBe('https://github.com/snowjug/Beekeeper/issues/new/choose');

    expect(screen.getByText('C:\\Users\\tester\\AppData\\Roaming\\Beekeeper')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy path' }));
    await waitFor(() =>
      expect(h.inputsOf('app:copyText')).toEqual([
        { text: 'C:\\Users\\tester\\AppData\\Roaming\\Beekeeper' },
      ]),
    );
    expect(toastTitles()).toContain('Path copied');
    h.stop();
  });
});

describe('Circle to Search section', () => {
  it('saves the default action and jumps to the Hotkeys section from the shortcut reminder', async () => {
    const user = userEvent.setup();
    const { h } = await mount(<CircleSection />, {
      view: makeView((view) => {
        view.hotkeys.circle = 'Ctrl+Alt+C';
      }),
    });
    expect(screen.getByText('Alt')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Default action' }), 'translate');
    expect(h.inputsOf('settings:update')).toEqual([{ circle: { defaultAction: 'translate' } }]);

    await user.click(screen.getByRole('button', { name: /Change shortcut/ }));
    expect(h.controller.store.getState().section).toBe('hotkeys');

    for (const gesture of ['Circle', 'Scribble', 'Tap', 'Esc']) {
      expect(screen.getByText(gesture)).toBeInTheDocument();
    }
    h.stop();
  });
});
