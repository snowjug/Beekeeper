import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '@renderer/settings/App';
import { SettingsController } from '@renderer/settings/controller';
import { createSettingsStore } from '@renderer/settings/store';
import {
  clearToasts,
  createFakeBridge,
  HOTKEY_STATUS,
  makeInfo,
  makeModel,
  makeView,
  renderWithController,
  startController,
} from './support';

afterEach(clearToasts);

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('Settings window', () => {
  it('shows a skeleton while settings load, then the first section', async () => {
    let open: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      open = resolve;
    });
    const fake = createFakeBridge({
      'settings:get': async () => {
        await pending;
        return makeView();
      },
      'app:info': () => makeInfo(),
      'hotkeys:status': () => HOTKEY_STATUS,
      'voice:modelStatus': () => makeModel(),
      'updates:state': () => ({ status: 'idle' }),
      'app:log': () => undefined,
    });
    const controller = new SettingsController(fake.bridge, createSettingsStore());
    const stop = controller.start();
    renderWithController(<App />, controller);

    expect(screen.getByRole('status', { name: 'Loading settings' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(8);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();

    open();
    expect(await heading('General')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading settings' })).toBeNull();
    stop();
  });

  it('explains a failed load and retries', async () => {
    const user = userEvent.setup();
    let healthy = false;
    const fake = createFakeBridge({
      'settings:get': () => {
        if (!healthy) throw new Error('Error: The settings file is locked');
        return makeView();
      },
      'app:info': () => makeInfo(),
      'hotkeys:status': () => HOTKEY_STATUS,
      'voice:modelStatus': () => makeModel(),
      'updates:state': () => ({ status: 'idle' }),
      'app:log': () => undefined,
    });
    const controller = new SettingsController(fake.bridge, createSettingsStore());
    const stop = controller.start();
    renderWithController(<App />, controller);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your settings');
    expect(alert).toHaveTextContent('The settings file is locked');

    healthy = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await heading('General')).toBeInTheDocument();
    stop();
  });

  it('opens the section from the query string, follows navigate events and the nav tabs', async () => {
    const user = userEvent.setup();
    const h = await startController({ section: 'about' });
    renderWithController(<App />, h.controller);
    expect(await heading('About')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'settings-tab-about');

    h.emit('settings:navigate', { section: 'privacy' });
    expect(await heading('Privacy')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Hotkeys' }));
    expect(await heading('Hotkeys')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hotkeys' })).toHaveAttribute('aria-selected', 'true');
    h.stop();
  });

  it('renders every section without errors', async () => {
    const user = userEvent.setup();
    const h = await startController();
    renderWithController(<App />, h.controller);
    await heading('General');

    for (const [tab, title] of [
      ['Voice', 'Voice'],
      ['Hotkeys', 'Hotkeys'],
      ['Circle to Search', 'Circle to Search'],
      ['AI', 'AI (optional Azure)'],
      ['Privacy', 'Privacy'],
      ['Updates', 'Updates'],
      ['About', 'About'],
      ['General', 'General'],
    ] as const) {
      await user.click(screen.getByRole('tab', { name: tab }));
      expect(await heading(title)).toBeInTheDocument();
    }
    h.stop();
  });

  it('uses a solid background only when the window has no system material', async () => {
    const h = await startController({ info: makeInfo({ material: 'none' }) });
    const { container } = renderWithController(<App />, h.controller);
    await heading('General');
    await waitFor(() => expect(container.firstElementChild).toHaveClass('bg-surface-solid'));
    h.stop();

    const mica = await startController({ info: makeInfo({ material: 'mica' }) });
    const second = renderWithController(<App />, mica.controller);
    await waitFor(() =>
      expect(second.container.firstElementChild).not.toHaveClass('bg-surface-solid'),
    );
    mica.stop();
  });
});
