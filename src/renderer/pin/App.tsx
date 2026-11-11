import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Point } from '@shared/geometry';
import { Icon, type IconName } from '@renderer/components/Icon';
import { usePin, usePinController } from './context';
import type { ButtonStatus } from './controller';
import {
  arrowOffset,
  beyondDragThreshold,
  dragTarget,
  formatPercent,
  MAX_OPACITY,
  MIN_OPACITY,
} from './zoom';

const STATUS_ICON: Partial<Record<ButtonStatus, IconName>> = {
  busy: 'refresh',
  done: 'check',
  error: 'error',
};

const STATUS_COLOR: Partial<Record<ButtonStatus, string>> = {
  done: 'text-success',
  error: 'text-danger',
};

interface BarButtonProps {
  icon: IconName;
  label: string;
  shortcut?: string;
  status?: ButtonStatus;
  /** Hidden when the pin is too narrow for the whole bar. */
  secondary?: boolean;
  testId: string;
  onClick: () => void;
}

function BarButton({
  icon,
  label,
  shortcut,
  status = 'idle',
  secondary = false,
  testId,
  onClick,
}: BarButtonProps) {
  const busy = status === 'busy';
  return (
    <button
      type="button"
      className="bk-pin-button"
      aria-label={label}
      aria-busy={busy || undefined}
      title={shortcut ? `${label} (${shortcut})` : label}
      data-testid={testId}
      data-status={status}
      data-secondary={secondary || undefined}
      disabled={busy}
      onClick={onClick}
    >
      <span className={`${STATUS_COLOR[status] ?? ''} ${busy ? 'animate-spin' : ''}`}>
        <Icon name={STATUS_ICON[status] ?? icon} size={16} />
      </span>
    </button>
  );
}

interface DragState {
  pointerId: number;
  /** The pointer's screen position when the button went down. */
  from: Point;
  /** The window's top-left corner at that moment. */
  origin: Point;
  moving: boolean;
}

function insideControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-pin-control]') !== null;
}

function announcementFor(copy: ButtonStatus, save: ButtonStatus): string {
  if (copy === 'done') return 'Copied to clipboard';
  if (copy === 'error') return 'Could not copy the image';
  if (save === 'done') return 'Saved to your screenshots folder';
  if (save === 'error') return 'Could not save the image';
  return '';
}

/** One pinned screenshot: the picture fills the window; a slim bar appears while the pointer is over it. */
export function App() {
  const controller = usePinController();
  const status = usePin((state) => state.status);
  const info = usePin((state) => state.info);
  const buttons = usePin((state) => state.buttons);
  const imageFailed = usePin((state) => state.imageFailed);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  // Native listeners: the wheel must not be passive (the page never scrolls or zooms by itself).
  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      controller.wheel({
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        x: event.clientX,
        y: event.clientY,
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [controller]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        controller.close();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 'c' || key === 's') {
          event.preventDefault();
          void (key === 'c' ? controller.copy() : controller.save());
        }
        return;
      }
      // The opacity slider and the buttons keep the keys they already use.
      if (event.altKey || event.target instanceof HTMLInputElement) return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        controller.zoomStep(1);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        controller.zoomStep(-1);
      } else if (event.key === '0') {
        event.preventDefault();
        controller.resetScale();
      } else if (!insideControl(event.target)) {
        const offset = arrowOffset(event.key, event.shiftKey);
        if (!offset) return;
        event.preventDefault();
        controller.moveTo({ x: window.screenX + offset.x, y: window.screenY + offset.y });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller]);

  // Dragging is done by the page (not a native drag region, which would swallow hover,
  // double-click and right-click): the window follows the pointer's travel on the screen.
  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || insideControl(event.target)) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No capture (the pointer is already gone): the window follows the pointer anyway.
    }
    drag.current = {
      pointerId: event.pointerId,
      from: { x: event.screenX, y: event.screenY },
      origin: { x: window.screenX, y: window.screenY },
      moving: false,
    };
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (state?.pointerId !== event.pointerId) return;
    const to = { x: event.screenX, y: event.screenY };
    if (!state.moving) {
      if (!beyondDragThreshold(state.from, to)) return;
      state.moving = true;
      setDragging(true);
    }
    controller.moveTo(dragTarget(state.origin, state.from, to));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const announcement = announcementFor(buttons.copy, buttons.save);

  return (
    <div
      ref={root}
      role="group"
      aria-label="Pinned screenshot"
      className="bk-pin"
      data-testid="pin-root"
      data-dragging={dragging}
      data-click-through={info?.clickThrough ?? false}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={(event) => {
        if (!insideControl(event.target)) controller.close();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        controller.menu();
      }}
    >
      {status === 'missing' ? (
        <p className="bk-pin-note" data-testid="pin-missing">
          This pinned screenshot is no longer available.
        </p>
      ) : null}
      {info ? (
        <>
          {imageFailed ? (
            <p className="bk-pin-note" data-testid="pin-image-failed">
              The image could not be shown.
            </p>
          ) : (
            <img
              className="bk-pin-image"
              src={info.imageUrl}
              alt={`Pinned screenshot, ${info.width} by ${info.height} pixels`}
              draggable={false}
              data-testid="pin-image"
              onError={() => controller.imageFailed()}
            />
          )}
          {info.clickThrough ? (
            <button
              type="button"
              className="bk-pin-unlock"
              data-pin-control
              data-testid="pin-unlock"
              aria-label="Turn off click-through"
              title="Clicks pass through this pin. Click here to turn that off"
              onMouseEnter={() => controller.setInteractive(true)}
              onMouseLeave={() => controller.setInteractive(false)}
              onClick={() => controller.setClickThrough(false)}
            >
              <Icon name="lock" size={14} />
            </button>
          ) : (
            <div
              role="group"
              aria-label="Pinned screenshot controls"
              className="bk-pin-bar"
              data-pin-control
              data-testid="pin-bar"
            >
              <BarButton
                icon="copy"
                label="Copy image"
                shortcut="Ctrl+C"
                status={buttons.copy}
                secondary
                testId="pin-copy"
                onClick={() => void controller.copy()}
              />
              <BarButton
                icon="download"
                label="Save image"
                shortcut="Ctrl+S"
                status={buttons.save}
                secondary
                testId="pin-save"
                onClick={() => void controller.save()}
              />
              <label className="bk-pin-opacity" title="Opacity">
                <Icon name="contrast" size={15} />
                <input
                  type="range"
                  aria-label="Opacity"
                  aria-valuetext={formatPercent(info.opacity)}
                  data-testid="pin-opacity"
                  min={Math.round(MIN_OPACITY * 100)}
                  max={Math.round(MAX_OPACITY * 100)}
                  step={1}
                  value={Math.round(info.opacity * 100)}
                  onChange={(event) =>
                    controller.setOpacity(Number(event.currentTarget.value) / 100)
                  }
                />
              </label>
              <BarButton
                icon="pointer"
                label="Let clicks pass through"
                secondary
                testId="pin-click-through"
                onClick={() => controller.setClickThrough(true)}
              />
              <BarButton
                icon="close"
                label="Close pin"
                shortcut="Esc"
                testId="pin-close"
                onClick={() => controller.close()}
              />
            </div>
          )}
        </>
      ) : null}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
