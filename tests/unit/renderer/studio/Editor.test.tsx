import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@renderer/components/Toast';
import type { EditState } from '@renderer/studio/edit/types';
import { EDITED_BYTES, gate, renderStudio } from './support';

type Studio = Awaited<ReturnType<typeof renderStudio>>;

afterEach(() => {
  vi.restoreAllMocks();
  act(() => useToastStore.getState().clear());
});

async function openEditor(): Promise<Studio> {
  const studio = await renderStudio();
  await studio.user.click(screen.getByRole('button', { name: 'Edit' }));
  await screen.findByTestId('editor-stage');
  return studio;
}

const surface = (): HTMLElement => screen.getByTestId('editor-surface');
const byName = (name: string): HTMLElement => screen.getByRole('button', { name });

/** The picture as shown (CSS pixels): the editor maps pointer positions onto it. */
function shownSize(): { width: number; height: number } {
  const frame = screen.getByTestId('studio-frame');
  return {
    width: Number.parseFloat(frame.style.width),
    height: Number.parseFloat(frame.style.height),
  };
}

type Gesture = Array<[number, number]>;

/** Presses at the first point, moves through the others and lets go. */
function drag(points: Gesture, init: { shiftKey?: boolean } = {}): void {
  const [first, ...rest] = points;
  if (!first) return;
  fireEvent.pointerDown(surface(), {
    pointerId: 1,
    button: 0,
    clientX: first[0],
    clientY: first[1],
    ...init,
  });
  for (const [x, y] of rest) {
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: x, clientY: y, ...init });
  }
  fireEvent.pointerUp(surface(), { pointerId: 1 });
}

const RECTANGLE: Gesture = [
  [40, 40],
  [120, 80],
  [200, 120],
];

/** Draws one rectangle with the rectangle tool. */
async function drawRectangle(studio: Studio): Promise<void> {
  await studio.user.click(byName('Rectangle'));
  drag(RECTANGLE);
}

/** Presses Done and returns what the editor handed to the flattener. */
async function applied(studio: Studio): Promise<EditState> {
  await studio.user.click(screen.getByTestId('editor-done'));
  const call = studio.flatten.mock.calls.at(-1);
  if (!call) throw new Error('The picture was not flattened');
  return call[2];
}

