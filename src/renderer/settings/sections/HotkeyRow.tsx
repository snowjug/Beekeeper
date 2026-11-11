import { Button } from '@renderer/components/Button';
import { KeyCombo, SettingRow, StatusPill } from '@renderer/components/forms';
import { showToast } from '@renderer/components/Toast';
import { DEFAULT_HOTKEYS } from '@shared/constants';
import type { HotkeyId } from '@shared/ipc/types';
import { useController, useSettingsStore, useView } from '../context';
import { useHotkeyRecorder, type HotkeyRecorder } from '../hooks/useHotkeyRecorder';
import { describeHotkey } from '../lib/describe';
import type { RecorderState } from '../lib/hotkeyRecorder';
import { InlineNotice } from '../ui/InlineNotice';

const PRESS_PROMPT = 'Press the new shortcut\u2026';

export interface HotkeyRowProps {
  id: HotkeyId;
  label: string;
  description: string;
}

type Failed = Extract<RecorderState, { phase: 'failed' }>;

function FailureNotice({ failed, recorder }: { failed: Failed; recorder: HotkeyRecorder }) {
  const { suggestion } = failed;
  return (
    <InlineNotice tone="danger">
      <p>{failed.message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {suggestion ? (
          <Button size="sm" variant="primary" onClick={() => recorder.choose(suggestion)}>
            Use {suggestion}
          </Button>
        ) : null}
        <Button size="sm" onClick={recorder.start}>
          Try again
        </Button>
        <Button size="sm" variant="ghost" onClick={recorder.cancel}>
          Dismiss
        </Button>
      </div>
    </InlineNotice>
  );
}

/** One global shortcut: current key caps, registration status, Change (records) and Reset to default. */
export function HotkeyRow({ id, label, description }: HotkeyRowProps) {
  const controller = useController();
  const accelerator = useView().hotkeys[id];
  const status = useSettingsStore((state) => state.hotkeys?.[id]);
  const recorder = useHotkeyRecorder(async (next) => {
    const result = await controller.setHotkey(id, next);
    if (result.ok) {
      showToast({
        title: 'Shortcut changed',
        message: `${label} is now ${result.accelerator}.`,
        tone: 'success',
      });
    }
    return result;
  });
  const { state } = recorder;
  const summary = describeHotkey(status, accelerator);
  const atDefault = accelerator.toLowerCase() === DEFAULT_HOTKEYS[id].toLowerCase();

  let combo = <KeyCombo accelerator={accelerator} />;
  if (state.phase === 'recording') {
    combo = (
      <div
        role="status"
        className="flex h-9 min-w-[240px] items-center rounded-control border border-accent bg-sunken px-3"
      >
        {state.held.length > 0 ? (
          <KeyCombo keys={state.held} pending />
        ) : (
          <span className="text-[13px] text-fg-muted">{PRESS_PROMPT}</span>
        )}
      </div>
    );
  } else if (state.phase === 'saving') {
    combo = (
      <span className="inline-flex items-center gap-2">
        <KeyCombo accelerator={state.accelerator} />
        <span role="status" className="text-[12.5px] text-fg-muted">
          Registering...
        </span>
      </span>
    );
  }

  let below = null;
  if (state.phase === 'recording') {
    below = state.hint ? (
      <InlineNotice tone="warning" live>
        {state.hint}
      </InlineNotice>
    ) : (
      <p className="text-[12.5px] leading-[18px] text-fg-muted">
        Hold Ctrl, Alt, Shift or Win with another key. Press Esc to cancel.
      </p>
    );
  } else if (state.phase === 'failed') {
    below = <FailureNotice failed={state} recorder={recorder} />;
  } else if (summary?.tone === 'danger') {
    below = (
      <InlineNotice tone="warning">
        {summary.detail} Choose a different shortcut with Change.
      </InlineNotice>
    );
  }

  return (
    <SettingRow
      stacked
      label={label}
      description={description}
      status={summary ? <StatusPill tone={summary.tone}>{summary.label}</StatusPill> : null}
      below={below}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {combo}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            icon={state.phase === 'recording' ? 'close' : 'edit'}
            disabled={state.phase === 'saving'}
            onClick={state.phase === 'recording' ? recorder.cancel : recorder.start}
          >
            {state.phase === 'recording' ? 'Cancel' : 'Change'}
          </Button>
          {state.phase === 'recording' ? null : (
            <Button
              size="sm"
              variant="ghost"
              disabled={state.phase === 'saving' || atDefault}
              onClick={() => recorder.choose(DEFAULT_HOTKEYS[id])}
            >
              Reset to default
            </Button>
          )}
        </div>
      </div>
    </SettingRow>
  );
}
