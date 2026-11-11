import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Point, Rect, Size } from '@shared/geometry';
import { useController, useStudio, useViewport } from './context';
import {
  aspectValue,
  dragCrop,
  fullCrop,
  hitCropHandle,
  thirdsGuides,
  type CropHandle,
} from './edit/crop';
import { paintEdit } from './edit/draw';
import { createEditor, currentEdit, editorReducer, hasChanges } from './edit/editor';
import { topOpAt } from './edit/hit';
import { thinStroke } from './edit/shapes';
import { shapeOp, strokeOp, textOp, toTextSize, type ShapeTool } from './edit/tools';
import type { EditOp, EditTool, NewOp } from './edit/types';
import { EditorFooter, EditorTools } from './EditorPanels';
import { FrameShell } from './FrameShell';
import { fitImage } from './layout';

const HANDLE_TOLERANCE_CSS = 14;
const ERASER_TOLERANCE_CSS = 8;
const STROKE_MIN_DISTANCE_CSS = 1.5;
const RESERVE_TOP = 176;
const RESERVE_BOTTOM = 100;

type Drag =
  | { kind: 'stroke'; tool: 'pen' | 'highlighter'; points: Point[] }
  | { kind: 'shape'; tool: ShapeTool; start: Point; end: Point; constrain: boolean }
  | { kind: 'erase' }
  | { kind: 'crop'; handle: CropHandle; start: Point; origin: Rect };

const CURSORS: Record<CropHandle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  move: 'move',
};

function isShapeTool(tool: EditTool): tool is ShapeTool {
  return tool === 'arrow' || tool === 'rect' || tool === 'ellipse' || tool === 'blur';
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'TEXTAREA' ||
      (target instanceof HTMLInputElement && target.type !== 'range'))
  );
}

interface CropOverlayProps {
  crop: Rect;
  view: Rect;
  cssScale: number;
  width: number;
  height: number;
}

/** Dims everything outside the crop and draws its border, thirds guides and size. */
function CropOverlay({ crop, view, cssScale, width, height }: CropOverlayProps) {
  const x = (crop.x - view.x) * cssScale;
  const y = (crop.y - view.y) * cssScale;
  const w = crop.width * cssScale;
  const h = crop.height * cssScale;
  const guides = thirdsGuides({ x, y, width: w, height: h });
  return (
    <svg
      aria-hidden
      data-testid="crop-overlay"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
    >
      <path
        d={`M0 0H${width}V${height}H0Z M${x} ${y}h${w}v${h}h${-w}Z`}
        fill="rgba(0,0,0,0.55)"
        fillRule="evenodd"
      />
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#fff" strokeWidth={1.5} />
      {guides.vertical.map((position) => (
        <line
          key={`v${position}`}
          x1={position}
          y1={y}
          x2={position}
          y2={y + h}
          stroke="rgba(255,255,255,0.55)"
          strokeWidth={1}
        />
      ))}
      {guides.horizontal.map((position) => (
        <line
          key={`h${position}`}
          x1={x}
          y1={position}
          x2={x + w}
          y2={position}
          stroke="rgba(255,255,255,0.55)"
          strokeWidth={1}
        />
      ))}
      <text
        x={x + 8}
        y={y + h - 8}
        fill="#fff"
        fontSize={12}
        fontWeight={600}
        style={{ paintOrder: 'stroke' }}
        stroke="rgba(0,0,0,0.6)"
        strokeWidth={3}
      >
        {Math.round(crop.width)} × {Math.round(crop.height)}
      </text>
    </svg>
  );
}

/** The eight handles, drawn outside the picture's rounded clip so the corner ones show too. */
function CropHandles({ crop, view, cssScale, width, height }: CropOverlayProps) {
  const x = (crop.x - view.x) * cssScale;
  const y = (crop.y - view.y) * cssScale;
  const w = crop.width * cssScale;
  const h = crop.height * cssScale;
  const handles: Array<[number, number]> = [
    [x, y],
    [x + w / 2, y],
    [x + w, y],
    [x, y + h / 2],
    [x + w, y + h / 2],
    [x, y + h],
    [x + w / 2, y + h],
    [x + w, y + h],
  ];
  return (
    <svg
      aria-hidden
      data-testid="crop-handles"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      viewBox={`0 0 ${width} ${height}`}
    >
      {handles.map(([cx, cy]) => (
        <rect
          key={`${cx}-${cy}`}
          x={cx - 5}
          y={cy - 5}
          width={10}
          height={10}
          rx={2}
          fill="#fff"
          stroke="rgba(0,0,0,0.45)"
        />
      ))}
    </svg>
  );
}

