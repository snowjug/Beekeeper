import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { disposeControllers, makeInfo, renderPin, tick, type Harness } from './support';

/** The window's position on the screen, which the page reads when a drag begins. */
function placeWindow(x: number, y: number): void {
  Object.defineProperty(window, 'screenX', { configurable: true, value: x });
  Object.defineProperty(window, 'screenY', { configurable: true, value: y });
}

/** Releases the animation frame the page asked for, and lets the answers arrive. */
async function nextFrame(harness: Harness): Promise<void> {
  await act(async () => {
    harness.frames.flush();
    await tick();
  });
}

const root = (): HTMLElement => screen.getByTestId('pin-root');
const button = (name: string): HTMLElement => screen.getByRole('button', { name });

afterEach(() => {
  disposeControllers();
  placeWindow(0, 0);
});

describe('the pinned picture', () => {
  it('fills the window and describes itself', async () => {
    await renderPin();
    const image = screen.getByRole('img', { name: 'Pinned screenshot, 1920 by 1080 pixels' });
    expect(image).toHaveAttribute('src', 'beekeeper://app/capture/pin-1.png');
    expect(image).toHaveAttribute('draggable', 'false');
    expect(screen.getByRole('group', { name: 'Pinned screenshot' })).toBe(root());
  });

  it('offers copy, save, opacity, click-through and close', async () => {
    await renderPin();
    const bar = screen.getByRole('group', { name: 'Pinned screenshot controls' });
    for (const name of ['Copy image', 'Save image', 'Let clicks pass through', 'Close pin']) {
      expect(bar).toContainElement(button(name));
    }
    expect(screen.getByRole('slider', { name: 'Opacity' })).toHaveValue('100');
  });

  it('says so when the window is not a known pin', async () => {
    await renderPin({ info: null });
    expect(screen.getByTestId('pin-missing')).toHaveTextContent('no longer available');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows a note when the picture cannot be loaded', async () => {
    await renderPin();
    fireEvent.error(screen.getByTestId('pin-image'));
    expect(await screen.findByTestId('pin-image-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('pin-image')).toBeNull();
  });

  it('follows the updates of the main process', async () => {
    const harness = await renderPin();
    act(() => harness.emit('pin:update', makeInfo({ opacity: 0.6 })));
    const slider = screen.getByRole('slider', { name: 'Opacity' });
    expect(slider).toHaveValue('60');
    expect(slider).toHaveAttribute('aria-valuetext', '60%');
  });
});

describe('the control bar', () => {
  it('copies and confirms with a check and a screen-reader message', async () => {
    const harness = await renderPin();
    await harness.user.click(button('Copy image'));
    expect(harness.actions()).toEqual([{ type: 'copy' }]);
    expect(button('Copy image')).toHaveAttribute('data-status', 'done');
    expect(screen.getByRole('status')).toHaveTextContent('Copied to clipboard');
  });

  it('saves and confirms', async () => {
    const harness = await renderPin();
    await harness.user.click(button('Save image'));
    expect(harness.actions()).toEqual([{ type: 'save' }]);
    expect(screen.getByRole('status')).toHaveTextContent('Saved to your screenshots folder');
  });

  it('shows when a copy fails', async () => {
    const harness = await renderPin({
      handlers: {
        'pin:action': () => {
          throw new Error('clipboard is locked');
        },
      },
    });
    await harness.user.click(button('Copy image'));
    expect(button('Copy image')).toHaveAttribute('data-status', 'error');
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy the image');
  });

  it('closes the pin', async () => {
    const harness = await renderPin();
    await harness.user.click(button('Close pin'));
    expect(harness.actions()).toEqual([{ type: 'close' }]);
  });

  it('sets the opacity from the slider, once per frame', async () => {
    const harness = await renderPin();
    const slider = screen.getByRole('slider', { name: 'Opacity' });
    fireEvent.change(slider, { target: { value: '70' } });
    fireEvent.change(slider, { target: { value: '50' } });
    expect(slider).toHaveAttribute('aria-valuetext', '50%');
    await nextFrame(harness);
    expect(harness.actions()).toEqual([{ type: 'opacity', value: 0.5 }]);
  });
});

describe('click-through', () => {
  it('swaps the bar for a lock that gives the clicks back', async () => {
    const harness = await renderPin();
    await harness.user.click(button('Let clicks pass through'));
    expect(harness.actions()).toEqual([{ type: 'clickThrough', value: true }]);
    expect(screen.queryByTestId('pin-bar')).toBeNull();
    expect(root()).toHaveAttribute('data-click-through', 'true');

    await harness.user.click(screen.getByTestId('pin-unlock'));
    expect(harness.actions().at(-1)).toEqual({ type: 'clickThrough', value: false });
    expect(screen.getByTestId('pin-bar')).toBeInTheDocument();
  });

  it('receives clicks only while the pointer is over the lock', async () => {
    const harness = await renderPin({ info: makeInfo({ clickThrough: true }) });
    const lock = screen.getByRole('button', { name: 'Turn off click-through' });
    await harness.user.hover(lock);
    await harness.user.unhover(lock);
    expect(harness.actions()).toEqual([
      { type: 'interactive', value: true },
      { type: 'interactive', value: false },
    ]);
  });
});

describe('the wheel', () => {
  it('zooms around the pointer and keeps the page from scrolling', async () => {
    const harness = await renderPin();
    const untouched = fireEvent.wheel(root(), { deltaY: -100, clientX: 40, clientY: 30 });
    expect(untouched).toBe(false);
    await nextFrame(harness);
    const [action, ...others] = harness.actions();
    expect(others).toEqual([]);
    expect(action).toMatchObject({ type: 'scale', anchor: { x: 40, y: 30 } });
    expect(action?.['value']).toBeCloseTo(0.4 * Math.exp(0.15), 6);
  });

  it('changes the opacity instead of the zoom with Ctrl', async () => {
    const harness = await renderPin();
    fireEvent.wheel(root(), { deltaY: 100, ctrlKey: true, clientX: 5, clientY: 5 });
    await nextFrame(harness);
    expect(harness.actions()).toEqual([{ type: 'opacity', value: 0.95 }]);
  });
});

describe('dragging', () => {
  it('moves the window by how far the pointer travelled on the screen', async () => {
    placeWindow(100, 200);
    const harness = await renderPin();
    fireEvent.pointerDown(root(), { pointerId: 1, button: 0, screenX: 500, screenY: 500 });
    fireEvent.pointerMove(root(), { pointerId: 1, screenX: 502, screenY: 501 });
    await nextFrame(harness);
    expect(harness.actions()).toEqual([]);

    fireEvent.pointerMove(root(), { pointerId: 1, screenX: 520, screenY: 490 });
    expect(root()).toHaveAttribute('data-dragging', 'true');
    await nextFrame(harness);
    expect(harness.actions()).toEqual([{ type: 'move', x: 120, y: 190 }]);

    fireEvent.pointerUp(root(), { pointerId: 1 });
    expect(root()).toHaveAttribute('data-dragging', 'false');
    fireEvent.pointerMove(root(), { pointerId: 1, screenX: 600, screenY: 600 });
    await nextFrame(harness);
    expect(harness.actions()).toHaveLength(1);
  });

  it('only follows the primary button and never starts on a control', async () => {
    const harness = await renderPin();
    fireEvent.pointerDown(root(), { pointerId: 1, button: 2, screenX: 10, screenY: 10 });
    fireEvent.pointerMove(root(), { pointerId: 1, screenX: 90, screenY: 90 });
    fireEvent.pointerUp(root(), { pointerId: 1 });
    fireEvent.pointerDown(button('Copy image'), {
      pointerId: 2,
      button: 0,
      screenX: 10,
      screenY: 10,
    });
    fireEvent.pointerMove(root(), { pointerId: 2, screenX: 90, screenY: 90 });
    await nextFrame(harness);
    expect(harness.actions()).toEqual([]);
  });

  it('ends the drag when the pointer is cancelled', async () => {
    const harness = await renderPin();
    fireEvent.pointerDown(root(), { pointerId: 1, button: 0, screenX: 10, screenY: 10 });
    fireEvent.pointerMove(root(), { pointerId: 1, screenX: 40, screenY: 10 });
    fireEvent.pointerCancel(root(), { pointerId: 1 });
    expect(root()).toHaveAttribute('data-dragging', 'false');
    await nextFrame(harness);
    fireEvent.pointerMove(root(), { pointerId: 1, screenX: 99, screenY: 10 });
    await nextFrame(harness);
    expect(harness.actions()).toHaveLength(1);
  });
});

describe('double-click and right-click', () => {
  it('closes the pin on a double-click of the picture', async () => {
    const harness = await renderPin();
    fireEvent.doubleClick(screen.getByTestId('pin-image'));
    expect(harness.actions()).toEqual([{ type: 'close' }]);
  });

  it('does not close on a double-click of a control', async () => {
    const harness = await renderPin();
    fireEvent.doubleClick(screen.getByRole('slider', { name: 'Opacity' }));
    expect(harness.actions()).toEqual([]);
  });

  it('opens the native menu instead of the browser menu', async () => {
    const harness = await renderPin();
    const untouched = fireEvent.contextMenu(screen.getByTestId('pin-image'));
    expect(untouched).toBe(false);
    expect(harness.actions()).toEqual([{ type: 'menu' }]);
  });
});

describe('the keyboard', () => {
  it('closes with Escape', async () => {
    const harness = await renderPin();
    await harness.user.keyboard('{Escape}');
    expect(harness.actions()).toEqual([{ type: 'close' }]);
  });

  it('copies with Ctrl+C and saves with Ctrl+S', async () => {
    const harness = await renderPin();
    await harness.user.keyboard('{Control>}c{/Control}');
    await harness.user.keyboard('{Control>}s{/Control}');
    expect(harness.actions()).toEqual([{ type: 'copy' }, { type: 'save' }]);
  });

  it('zooms with + and -, and goes back to 100 % with 0', async () => {
    const harness = await renderPin();
    await harness.user.keyboard('+');
    await nextFrame(harness);
    expect(harness.actions()).toHaveLength(1);
    expect(harness.actions()[0]).toMatchObject({ type: 'scale' });
    expect(harness.actions()[0]?.['value']).toBeCloseTo(0.5, 10);
    await harness.user.keyboard('-');
    await nextFrame(harness);
    expect(harness.actions()[1]).toMatchObject({ type: 'scale' });
    expect(harness.actions()[1]?.['value']).toBeCloseTo(0.4, 10);
    await harness.user.keyboard('0');
    expect(harness.actions().at(-1)).toEqual({ type: 'resetScale' });
  });

  it('moves with the arrow keys, further with Shift', async () => {
    placeWindow(100, 200);
    const harness = await renderPin();
    await harness.user.keyboard('{ArrowRight}');
    await nextFrame(harness);
    await harness.user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await nextFrame(harness);
    expect(harness.actions()).toEqual([
      { type: 'move', x: 110, y: 200 },
      { type: 'move', x: 100, y: 250 },
    ]);
  });

  it('leaves the arrow keys to the slider and the buttons', async () => {
    const harness = await renderPin();
    screen.getByRole('slider', { name: 'Opacity' }).focus();
    await harness.user.keyboard('{ArrowRight}');
    button('Copy image').focus();
    await harness.user.keyboard('{ArrowLeft}');
    await nextFrame(harness);
    expect(harness.actions()).toEqual([]);
  });

  it('stops listening when the page goes away', async () => {
    const harness = await renderPin();
    harness.unmount();
    await harness.user.keyboard('{Escape}');
    expect(harness.actions()).toEqual([]);
  });
});
