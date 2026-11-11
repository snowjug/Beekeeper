import { Button } from '@renderer/components/Button';
import { SettingsGroup, StatusPill } from '@renderer/components/forms';
import { modelManifest } from '@shared/models';
import { useController, useSettingsStore } from '../../context';
import { describeModel } from '../../lib/describe';
import { formatPercent } from '../../lib/format';
import { ConfirmButton } from '../../ui/ConfirmButton';
import { InlineNotice } from '../../ui/InlineNotice';
import { ProgressBar } from '../../ui/ProgressBar';

const PRIMARY_LABEL = {
  download: 'Download',
  resume: 'Resume download',
  retry: 'Retry',
} as const;

/** The offline speech model: state, live progress (speed, ETA, attempt) and Download / Cancel / Remove. */
export function VoiceModelCard() {
  const controller = useController();
  const model = useSettingsStore((state) => state.model);
  const summary = model ? describeModel(model, modelManifest.sizeBytes) : null;

  return (
    <SettingsGroup
      title="Voice model"
      footer={`Speech recognition and the wake word run on this PC with the ${modelManifest.license}-licensed Vosk model. Your audio never leaves it.`}
    >
      <div className="px-4 py-3.5">
        {model && summary ? (
          <>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] leading-5 font-medium text-fg">
                    {model.displayName}
                  </span>
                  <StatusPill tone={summary.tone}>{summary.label}</StatusPill>
                </div>
                <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-muted">
                  {summary.detail}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {summary.primary ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon="download"
                    onClick={() => void controller.ensureModel()}
                  >
                    {PRIMARY_LABEL[summary.primary]}
                  </Button>
                ) : null}
                {summary.canCancel ? (
                  <Button size="sm" onClick={() => void controller.cancelModel()}>
                    Cancel
                  </Button>
                ) : null}
                {summary.canRemove ? (
                  <ConfirmButton
                    label="Remove"
                    confirmLabel="Yes, remove"
                    icon="trash-can"
                    onConfirm={() => controller.removeModel()}
                  />
                ) : null}
              </div>
            </div>
            {summary.fraction !== null ? (
              <div className="mt-3 space-y-1.5">
                <ProgressBar value={summary.fraction} label="Voice model download" />
                <div className="flex justify-between text-[12px] text-fg-muted">
                  <span>{formatPercent(summary.fraction)}</span>
                  {summary.attempt ? <span>{summary.attempt}</span> : null}
                </div>
              </div>
            ) : null}
            {summary.note ? (
              <p className="mt-2 text-[12.5px] leading-[18px] text-fg-muted">{summary.note}</p>
            ) : null}
            {summary.error ? (
              <div className="mt-3">
                <InlineNotice tone="danger">{summary.error}</InlineNotice>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-fg-muted">Checking the voice model...</p>
        )}
      </div>
    </SettingsGroup>
  );
}
