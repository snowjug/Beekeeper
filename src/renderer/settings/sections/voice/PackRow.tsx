import { useMemo, type ReactNode } from 'react';
import { SPEECH_PACKS, type SpeechPackId } from '@shared/speech/packs';
import { useController, useSettingsStore } from '../../context';
import { describePack } from '../../lib/describe';
import { DownloadRow } from '../../ui/DownloadRow';
import type { ChoiceControl } from '../../ui/ChoiceRow';

export interface PackRowProps {
  pack: SpeechPackId;
  title: string;
  description: ReactNode;
  badge?: ReactNode;
  /** Present when the pack is one option of a radio group (a recognition model). */
  choice?: ChoiceControl;
}

/** A speech pack (natural voice, Whisper) with its live download state and actions. */
export function PackRow({ pack, title, description, badge, choice }: PackRowProps) {
  const controller = useController();
  const state = useSettingsStore((store) => store.speech?.packs[pack] ?? null);
  const speechError = useSettingsStore((store) => store.speechError);
  const refusal = useSettingsStore((store) => store.packErrors[pack] ?? null);
  const { sizeBytes } = SPEECH_PACKS[pack];
  const summary = useMemo(
    () => (state ? describePack(state, sizeBytes) : null),
    [state, sizeBytes],
  );

  return (
    <DownloadRow
      title={title}
      description={description}
      badge={badge}
      choice={choice}
      summary={summary}
      unavailable={
        summary === null && speechError !== null
          ? { message: speechError, onRetry: () => void controller.refreshSpeech() }
          : null
      }
      subject={title}
      refusal={refusal}
      onDownload={() => controller.ensurePack(pack)}
      onCancel={() => controller.cancelPack(pack)}
      onRemove={() => controller.removePack(pack)}
    />
  );
}
