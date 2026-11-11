import type { Dispatch } from 'react';
import type { IconName } from '@renderer/components/Icon';
import { ASPECT_PRESETS, type AspectPreset } from './edit/crop';
import {
  canRedoEdit,
  canUndoEdit,
  hasChanges,
  STROKE_WIDTHS,
  SWATCHES,
  type EditorAction,
  type EditorState,
} from './edit/editor';
import type { EditTool } from './edit/types';
import { ToolButton } from './ui';

const TOOLS: ReadonlyArray<{ tool: EditTool; label: string; icon: IconName }> = [
  { tool: 'crop', label: 'Crop', icon: 'crop' },
  { tool: 'pen', label: 'Pen', icon: 'pen' },
  { tool: 'highlighter', label: 'Highlighter', icon: 'highlighter' },
  { tool: 'arrow', label: 'Arrow', icon: 'arrow' },
  { tool: 'rect', label: 'Rectangle', icon: 'rect' },
  { tool: 'ellipse', label: 'Ellipse', icon: 'ellipse' },
  { tool: 'text', label: 'Text', icon: 'text' },
  { tool: 'blur', label: 'Blur or pixelate', icon: 'pixelate' },
  { tool: 'eraser', label: 'Eraser', icon: 'eraser' },
];

const SWATCH_NAMES: Record<(typeof SWATCHES)[number], string> = {
  '#FFB300': 'Honey',
  '#FF5A5F': 'Coral',
  '#7C4DFF': 'Violet',
  '#00BCD4': 'Cyan',
  '#000000': 'Black',
  '#FFFFFF': 'White',
};

const ASPECT_LABELS: Record<AspectPreset, string> = {
  free: 'Free',
  '1:1': '1:1',
  '16:9': '16:9',
  '4:3': '4:3',
};

export interface EditorToolsProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  /** Native size of the picture (the crop presets need it). */
  size: { width: number; height: number };
}

function Segment<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center rounded-full bg-sunken p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          className={`h-7 rounded-full px-3 text-[12.5px] font-semibold transition-colors duration-[var(--bk-dur-fast)] ${
            option.id === value ? 'bg-accent text-accent-contrast' : 'text-fg-muted hover:text-fg'
          }`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The tool row and the colour / width / mode row above the picture while editing. */
export function EditorTools({ state, dispatch, size }: EditorToolsProps) {
  const cropping = state.tool === 'crop';
  return (
    <div className="flex flex-col items-center gap-2" data-testid="editor-tools">
      <div
        role="toolbar"
        aria-label="Editing tools"
        className="bk-glass flex items-center gap-0.5 rounded-full p-1"
      >
        {TOOLS.map(({ tool, label, icon }) => (
          <ToolButton
            key={tool}
            icon={icon}
            label={label}
            size="md"
            pressed={state.tool === tool}
            testId={`tool-${tool}`}
            onClick={() => dispatch({ type: 'tool', tool })}
          />
        ))}
      </div>
      <div className="bk-glass flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 rounded-[22px] px-4 py-1.5">
        {cropping ? (
          <Segment
            label="Crop shape"
            value={state.aspect}
            options={ASPECT_PRESETS.map((id) => ({ id, label: ASPECT_LABELS[id] }))}
            onChange={(preset) => dispatch({ type: 'aspect', preset, size })}
          />
        ) : (
          <>
            <div role="group" aria-label="Colour" className="flex items-center gap-1.5">
              {SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={SWATCH_NAMES[color]}
                  aria-pressed={state.style.color === color}
                  data-testid={`swatch-${color.slice(1).toLowerCase()}`}
                  className={`h-6 w-6 rounded-full border transition-transform duration-[var(--bk-dur-fast)] ${
                    state.style.color === color
                      ? 'scale-110 border-fg ring-2 ring-accent'
                      : 'border-line hover:scale-105'
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => dispatch({ type: 'color', color })}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-[12.5px] font-medium text-fg-muted">
              Size
              <input
                type="range"
                min={STROKE_WIDTHS.min}
                max={STROKE_WIDTHS.max}
                value={state.style.width}
                aria-label="Stroke width"
                className="w-28 accent-[var(--bk-accent)]"
                onChange={(event) => dispatch({ type: 'width', width: Number(event.target.value) })}
              />
            </label>
            {state.tool === 'blur' ? (
              <Segment
                label="Blur style"
                value={state.blurMode}
                options={[
                  { id: 'pixelate', label: 'Pixelate' },
                  { id: 'blur', label: 'Blur' },
                ]}
                onChange={(mode) => dispatch({ type: 'blurMode', mode })}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export interface EditorFooterProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  confirming: boolean;
  busy: boolean;
  onCancel: () => void;
  onKeepEditing: () => void;
  onDiscard: () => void;
  onDone: () => void;
}

/** Undo, redo, reset and Cancel / Done under the picture while editing. */
export function EditorFooter({
  state,
  dispatch,
  confirming,
  busy,
  onCancel,
  onKeepEditing,
  onDiscard,
  onDone,
}: EditorFooterProps) {
  if (confirming) {
    return (
      <div
        role="alertdialog"
        aria-label="Discard changes"
        className="bk-glass flex items-center gap-3 rounded-full py-1.5 pr-1.5 pl-5"
      >
        <p className="text-[14px] font-semibold">Discard your changes?</p>
        <button
          type="button"
          className="h-9 rounded-full px-4 text-[13px] font-semibold text-fg hover:bg-raised-hover"
          onClick={onKeepEditing}
        >
          Keep editing
        </button>
        <button
          type="button"
          data-testid="editor-discard"
          className="h-9 rounded-full bg-danger px-4 text-[13px] font-semibold text-danger-contrast"
          onClick={onDiscard}
        >
          Discard
        </button>
      </div>
    );
  }
  return (
    <div
      className="bk-glass flex items-center gap-1 rounded-full p-1.5"
      data-testid="editor-footer"
    >
      <ToolButton
        icon="undo"
        label="Undo"
        shortcut="Ctrl+Z"
        size="md"
        tipSide="top"
        disabled={!canUndoEdit(state)}
        testId="editor-undo"
        onClick={() => dispatch({ type: 'undo' })}
      />
      <ToolButton
        icon="redo"
        label="Redo"
        shortcut="Ctrl+Y"
        size="md"
        tipSide="top"
        disabled={!canRedoEdit(state)}
        testId="editor-redo"
        onClick={() => dispatch({ type: 'redo' })}
      />
      <ToolButton
        icon="refresh"
        label="Reset"
        size="md"
        tipSide="top"
        disabled={!hasChanges(state)}
        testId="editor-reset"
        onClick={() => dispatch({ type: 'reset' })}
      />
      <span aria-hidden className="mx-1.5 h-6 w-px bg-line" />
      <button
        type="button"
        data-testid="editor-cancel"
        className="h-10 rounded-full px-4 text-[14px] font-semibold text-fg hover:bg-raised-hover"
        onClick={onCancel}
      >
        Cancel
      </button>
      <button
        type="button"
        data-testid="editor-done"
        disabled={busy}
        aria-busy={busy || undefined}
        className="h-10 rounded-full bg-accent px-5 text-[14px] font-semibold text-accent-contrast shadow-soft hover:brightness-105 disabled:opacity-60"
        onClick={onDone}
      >
        {busy ? 'Applying…' : 'Done'}
      </button>
    </div>
  );
}
