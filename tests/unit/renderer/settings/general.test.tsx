import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { GeneralSection } from '@renderer/settings/sections/GeneralSection';
import {
  clearToasts,
  makeInfo,
  makeView,
  renderWithController,
  startController,
  toastTitles,
} from './support';

afterEach(clearToasts);

describe('General section', () => {
  it('a toggle change sends exactly one minimal patch and shows the change at once', async () => {
    const user = userEvent.setup();
    const h = await startController();
    renderWithController(<GeneralSection />, h.controller);

    const toggle = screen.getByRole('switch', { name: 'Start with Windows' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);

    expect(h.inputsOf('settings:update')).toEqual([{ general: { startWithWindows: true } }]);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(h.main.view.general.startWithWindows).toBe(true);
    h.stop();
  });

  it('rolls the toggle back and says why when saving fails', async () => {
    const user = userEvent.setup();
    const h = await startController({
      handlers: {
        'settings:update': () => {
          throw new Error('Settings file is read-only');
        },
      },
    });
    renderWithController(<GeneralSection />, h.controller);

    const toggle = screen.getByRole('switch', { name: 'Start with Windows' });
    await user.click(toggle);

    await waitFor(() => expect(toastTitles()).toEqual(['Could not save that setting']));
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    h.stop();
  });

  it('theme, units and location use segmented controls with one-key patches', async () => {
    const user = userEvent.setup();
    const h = await startController();
    renderWithController(<GeneralSection />, h.controller);

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    await user.click(screen.getByRole('radio', { name: 'Imperial' }));
    await user.click(screen.getByRole('radio', { name: 'Manual' }));

    expect(h.inputsOf('settings:update')).toEqual([
      { general: { theme: 'dark' } },
      { general: { units: 'imperial' } },
      { general: { weatherLocation: { mode: 'manual', city: '' } } },
    ]);
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    h.stop();
  });

  it('shows the city field only for a manual location and commits it on blur', async () => {
    const user = userEvent.setup();
    const h = await startController();
    renderWithController(<GeneralSection />, h.controller);
    expect(screen.queryByRole('textbox', { name: 'City' })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Manual' }));
    const city = await screen.findByRole('textbox', { name: 'City' });
    await user.type(city, '  Seattle ');
    await user.tab();

    await waitFor(() =>
      expect(h.inputsOf('settings:update').at(-1)).toEqual({
        general: { weatherLocation: { mode: 'manual', city: 'Seattle' } },
      }),
    );
    expect(h.inputsOf('settings:update')).toHaveLength(2);
    h.stop();
  });

  it('commits typing after a pause, and never sends invalid text', async () => {
    const user = userEvent.setup();
    const h = await startController({
      view: makeView((view) => {
        view.general.weatherLocation = { mode: 'manual', city: '' };
      }),
    });
    renderWithController(<GeneralSection />, h.controller);

    const city = screen.getByRole('textbox', { name: 'City' });
    await user.type(city, 'Berlin');
    await waitFor(() => expect(h.inputsOf('settings:update')).toHaveLength(1), { timeout: 2000 });

    fireEvent.change(city, { target: { value: 'x'.repeat(81) } });
    fireEvent.blur(city);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'City names can be up to 80 characters.',
    );
    expect(city).toHaveAttribute('aria-invalid', 'true');
    expect(h.inputsOf('settings:update')).toHaveLength(1);
    h.stop();
  });

  it('keeps the display language visible but fixed, and replays the welcome tour', async () => {
    const user = userEvent.setup();
    const h = await startController({ handlers: { 'window:openOnboarding': () => undefined } });
    renderWithController(<GeneralSection />, h.controller);

    const language = screen.getByRole('combobox', { name: 'Display language' });
    expect(language).toHaveAttribute('aria-disabled', 'true');
    expect(language).toHaveDisplayValue('English (United States)');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText(/Choose the language you speak under Voice/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replay' }));
    expect(h.inputsOf('window:openOnboarding')).toHaveLength(1);
    h.stop();
  });

  it('cannot start the portable build with Windows', async () => {
    const h = await startController({ info: makeInfo({ portable: true }) });
    renderWithController(<GeneralSection />, h.controller);
    expect(screen.getByRole('switch', { name: 'Start with Windows' })).toBeDisabled();
    expect(screen.getByText(/portable build cannot start with Windows/i)).toBeInTheDocument();
    h.stop();
  });
});
