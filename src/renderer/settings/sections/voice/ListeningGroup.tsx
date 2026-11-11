import { Button } from '@renderer/components/Button';
import { SettingsGroup, StatusPill, ToggleRow } from '@renderer/components/forms';
import { formatBytes } from '@renderer/lib/format';
import { modelManifest } from '@shared/models';
import { useController, useSettingsStore, useSetter, useView } from '../../context';
import { describeModel, describeWake } from '../../lib/describe';
import { formatPercent } from '../../lib/format';
import { InlineNotice } from '../../ui/InlineNotice';

const MODEL_ACTION = {
  download: 'Download offline model',
  resume: 'Resume download',
  retry: 'Retry download',
} as const;

/** Wake word needs the offline model: explain why the switch is locked and offer the download. */
function ModelRequired() {
  const controller = useController();
  const model = useSettingsStore((state) => state.model);
  if (model === null || model.state === 'ready') return null;
  const summary = describeModel(model, modelManifest.sizeBytes);

  if (summary.downloading) {
    return (
      <InlineNotice live>
        Downloading the offline model... {formatPercent(summary.fraction ?? 0)}
      </InlineNotice>
    );
  }
  return (
    <InlineNotice
      tone="warning"
      action={
        summary.primary ? (
          <Button
            size="sm"
            variant="primary"
            icon="download"
            onClick={() => void controller.ensureModel()}
          >
            {MODEL_ACTION[summary.primary]}
          </Button>
        ) : undefined
      }
    >
      The wake word needs the small offline model ({formatBytes(modelManifest.sizeBytes)}). Download
      it once to turn it on.
    </InlineNotice>
  );
}

/** How a conversation starts: push-to-talk and the hands-free wake word. */
export function ListeningGroup() {
  const view = useView();
  const { voice } = view;
  const setVoice = useSetter('voice');
  const model = useSettingsStore((state) => state.model);
  const wake = useSettingsStore((state) => state.wake);
  const wakeSummary = describeWake(wake, voice.wakeWord);
  const modelReady = model?.state === 'ready';
  const needsModel = model !== null && !modelReady;
  const wakeDetail = wakeSummary?.detail ?? null;

  return (
    <SettingsGroup title="Listening">
      <ToggleRow
        label="Push-to-talk"
        description={`Hold ${view.hotkeys.assistant} to talk and release it to send. Off: press once and Beekeeper stops when you pause.`}
        checked={voice.pushToTalk}
        onChange={(on) => setVoice('pushToTalk', on)}
      />
      <ToggleRow
        label={'Wake word \u201cHey Beekeeper\u201d'}
        description="Say it to start listening hands-free. Off by default; it runs offline and keeps the microphone open while armed."
        checked={voice.wakeWord}
        disabled={!modelReady && !voice.wakeWord}
        onChange={(on) => setVoice('wakeWord', on)}
        status={
          wakeSummary ? <StatusPill tone={wakeSummary.tone}>{wakeSummary.label}</StatusPill> : null
        }
        below={
          needsModel || wakeDetail ? (
            <div className="space-y-2.5">
              <ModelRequired />
              {wakeDetail ? (
                <p className="text-[12.5px] leading-[18px] text-fg-muted">{wakeDetail}</p>
              ) : null}
            </div>
          ) : undefined
        }
      />
      <ToggleRow
        label="Pause wake word on battery saver"
        description="Stops listening for the wake word while Windows battery saver is on, to save power."
        checked={voice.wakeWordPauseOnBatterySaver}
        disabled={!voice.wakeWord}
        onChange={(on) => setVoice('wakeWordPauseOnBatterySaver', on)}
      />
    </SettingsGroup>
  );
}
