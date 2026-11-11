import { useMemo } from 'react';
import { SettingsGroup, StatusPill } from '@renderer/components/forms';
import { modelManifest } from '@shared/models';
import { SPEECH_PACKS, whisperPackFor } from '@shared/speech/packs';
import { useController, useSectionUpdater, useSettingsStore, useView } from '../../context';
import { speechConfigured } from '../../lib/azure';
import { describeModel } from '../../lib/describe';
import { describeSttFallback, resolveFor } from '../../lib/engines';
import { ChoiceRow } from '../../ui/ChoiceRow';
import { DownloadRow } from '../../ui/DownloadRow';
import { InlineNotice } from '../../ui/InlineNotice';
import { LinkButton } from '../../ui/LinkButton';
import { AzureSpeechHint } from './AzureSpeechHint';
import { PackRow } from './PackRow';

const GROUP = 'stt-engine';

const RECOMMENDED = (
  <StatusPill tone="info" icon="sparkle">
    Recommended
  </StatusPill>
);

function WhisperRow({ model }: { model: 'small' | 'base' }) {
  const { voice } = useView();
  const update = useSectionUpdater('voice');
  const pack = whisperPackFor(model);
  return (
    <PackRow
      pack={pack}
      title={model === 'small' ? 'Whisper accurate' : 'Whisper fast'}
      description={SPEECH_PACKS[pack].description}
      badge={model === 'small' ? RECOMMENDED : undefined}
      choice={{
        group: GROUP,
        value: pack,
        selected: voice.sttEngine === 'whisper' && voice.whisperModel === model,
        onSelect: () => update({ sttEngine: 'whisper', whisperModel: model }),
      }}
    />
  );
}

/** The small English Vosk model: also what the wake word listens with. */
function OfflineRow() {
  const controller = useController();
  const { voice } = useView();
  const update = useSectionUpdater('voice');
  const model = useSettingsStore((state) => state.model);
  const summary = useMemo(
    () => (model ? describeModel(model, modelManifest.sizeBytes) : null),
    [model],
  );
  return (
    <DownloadRow
      title="Offline small (Vosk)"
      description="Light and quick, for clear English only. Also powers the “Hey Beekeeper” wake word."
      choice={{
        group: GROUP,
        value: 'offline',
        selected: voice.sttEngine === 'offline',
        onSelect: () => update({ sttEngine: 'offline' }),
      }}
      summary={summary}
      subject="Offline model"
      onDownload={() => controller.ensureModel()}
      onCancel={() => controller.cancelModel()}
      onRemove={() => controller.removeModel()}
    />
  );
}

function AzureRow() {
  const controller = useController();
  const view = useView();
  const update = useSectionUpdater('voice');
  const selected = view.voice.sttEngine === 'azure';
  const configured = speechConfigured(view);
  return (
    <ChoiceRow
      title="Azure Speech"
      description="Cloud recognition from your own Azure Speech resource. Your voice is sent to Azure."
      status={
        <StatusPill tone={configured ? 'success' : 'neutral'}>
          {configured ? 'Set up' : 'Not set up'}
        </StatusPill>
      }
      choice={{
        group: GROUP,
        value: 'azure',
        selected,
        disabled: !configured && !selected,
        onSelect: () => update({ sttEngine: 'azure' }),
      }}
      actions={
        configured ? undefined : (
          <LinkButton icon="chevron-right" onClick={() => controller.navigate('ai')}>
            Set up in AI settings
          </LinkButton>
        )
      }
    >
      {selected && !configured ? <AzureSpeechHint /> : null}
    </ChoiceRow>
  );
}

/** Which recogniser listens: pick a card, download what it needs, and see what is used meanwhile. */
export function RecognitionGroup() {
  const view = useView();
  const speech = useSettingsStore((state) => state.speech);
  const model = useSettingsStore((state) => state.model);
  const note = describeSttFallback(view, resolveFor(view, speech, model), speech, model);

  return (
    <SettingsGroup
      title="Speech recognition"
      footer="Whisper and the offline model run on this PC: your voice never leaves it unless you choose Azure Speech."
    >
      <div
        role="radiogroup"
        aria-label="Recognition engine"
        className={`divide-y divide-line overflow-hidden rounded-t-card ${note ? '' : 'rounded-b-card'}`}
      >
        {' '}
        <WhisperRow model="small" />
        <WhisperRow model="base" />
        <OfflineRow />
        <AzureRow />
      </div>
      {note ? (
        <div className="px-4 py-3">
          <InlineNotice tone={note.tone}>{note.text}</InlineNotice>
        </div>
      ) : null}
    </SettingsGroup>
  );
}
