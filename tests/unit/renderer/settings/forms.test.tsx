import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  KeyCombo,
  LevelMeter,
  Segmented,
  SelectField,
  SettingRow,
  SettingsGroup,
  StatusPill,
  ToggleRow,
} from '@renderer/components/forms';
import { SliderField, TextField } from '@renderer/settings/ui/fields';

function Choices({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState('b');
  return (
    <MotionConfig reducedMotion="always">
      <Segmented
        label="Letters"
        value={value}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C', disabled: true },
          { value: 'd', label: 'D' },
        ]}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </MotionConfig>
  );
}

describe('Segmented', () => {
  it('is a radio group: roving tab stop, arrows select and skip disabled options', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Choices onChange={onChange} />);

    const group = screen.getByRole('radiogroup', { name: 'Letters' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'A' }).tabIndex).toBe(-1);

    await user.tab();
    expect(screen.getByRole('radio', { name: 'B' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'D' })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('d');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'A' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'D' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'C' })).toBeDisabled();
  });
});

describe('TextField', () => {
  it('commits trimmed text on Enter, ignores unchanged text and never commits invalid text', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <TextField
        label="Name"
        value="kept"
        debounceMs={0}
        validate={(value) => (value.includes('!') ? 'No exclamation marks.' : null)}
        onCommit={onCommit}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });

    await user.click(input);
    await user.keyboard('{Enter}');
    expect(onCommit).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '  new!  {Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('No exclamation marks.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onCommit).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '  fine  {Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('fine');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('follows the value prop while idle but never overwrites what is being typed', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TextField label="Name" value="one" onCommit={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Name' });
    rerender(<TextField label="Name" value="two" onCommit={vi.fn()} />);
    expect(input).toHaveValue('two');

    await user.click(input);
    await user.type(input, 'x');
    rerender(<TextField label="Name" value="three" onCommit={vi.fn()} />);
    expect(input).toHaveValue('twox');
  });
});

describe('SliderField', () => {
  it('commits on release, key up or blur, never while dragging', () => {
    const onCommit = vi.fn();
    render(
      <SliderField
        label="Speed"
        value={1}
        min={0.5}
        max={2}
        step={0.1}
        onCommit={onCommit}
        format={(v) => `${v}x`}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Speed' });

    fireEvent.change(slider, { target: { value: '1.2' } });
    fireEvent.change(slider, { target: { value: '1.4' } });
    expect(screen.getByText('1.4x')).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.keyUp(slider);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(1.4);
  });
});

describe('SelectField', () => {
  it('reports changes, and a read-only select is focusable, labelled and inert', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <SelectField
        label="Pick"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />,
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Pick' }), 'b');
    expect(onChange).toHaveBeenCalledWith('b');

    onChange.mockClear();
    rerender(
      <SelectField
        readOnly
        label="Pick"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Pick' });
    expect(select).toHaveAttribute('aria-disabled', 'true');
    expect(select).toBeEnabled();
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('rows, groups and small primitives', () => {
  it('a row links its description to the controls it contains', () => {
    render(
      <MotionConfig reducedMotion="always">
        <SettingsGroup title="Group">
          <SettingRow label="Row" description="Helpful words">
            <SelectField
              label="Row"
              value="a"
              onChange={vi.fn()}
              options={[{ value: 'a', label: 'A' }]}
            />
          </SettingRow>
          <ToggleRow label="Switch" checked onChange={vi.fn()} />
        </SettingsGroup>
      </MotionConfig>,
    );
    const description = screen.getByText('Helpful words');
    expect(screen.getByRole('combobox', { name: 'Row' })).toHaveAttribute(
      'aria-describedby',
      description.id,
    );
    expect(screen.getByRole('group', { name: 'Group' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Switch' })).toBeChecked();
  });

  it('KeyCombo draws one cap per key, with an optional pending placeholder', () => {
    const { container, rerender } = render(<KeyCombo accelerator="Ctrl+Shift+Space" />);
    expect(container.querySelectorAll('kbd')).toHaveLength(3);
    expect(screen.getByText('Space')).toBeInTheDocument();
    rerender(<KeyCombo keys={['Alt']} pending />);
    expect(container.querySelectorAll('kbd')).toHaveLength(2);
  });

  it('StatusPill pairs colour with an icon and text', () => {
    const { container } = render(<StatusPill tone="success">Registered</StatusPill>);
    expect(screen.getByText('Registered')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(render(<StatusPill>Off</StatusPill>).container.querySelector('svg')).toBeNull();
  });

  it('LevelMeter lights segments from the level ref only while active', async () => {
    const levelRef = { current: 0.5 };
    const { rerender } = render(<LevelMeter levelRef={levelRef} active label="Level" />);
    const meter = screen.getByRole('img', { name: 'Level' });
    const lit = () =>
      [...meter.children].filter((cell) => Number((cell as HTMLElement).style.opacity) > 0.9)
        .length;

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(lit()).toBeGreaterThan(5);
    expect(lit()).toBeLessThan(20);

    rerender(<LevelMeter levelRef={levelRef} active={false} label="Level" />);
    expect(lit()).toBe(0);
  });
});
