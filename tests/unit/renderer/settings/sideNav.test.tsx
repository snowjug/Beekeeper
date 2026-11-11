import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SECTIONS, type SettingsPage } from '@renderer/settings/lib/nav';
import { SideNav } from '@renderer/settings/SideNav';

function Harness({ initial = 'general' }: { initial?: SettingsPage }) {
  const [section, setSection] = useState<SettingsPage>(initial);
  return (
    <MotionConfig reducedMotion="always">
      <SideNav section={section} onSelect={setSection} />
    </MotionConfig>
  );
}

const tabs = () => screen.getAllByRole('tab');
const selected = () => tabs().filter((tab) => tab.getAttribute('aria-selected') === 'true');

describe('SideNav keyboard navigation', () => {
  it('is a vertical tab list with one selected tab and a single tab stop', () => {
    render(<Harness initial="privacy" />);
    expect(screen.getByRole('tablist', { name: 'Settings sections' })).toHaveAttribute(
      'aria-orientation',
      'vertical',
    );
    expect(tabs().map((tab) => tab.textContent)).toEqual(SECTIONS.map((section) => section.label));
    expect(selected().map((tab) => tab.textContent)).toEqual(['Privacy']);
    expect(
      tabs()
        .filter((tab) => tab.tabIndex === 0)
        .map((tab) => tab.textContent),
    ).toEqual(['Privacy']);
    expect(tabs().every((tab) => tab.getAttribute('aria-controls') === 'settings-panel')).toBe(
      true,
    );
  });

  it('Tab enters on the selected tab; arrows move focus without selecting; Enter or Space activate', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab();
    expect(tabs()[0]).toHaveFocus();

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(tabs()[2]).toHaveFocus();
    expect(selected().map((tab) => tab.textContent)).toEqual(['General']);
    expect(tabs()[2]?.tabIndex).toBe(0);
    expect(tabs()[0]?.tabIndex).toBe(-1);

    await user.keyboard('{Enter}');
    expect(selected().map((tab) => tab.textContent)).toEqual(['Hotkeys']);

    await user.keyboard('{ArrowUp}');
    expect(tabs()[1]).toHaveFocus();
    await user.keyboard(' ');
    expect(selected().map((tab) => tab.textContent)).toEqual(['Voice']);
  });

  it('wraps around and supports Home and End', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();

    await user.keyboard('{ArrowUp}');
    expect(tabs().at(-1)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(tabs()[0]).toHaveFocus();
    await user.keyboard('{End}');
    expect(tabs().at(-1)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tabs()[0]).toHaveFocus();
  });

  it('Tab leaves the list instead of walking through every section', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
        <button type="button">After</button>
      </>,
    );
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('clicking selects and moves the tab stop', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'About' }));
    expect(selected().map((tab) => tab.textContent)).toEqual(['About']);
    expect(screen.getByRole('tab', { name: 'About' }).tabIndex).toBe(0);
  });
});