export interface EditorStageProps {
  image: HTMLImageElement;
  /** Native size of the picture. */
  size: Size;
}

/**
 * The editor: crop, draw, write and blur on a canvas, with undo / redo. All the maths lives in
 * ./edit/*; this component only turns pointer input into ops and paints them.
 */
export function EditorStage({ image, size }: EditorStageProps) {
  const controller = useController();
  const session = useStudio((state) => state.session);
  const applying = useStudio((state) => state.actions.edit === 'busy');
  const viewport = useViewport();
  const [editor, dispatch] = useReducer(editorReducer, undefined, createEditor);
  const [draft, setDraft] = useState<NewOp | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [hover, setHover] = useState<CropHandle | null>(null);
  const [textBox, setTextBox] = useState<{ at: Point; value: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef({ editor, confirming });
  latest.current = { editor, confirming };

  const edit = currentEdit(editor);
  const cropping = editor.tool === 'crop';
  const full = useMemo(() => fullCrop(size), [size]);
  const view = cropping ? full : (edit.crop ?? full);
  const fit = fitImage(view, viewport, {
    reserveTop: RESERVE_TOP,
    reserveBottom: RESERVE_BOTTOM,
    scaleFactor: session?.scaleFactor ?? 1,
  });
  const cssScale = fit.width / view.width;
  const crop = cropDraft ?? edit.crop ?? full;

  // Paint the picture, its shapes and the shape being drawn.
  useLayoutEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.max(1, Math.round(fit.width * ratio));
    element.height = Math.max(1, Math.round(fit.height * ratio));
    context.clearRect(0, 0, element.width, element.height);
    const shown: EditOp[] = draft ? [...edit.ops, { ...draft, id: 0 }] : [...edit.ops];
    paintEdit(context, image, { ops: shown, crop: null }, view, (fit.width * ratio) / view.width);
  }, [image, edit.ops, draft, view, fit.width, fit.height]);

  // A different tool starts from a clean slate.
  useEffect(() => {
    drag.current = null;
    setDraft(null);
    setCropDraft(null);
    setTextBox(null);
    setHover(null);
  }, [editor.tool]);

  const cancel = (): void => {
    if (latest.current.confirming) setConfirming(false);
    else if (hasChanges(latest.current.editor)) setConfirming(true);
    else controller.cancelEdit();
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  // Ctrl+Z / Ctrl+Y / Esc work anywhere in the editor, ahead of the page-level shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTyping(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (modifier && key === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const textOpen = textBox !== null;
  useEffect(() => {
    if (textOpen) textArea.current?.focus();
  }, [textOpen]);

  const toImage = (event: { clientX: number; clientY: number }): Point => {
    const box = surface.current?.getBoundingClientRect();
    const width = box && box.width > 0 ? box.width : fit.width;
    const height = box && box.height > 0 ? box.height : fit.height;
    return {
      x: view.x + ((event.clientX - (box?.left ?? 0)) / width) * view.width,
      y: view.y + ((event.clientY - (box?.top ?? 0)) / height) * view.height,
    };
  };

  const commitText = (): void => {
    const box = textBox;
    setTextBox(null);
    if (!box) return;
    const op = textOp(box.at, box.value, editor.style, cssScale);
    if (op) dispatch({ type: 'add', op });
  };

  const eraseAt = (point: Point): void => {
    const index = topOpAt(edit.ops, point, ERASER_TOLERANCE_CSS / cssScale);
    const op = edit.ops[index];
    if (op) dispatch({ type: 'remove', id: op.id });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || applying) return;
    const point = toImage(event);
    const tool = editor.tool;
    if (tool === 'text') {
      commitText();
      setTextBox({ at: point, value: '' });
      return;
    }
    if (tool === 'crop') {
      const handle = hitCropHandle(crop, point, HANDLE_TOLERANCE_CSS / cssScale);
      if (!handle) return;
      drag.current = { kind: 'crop', handle, start: point, origin: crop };
    } else if (tool === 'eraser') {
      drag.current = { kind: 'erase' };
      eraseAt(point);
    } else if (tool === 'pen' || tool === 'highlighter') {
      drag.current = { kind: 'stroke', tool, points: [point] };
      setDraft(strokeOp(tool, [point], editor.style, cssScale));
    } else if (isShapeTool(tool)) {
      drag.current = { kind: 'shape', tool, start: point, end: point, constrain: event.shiftKey };
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    const point = toImage(event);
    if (!current) {
      if (cropping) setHover(hitCropHandle(crop, point, HANDLE_TOLERANCE_CSS / cssScale));
      return;
    }
    switch (current.kind) {
      case 'stroke': {
        const last = current.points[current.points.length - 1];
        if (
          last &&
          Math.hypot(point.x - last.x, point.y - last.y) < STROKE_MIN_DISTANCE_CSS / cssScale
        )
          return;
        current.points.push(point);
        setDraft(strokeOp(current.tool, current.points, editor.style, cssScale));
        return;
      }
      case 'shape':
        current.end = point;
        current.constrain = event.shiftKey;
        setDraft(
          shapeOp(
            current.tool,
            current.start,
            point,
            editor.style,
            editor.blurMode,
            cssScale,
            event.shiftKey,
          ),
        );
        return;
      case 'erase':
        eraseAt(point);
        return;
      case 'crop':
        setCropDraft(
          dragCrop(
            current.origin,
            current.handle,
            { x: point.x - current.start.x, y: point.y - current.start.y },
            size,
            aspectValue(editor.aspect),
          ),
        );
    }
  };

  const finishDrag = (commit: boolean): void => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (commit && current.kind === 'stroke') {
      dispatch({
        type: 'add',
        op: strokeOp(
          current.tool,
          thinStroke(current.points, 1 / cssScale),
          editor.style,
          cssScale,
        ),
      });
    } else if (commit && current.kind === 'shape') {
      const op = shapeOp(
        current.tool,
        current.start,
        current.end,
        editor.style,
        editor.blurMode,
        cssScale,
        current.constrain,
      );
      if (op) dispatch({ type: 'add', op });
    } else if (commit && current.kind === 'crop' && cropDraft) {
      dispatch({ type: 'crop', crop: cropDraft, size });
    }
    setDraft(null);
    setCropDraft(null);
  };

  const cursor =
    editor.tool === 'crop'
      ? hover
        ? CURSORS[hover]
        : 'default'
      : editor.tool === 'text'
        ? 'text'
        : 'crosshair';

  const textSize = toTextSize(editor.style.width, cssScale) * cssScale;

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 px-6"
      data-testid="editor-stage"
    >
      <EditorTools state={editor} dispatch={dispatch} size={size} />
      <FrameShell
        width={fit.width}
        height={fit.height}
        glow={session?.glowFrame ?? false}
        overlay={
          cropping ? (
            <CropHandles
              crop={crop}
              view={view}
              cssScale={cssScale}
              width={fit.width}
              height={fit.height}
            />
          ) : null
        }
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label="The screenshot you are editing"
          className="absolute inset-0 h-full w-full"
          data-testid="editor-canvas"
        />
        {cropping ? (
          <CropOverlay
            crop={crop}
            view={view}
            cssScale={cssScale}
            width={fit.width}
            height={fit.height}
          />
        ) : null}
        <div
          ref={surface}
          data-testid="editor-surface"
          data-tool={editor.tool}
          className="absolute inset-0 touch-none"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => finishDrag(true)}
          onPointerCancel={() => finishDrag(false)}
        />
        {textBox ? (
          <textarea
            ref={textArea}
            aria-label="Text to add"
            data-testid="editor-text-input"
            rows={1}
            value={textBox.value}
            className="absolute min-w-[120px] resize-none overflow-hidden rounded-md border border-dashed border-white/80 bg-black/20 p-1 leading-[1.25] font-semibold outline-none"
            style={{
              left: (textBox.at.x - view.x) * cssScale,
              top: (textBox.at.y - view.y) * cssScale,
              fontSize: textSize,
              color: editor.style.color,
            }}
            onChange={(event) => setTextBox({ ...textBox, value: event.target.value })}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setTextBox(null);
              } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                commitText();
              }
            }}
          />
        ) : null}
      </FrameShell>
      <EditorFooter
        state={editor}
        dispatch={dispatch}
        confirming={confirming}
        busy={applying}
        onCancel={cancel}
        onKeepEditing={() => setConfirming(false)}
        onDiscard={() => controller.cancelEdit()}
        onDone={() => void controller.completeEdit(currentEdit(editor))}
      />
    </div>
  );
}
