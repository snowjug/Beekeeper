import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Icon } from '@renderer/components/Icon';
import { useRowDescription } from '@renderer/components/forms';

interface Timeout {
  start: (callback: () => void, ms: number) => void;
  cancel: () => void;
}

/** One restartable timeout that is cancelled automatically on unmount. */
function useTimeout(): Timeout {
  const id = useRef<number | null>(null);
  const cancel = useCallback((): void => {
    if (id.current !== null) window.clearTimeout(id.current);
    id.current = null;
  }, []);
  const start = useCallback(
    (callback: () => void, ms: number): void => {
      cancel();
      id.current = window.setTimeout(callback, ms);
    },
    [cancel],
  );
  useEffect(() => cancel, [cancel]);
  return useMemo(() => ({ start, cancel }), [start, cancel]);
}

export interface TextFieldProps {
  value: string;
  /** Called with the trimmed, validated text on blur, Enter or after typing stops. */
  onCommit: (value: string) => void;
  label: string;
  /** Returns a problem description; invalid text is never committed. */
  validate?: (value: string) => string | null;
  placeholder?: string;
  disabled?: boolean;
  /** Idle time before typing is committed; 0 commits on blur / Enter only. */
  debounceMs?: number;
  inputMode?: 'text' | 'url';
  fullWidth?: boolean;
  mono?: boolean;
}

const SAVED_FLASH_MS = 1600;

/** Text input with inline validation errors and a brief "saved" tick after each commit. */
export function TextField({
  value,
  onCommit,
  label,
  validate,
  placeholder,
  disabled = false,
  debounceMs = 500,
  inputMode = 'text',
  fullWidth = false,
  mono = false,
}: TextFieldProps) {
  const describedBy = useRowDescription();
  const errorId = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const focused = useRef(false);
  const typing = useTimeout();
  const flash = useTimeout();
  const latest = useRef({ value, onCommit, validate });

  useEffect(() => {
    latest.current = { value, onCommit, validate };
  });

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  /** Validates and commits; returns false when the text is invalid. */
  const commit = useCallback(
    (raw: string): boolean => {
      typing.cancel();
      const next = raw.trim();
      const problem = latest.current.validate?.(next) ?? null;
      setError(problem);
      if (problem !== null) return false;
      if (next !== latest.current.value) {
        latest.current.onCommit(next);
        setSaved(true);
        flash.start(() => setSaved(false), SAVED_FLASH_MS);
      }
      return true;
    },
    [typing, flash],
  );

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value;
    setDraft(next);
    if (error !== null && (latest.current.validate?.(next.trim()) ?? null) === null) setError(null);
    if (debounceMs > 0) typing.start(() => commit(next), debounceMs);
  };

  return (
    <div className={fullWidth ? 'w-full' : 'w-[240px]'}>
      <div className="relative">
        <input
          type="text"
          inputMode={inputMode}
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={error !== null}
          aria-describedby={
            [describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined
          }
          spellCheck={false}
          autoComplete="off"
          onChange={onChange}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            if (commit(draft)) setDraft(draft.trim());
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(draft);
          }}
          className={`h-9 w-full rounded-control border bg-sunken pr-9 pl-3 text-[14px] text-fg placeholder:text-fg-faint disabled:opacity-50 ${
            mono ? 'font-mono text-[13px]' : ''
          } ${error ? 'border-danger' : 'border-line'}`}
        />
        {saved ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-success"
          >
            <Icon name="check" size={16} />
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-[12.5px] leading-[18px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface SliderFieldProps {
  value: number;
  min: number;
  max: number;
  step: number;
  /** Called when the thumb is released, a key is released or the slider loses focus. */
  onCommit: (value: number) => void;
  label: string;
  format?: (value: number) => string;
  disabled?: boolean;
}

/** Range input with a live value label. Dragging never spams the main process. */
export function SliderField({
  value,
  min,
  max,
  step,
  onCommit,
  label,
  format = String,
  disabled = false,
}: SliderFieldProps) {
  const describedBy = useRowDescription();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (next: number): void => {
    if (Number.isFinite(next) && next !== value) onCommit(next);
  };

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-label={label}
        aria-describedby={describedBy}
        aria-valuetext={format(draft)}
        onChange={(event) => setDraft(event.currentTarget.valueAsNumber)}
        onPointerUp={(event) => commit(event.currentTarget.valueAsNumber)}
        onKeyUp={(event) => commit(event.currentTarget.valueAsNumber)}
        onBlur={(event) => commit(event.currentTarget.valueAsNumber)}
        className="h-5 w-[170px] cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className="w-11 text-right text-[13px] font-medium text-fg-muted tabular-nums">
        {format(draft)}
      </span>
    </div>
  );
}
