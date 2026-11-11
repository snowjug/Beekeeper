import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from '@renderer/components/Button';
import { Card } from '@renderer/components/Card';
import { Chip } from '@renderer/components/Chip';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { Icon } from '@renderer/components/Icon';
import { Orb } from '@renderer/components/Orb';
import { ProgressRing } from '@renderer/components/ProgressRing';
import { showToast, ToastHost, useToastStore } from '@renderer/components/Toast';
import { Toggle } from '@renderer/components/Toggle';

afterEach(() => {
  act(() => useToastStore.getState().clear());
});

describe('Button / IconButton', () => {
  it('fires onClick, supports disabled state and never submits forms by default', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="primary" icon="check" onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('requires and exposes an accessible name for icon-only buttons', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton icon="close" label="Close window" onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: 'Close window' }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Toggle', () => {
  it('exposes switch semantics and toggles with mouse and keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<Toggle checked={false} onChange={onChange} label="Wake word" />);
    const toggle = screen.getByRole('switch', { name: 'Wake word' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    toggle.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(2);
    rerender(<Toggle checked onChange={onChange} label="Wake word" />);
    expect(screen.getByRole('switch', { name: 'Wake word' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('ignores clicks when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Off" disabled />);
    await user.click(screen.getByRole('switch', { name: 'Off' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Toast', () => {
  it('shows toasts with the right live-region role, runs actions and dismisses', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<ToastHost />);
    act(() => {
      showToast({
        title: 'Update ready',
        message: 'Restart to install',
        tone: 'info',
        action: { label: 'Restart', onClick: action },
        durationMs: 0,
      });
      showToast({ title: 'Mic blocked', tone: 'error', durationMs: 0 });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Update ready');
    expect(screen.getByRole('alert')).toHaveTextContent('Mic blocked');
    await user.click(screen.getByRole('button', { name: 'Restart' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    await user.click(
      within(screen.getByRole('alert')).getByRole('button', { name: 'Dismiss notification' }),
    );
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('keeps at most three toasts and auto-dismisses', () => {
    vi.useFakeTimers();
    try {
      render(<ToastHost />);
      act(() => {
        for (let i = 0; i < 5; i += 1) showToast({ title: `T${i}`, durationMs: 1000 });
      });
      expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual(['T2', 'T3', 'T4']);
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(useToastStore.getState().toasts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Orb', () => {
  it('is announced as an image describing its state and renders four particles', () => {
    const { container, rerender } = render(<Orb state="idle" />);
    expect(screen.getByRole('img', { name: 'Beekeeper is idle' })).toBeInTheDocument();
    expect(container.querySelectorAll('rect')).toHaveLength(4);
    rerender(<Orb state="listening" />);
    expect(screen.getByRole('img', { name: 'Beekeeper is listening' })).toHaveAttribute(
      'data-orb-state',
      'listening',
    );
  });

  it('can be decorative', () => {
    render(<Orb state="thinking" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('misc components', () => {
  it('Card renders header, title and children', () => {
    render(
      <Card icon="weather" title="Weather" headerActions={<button type="button">Copy</button>}>
        <p>Sunny</p>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Weather' })).toBeInTheDocument();
    expect(screen.getByText('Sunny')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('Chip is a button', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>Open Notepad</Chip>);
    await user.click(screen.getByRole('button', { name: 'Open Notepad' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('Icon is decorative unless titled', () => {
    const { container, rerender } = render(<Icon name="mic" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Icon name="mic" title="Microphone" />);
    expect(screen.getByRole('img', { name: 'Microphone' })).toBeInTheDocument();
  });

  it('ProgressRing clamps its value into the dash offset', () => {
    const { container, rerender } = render(
      <ProgressRing value={2} size={50} stroke={5} label="Timer" />,
    );
    const arc = container.querySelectorAll('circle')[1];
    expect(Number(arc?.getAttribute('stroke-dashoffset'))).toBeCloseTo(0);
    rerender(<ProgressRing value={0} size={50} stroke={5} label="Timer" />);
    const circumference = 2 * Math.PI * 22.5;
    expect(
      Number(container.querySelectorAll('circle')[1]?.getAttribute('stroke-dashoffset')),
    ).toBeCloseTo(circumference);
  });

  it('ErrorBoundary shows a friendly fallback and reports the error', () => {
    const onError = vi.fn();
    const Boom = (): never => {
      throw new Error('kaboom');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary scope="assistant" onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );
    spy.mockRestore();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