describe('the editing screen', () => {
  it('shows the tools, the picture and the footer in place of the preview', async () => {
    await openEditor();
    expect(screen.queryByTestId('studio-stage')).toBeNull();
    const tools = screen.getByRole('toolbar', { name: 'Editing tools' });
    expect(
      within(tools)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Crop',
      'Pen',
      'Highlighter',
      'Arrow',
      'Rectangle',
      'Ellipse',
      'Text',
      'Blur or pixelate',
      'Eraser',
    ]);
    expect(byName('Pen')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'The screenshot you are editing' })).toBeInTheDocument();
    for (const name of ['Undo', 'Redo', 'Reset']) expect(byName(name)).toBeDisabled();
    expect(screen.getByTestId('editor-cancel')).toBeEnabled();
    expect(screen.getByTestId('editor-done')).toBeEnabled();
  });

  it('selects a tool, a colour and a stroke width', async () => {
    const studio = await openEditor();
    await studio.user.click(byName('Rectangle'));
    expect(byName('Rectangle')).toHaveAttribute('aria-pressed', 'true');
    expect(byName('Pen')).toHaveAttribute('aria-pressed', 'false');

    expect(byName('Coral')).toHaveAttribute('aria-pressed', 'true');
    await studio.user.click(byName('Violet'));
    expect(byName('Violet')).toHaveAttribute('aria-pressed', 'true');
    expect(byName('Coral')).toHaveAttribute('aria-pressed', 'false');

    const width = screen.getByRole('slider', { name: 'Stroke width' });
    fireEvent.change(width, { target: { value: '12' } });
    expect(width).toHaveValue('12');
  });

  it('offers the brand colours, black and white', async () => {
    await openEditor();
    const colours = within(screen.getByRole('group', { name: 'Colour' }));
    expect(
      colours.getAllByRole('button').map((swatch) => swatch.getAttribute('aria-label')),
    ).toEqual(['Honey', 'Coral', 'Violet', 'Cyan', 'Black', 'White']);
  });

  it('offers pixelate or blur only with the blur tool', async () => {
    const studio = await openEditor();
    expect(screen.queryByRole('group', { name: 'Blur style' })).toBeNull();
    await studio.user.click(byName('Blur or pixelate'));
    const style = within(screen.getByRole('group', { name: 'Blur style' }));
    expect(style.getByRole('button', { name: 'Pixelate' })).toHaveAttribute('aria-pressed', 'true');
    await studio.user.click(style.getByRole('button', { name: 'Blur' }));
    expect(style.getByRole('button', { name: 'Blur' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('drawing', () => {
  it.each([
    ['Pen', 'pen'],
    ['Highlighter', 'highlighter'],
    ['Arrow', 'arrow'],
    ['Rectangle', 'rect'],
    ['Ellipse', 'ellipse'],
    ['Blur or pixelate', 'blur'],
  ])('draws with the %s tool', async (label, kind) => {
    const studio = await openEditor();
    await studio.user.click(byName(label));
    drag(RECTANGLE);
    expect(byName('Undo')).toBeEnabled();
    const edit = await applied(studio);
    expect(edit.ops.map((op) => op.kind)).toEqual([kind]);
    expect(edit.crop).toBeNull();
  });

  it('draws in the chosen colour and keeps every shape in order', async () => {
    const studio = await openEditor();
    await studio.user.click(byName('Rectangle'));
    await studio.user.click(byName('Cyan'));
    drag(RECTANGLE);
    await studio.user.click(byName('Ellipse'));
    await studio.user.click(byName('Honey'));
    drag(RECTANGLE);
    const edit = await applied(studio);
    expect(edit.ops.map((op) => [op.kind, 'color' in op ? op.color : null])).toEqual([
      ['rect', '#00BCD4'],
      ['ellipse', '#FFB300'],
    ]);
    expect(studio.flatten.mock.calls.at(-1)?.[1]).toEqual({ width: 1920, height: 1080 });
  });

  it('turns the shown size into picture pixels', async () => {
    const studio = await openEditor();
    await studio.user.click(byName('Rectangle'));
    const shown = shownSize();
    drag([
      [shown.width / 4, shown.height / 4],
      [shown.width / 2, shown.height / 2],
    ]);
    const [op] = (await applied(studio)).ops;
    expect(op?.kind).toBe('rect');
    if (op?.kind !== 'rect') return;
    expect(op.rect.x).toBeCloseTo(480, 3);
    expect(op.rect.y).toBeCloseTo(270, 3);
    expect(op.rect.width).toBeCloseTo(480, 3);
    expect(op.rect.height).toBeCloseTo(270, 3);
  });

  it('makes a square of a rectangle while Shift is held', async () => {
    const studio = await openEditor();
    await studio.user.click(byName('Rectangle'));
    drag(
      [
        [40, 40],
        [240, 100],
      ],
      { shiftKey: true },
    );
    const [op] = (await applied(studio)).ops;
    if (op?.kind !== 'rect') throw new Error('No rectangle was drawn');
    expect(op.rect.width).toBeCloseTo(op.rect.height, 6);
  });

  it('does not add a shape for a plain click', async () => {
    const studio = await openEditor();
    await studio.user.click(byName('Rectangle'));
    drag([[60, 60]]);
    expect(byName('Undo')).toBeDisabled();
  });

  it('only draws with the primary button', async () => {
    const studio = await openEditor();
    await studio.user.click(byName('Rectangle'));
    fireEvent.pointerDown(surface(), { pointerId: 1, button: 2, clientX: 40, clientY: 40 });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 200, clientY: 120 });
    fireEvent.pointerUp(surface(), { pointerId: 1 });
    expect(byName('Undo')).toBeDisabled();
  });

  it('drops a shape when the pointer is cancelled', async () => {
    const studio = await openEditor();
    await studio.user.click(byName('Rectangle'));
    fireEvent.pointerDown(surface(), { pointerId: 1, button: 0, clientX: 40, clientY: 40 });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 200, clientY: 120 });
    fireEvent.pointerCancel(surface(), { pointerId: 1 });
    expect(byName('Undo')).toBeDisabled();
  });
});

describe('text', () => {
  const field = (): HTMLElement => screen.getByRole('textbox', { name: 'Text to add' });

  async function openField(studio: Studio): Promise<void> {
    await studio.user.click(byName('Text'));
    fireEvent.pointerDown(surface(), { pointerId: 1, button: 0, clientX: 100, clientY: 80 });
    expect(field()).toHaveFocus();
  }

  it('writes where the picture is clicked and keeps the text on Enter', async () => {
    const studio = await openEditor();
    await openField(studio);
    await studio.user.type(field(), 'Hello{Enter}');
    expect(screen.queryByRole('textbox', { name: 'Text to add' })).toBeNull();
    const [op] = (await applied(studio)).ops;
    if (op?.kind !== 'text') throw new Error('No text was added');
    expect(op.text).toBe('Hello');
    expect(op.color).toBe('#FF5A5F');
  });

  it('keeps the text when the field loses the focus', async () => {
    const studio = await openEditor();
    await openField(studio);
    await studio.user.type(field(), 'Later');
    fireEvent.blur(field());
    expect(byName('Undo')).toBeEnabled();
  });

  it('adds a new line with Shift+Enter', async () => {
    const studio = await openEditor();
    await openField(studio);
    await studio.user.type(field(), 'one{Shift>}{Enter}{/Shift}two');
    fireEvent.blur(field());
    const [op] = (await applied(studio)).ops;
    expect(op).toMatchObject({ kind: 'text', text: 'one\ntwo' });
  });

  it('drops the text on Escape and stays in the editor', async () => {
    const studio = await openEditor();
    await openField(studio);
    await studio.user.type(field(), 'never mind');
    await studio.user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Text to add' })).toBeNull();
    expect(screen.getByTestId('editor-stage')).toBeInTheDocument();
    expect(byName('Undo')).toBeDisabled();
  });

  it('ignores a field that stays empty', async () => {
    const studio = await openEditor();
    await openField(studio);
    await studio.user.keyboard('{Enter}');
    expect(byName('Undo')).toBeDisabled();
  });
});

describe('the eraser', () => {
  it('removes the shape that is clicked, and undo brings it back', async () => {
    const studio = await openEditor();
    await drawRectangle(studio);
    expect(byName('Reset')).toBeEnabled();
    await studio.user.click(byName('Eraser'));
    // The rectangle's left edge.
    fireEvent.pointerDown(surface(), { pointerId: 1, button: 0, clientX: 40, clientY: 60 });
    fireEvent.pointerUp(surface(), { pointerId: 1 });
    expect(byName('Reset')).toBeDisabled();
    await studio.user.click(byName('Undo'));
    expect(byName('Reset')).toBeEnabled();
  });

  it('leaves the picture alone when nothing is under the pointer', async () => {
    const studio = await openEditor();
    await drawRectangle(studio);
    await studio.user.click(byName('Eraser'));
    fireEvent.pointerDown(surface(), { pointerId: 1, button: 0, clientX: 700, clientY: 400 });
    fireEvent.pointerUp(surface(), { pointerId: 1 });
    expect(byName('Reset')).toBeEnabled();
  });
});

describe('undo, redo and reset', () => {
  it('undoes and redoes with the buttons', async () => {
    const studio = await openEditor();
    await drawRectangle(studio);
    expect(byName('Undo')).toBeEnabled();
    expect(byName('Redo')).toBeDisabled();
    await studio.user.click(byName('Undo'));
    expect(byName('Undo')).toBeDisabled();
    expect(byName('Redo')).toBeEnabled();
    await studio.user.click(byName('Redo'));
    expect(byName('Undo')).toBeEnabled();
    expect(byName('Redo')).toBeDisabled();
  });

  it('undoes and redoes from the keyboard', async () => {
    const studio = await openEditor();
    await drawRectangle(studio);
    await studio.user.keyboard('{Control>}z{/Control}');
    expect(byName('Redo')).toBeEnabled();
    await studio.user.keyboard('{Control>}y{/Control}');
    expect(byName('Redo')).toBeDisabled();
    expect(byName('Undo')).toBeEnabled();
    await studio.user.keyboard('{Control>}z{/Control}');
    await studio.user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(byName('Undo')).toBeEnabled();
    expect(byName('Redo')).toBeDisabled();
  });

  it('keeps Ctrl+Z for the text field while the user types', async () => {
    const studio = await openEditor();
    await drawRectangle(studio);
    await studio.user.click(byName('Text'));
    fireEvent.pointerDown(surface(), { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    await studio.user.type(screen.getByRole('textbox', { name: 'Text to add' }), 'abc');
    await studio.user.keyboard('{Control>}z{/Control}');
    expect(byName('Undo')).toBeEnabled();
    expect(byName('Redo')).toBeDisabled();
  });

  it('resets every change in one step that can itself be undone', async () => {
    const studio = await openEditor();
    await drawRectangle(studio);
    await studio.user.click(byName('Reset'));
    expect(byName('Reset')).toBeDisabled();
    expect(byName('Undo')).toBeEnabled();
    await studio.user.click(byName('Undo'));
    expect(byName('Reset')).toBeEnabled();
  });
});

describe('cropping', () => {
  const overlay = (): HTMLElement => screen.getByTestId('crop-overlay');

  async function openCrop(): Promise<Studio> {
    const studio = await openEditor();
    await studio.user.click(byName('Crop'));
    return studio;
  }

  it('shows the whole picture with its size, handles and shape presets', async () => {
    await openCrop();
    expect(overlay()).toHaveTextContent('1920 × 1080');
    expect(overlay().querySelectorAll('rect')).toHaveLength(1);
    expect(screen.getByTestId('crop-handles').querySelectorAll('rect')).toHaveLength(8);
    expect(overlay().querySelectorAll('line')).toHaveLength(4);
    const presets = within(screen.getByRole('group', { name: 'Crop shape' }));
    expect(presets.getAllByRole('button').map((preset) => preset.textContent)).toEqual([
      'Free',
      '1:1',
      '16:9',
      '4:3',
    ]);
    expect(presets.getByRole('button', { name: 'Free' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('group', { name: 'Colour' })).toBeNull();
  });

  it.each([
    ['1:1', '1080 × 1080'],
    ['4:3', '1440 × 1080'],
    ['16:9', '1920 × 1080'],
  ])('crops to %s', async (preset, size) => {
    const studio = await openCrop();
    await studio.user.click(byName(preset));
    expect(overlay()).toHaveTextContent(size);
    expect(byName(preset)).toHaveAttribute('aria-pressed', 'true');
  });

  it('drags a corner to cut the picture, and hands the crop to the flattener', async () => {
    const studio = await openCrop();
    const shown = shownSize();
    drag([
      [shown.width, shown.height],
      [shown.width / 2, shown.height / 2],
    ]);
    expect(overlay()).toHaveTextContent('960 × 540');
    expect(byName('Undo')).toBeEnabled();
    expect((await applied(studio)).crop).toEqual({ x: 0, y: 0, width: 960, height: 540 });
  });

  it('keeps the shape of a preset while a corner is dragged', async () => {
    const studio = await openCrop();
    await studio.user.click(byName('1:1'));
    const shown = shownSize();
    // The bottom-right corner of the 1080 × 1080 square.
    const corner: [number, number] = [shown.width * (1500 / 1920), shown.height];
    drag([corner, [corner[0] - 100, corner[1] - 20]]);
    const crop = (await applied(studio)).crop;
    expect(crop?.width).toBe(crop?.height);
  });

  it('shows a resize cursor over a handle', async () => {
    await openCrop();
    const shown = shownSize();
    fireEvent.pointerMove(surface(), { clientX: shown.width, clientY: shown.height });
    expect(surface().style.cursor).toBe('nwse-resize');
    fireEvent.pointerMove(surface(), { clientX: shown.width / 2, clientY: shown.height / 2 });
    expect(surface().style.cursor).toBe('move');
  });

  it('ignores a press that misses the crop', async () => {
    const studio = await openCrop();
    await studio.user.click(byName('1:1'));
    fireEvent.pointerDown(surface(), { pointerId: 1, button: 0, clientX: 1, clientY: 1 });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(surface(), { pointerId: 1 });
    expect(overlay()).toHaveTextContent('1080 × 1080');
  });
});

describe('Done', () => {
  it('flattens the picture at its native size and returns to the preview', async () => {
    const studio = await openEditor();
    await drawRectangle(studio);
    const edit = await applied(studio);
    expect(edit.ops).toHaveLength(1);
    expect(studio.flatten).toHaveBeenCalledTimes(1);
    expect(studio.flatten.mock.calls[0]?.[1]).toEqual({ width: 1920, height: 1080 });
    expect(await screen.findByTestId('studio-stage')).toBeInTheDocument();
    expect(screen.getByTestId('studio-image')).toHaveAttribute('src', 'blob:edited-1');
  });

  it('sends the edited picture, not the capture, with the next action', async () => {
    const studio = await openEditor();
    await drawRectangle(studio);
    await applied(studio);
    await studio.user.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(studio.inputsOf('studio:copy')).toEqual([{ sessionId: 'session-1', png: EDITED_BYTES }]);
  });

  it('shows that it is working and cannot be pressed twice', async () => {
    const studio = await openEditor();
    await drawRectangle(studio);
    const hold = gate();
    studio.flatten.mockImplementationOnce(async () => {
      await hold.promise;
      return EDITED_BYTES;
    });
    await studio.user.click(screen.getByTestId('editor-done'));
    const done = screen.getByTestId('editor-done');
    expect(done).toHaveTextContent('Applying…');
    expect(done).toBeDisabled();
    hold.open();
    expect(await screen.findByTestId('studio-stage')).toBeInTheDocument();
    expect(studio.flatten).toHaveBeenCalledTimes(1);
  });

  it('stays in the editor and says so when the picture cannot be flattened', async () => {
    const studio = await openEditor();
    await drawRectangle(studio);
    studio.flatten.mockRejectedValueOnce(new Error('out of memory'));
    await studio.user.click(screen.getByTestId('editor-done'));
    const notifications = within(screen.getByRole('region', { name: 'Notifications' }));
    expect(await notifications.findByText('Could not apply the changes')).toBeInTheDocument();
    expect(screen.getByTestId('editor-stage')).toBeInTheDocument();
    expect(byName('Undo')).toBeEnabled();
  });

  it('just leaves when there is nothing to apply', async () => {
    const studio = await openEditor();
    await studio.user.click(screen.getByTestId('editor-done'));
    expect(await screen.findByTestId('studio-stage')).toBeInTheDocument();
    expect(studio.flatten).not.toHaveBeenCalled();
  });
});

describe('Cancel and Esc', () => {
  it('leaves at once when nothing was changed', async () => {
    const studio = await openEditor();
    await studio.user.click(screen.getByTestId('editor-cancel'));
    expect(await screen.findByTestId('studio-stage')).toBeInTheDocument();
    expect(screen.queryByTestId('editor-stage')).toBeNull();
  });

  it('asks before throwing changes away', async () => {
    const studio = await openEditor();
    await drawRectangle(studio);
    await studio.user.click(screen.getByTestId('editor-cancel'));
    const question = screen.getByRole('alertdialog', { name: 'Discard changes' });
    expect(question).toHaveTextContent('Discard your changes?');

    await studio.user.click(within(question).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(byName('Undo')).toBeEnabled();

    await studio.user.click(screen.getByTestId('editor-cancel'));
    await studio.user.click(screen.getByTestId('editor-discard'));
    expect(await screen.findByTestId('studio-stage')).toBeInTheDocument();
    expect(studio.flatten).not.toHaveBeenCalled();
    expect(screen.getByTestId('studio-image')).toHaveAttribute(
      'src',
      'beekeeper://app/capture/session-1.png',
    );
  });

  it('treats Esc like Cancel and never closes the preview from the editor', async () => {
    const studio = await openEditor();
    await drawRectangle(studio);
    await studio.user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog', { name: 'Discard changes' })).toBeInTheDocument();
    await studio.user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('editor-stage')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Capture Studio' })).toBeInTheDocument();
    expect(studio.inputsOf('studio:close')).toEqual([]);
  });

  it('leaves the editor on Esc when nothing was changed, keeping the preview open', async () => {
    const studio = await openEditor();
    await studio.user.keyboard('{Escape}');
    expect(await screen.findByTestId('studio-stage')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Capture Studio' })).toBeInTheDocument();
    expect(studio.inputsOf('studio:close')).toEqual([]);
  });
});
