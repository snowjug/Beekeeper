import { useId, type ReactNode } from 'react';
import { Card } from '@renderer/components/Card';
import { Toggle } from '@renderer/components/Toggle';
import type { WorkerStatus } from '@shared/ipc/types';
import type { VoicePrefs, VoicePrefsPatch } from '../hooks/useSettings';
import { describeWakeHint } from '../wakeHint';
import { Notice } from './Notice';

interface OptionRowProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}

/** A labelled switch: clicking the title toggles it too, the description explains the effect. */
function OptionRow({ title, description, checked, onChange, children }: OptionRowProps) {
  const id = useId();
  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block cursor-pointer text-[15px] font-semibold text-fg">
            {title}
          </label>
          <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">{description}</p>
        </div>
        <Toggle id={id} checked={checked} onChange={onChange} label={title} />
      </div>
      {children}
    </div>
  );
}

export interface VoiceOptionsCardProps {
  voice: VoicePrefs;
  onChange: (patch: VoicePrefsPatch) => void;
  modelReady: boolean;
  worker: WorkerStatus | null;
  /** Friendly text when saving a preference failed (the switch has already rolled back). */
  saveError: string | null;
}

/** Wake word (opt-in, off by default), push to talk and spoken replies. */
export function VoiceOptionsCard({
  voice,
  onChange,
  modelReady,
  worker,
  saveError,
}: VoiceOptionsCardProps) {
  const hint = describeWakeHint({ wakeWord: voice.wakeWord, modelReady, worker });
  return (
    <Card index={3} lift={false} icon="mic" title="Voice options" className="text-left">
      <div className="divide-y divide-line px-4 pb-1">
        <OptionRow
          title="Hey Beekeeper"
          description="Listens for the phrase locally — nothing is recorded or sent anywhere. You can turn it off any time; a tray indicator shows when the mic is active."
          checked={voice.wakeWord}
          onChange={(checked) => onChange({ wakeWord: checked })}
        >
          {hint ? (
            <Notice tone={hint.tone} role="status" compact className="mt-2">
              {hint.text}
            </Notice>
          ) : null}
        </OptionRow>
        <OptionRow
          title="Push to talk"
          description="Hold the assistant hotkey while you speak, then let go to send."
          checked={voice.pushToTalk}
          onChange={(checked) => onChange({ pushToTalk: checked })}
        />
        <OptionRow
          title="Speak replies aloud"
          description="Beekeeper reads its answers out loud using your installed Windows voices."
          checked={voice.ttsEnabled}
          onChange={(checked) => onChange({ ttsEnabled: checked })}
        />
      </div>
      {saveError ? (
        <Notice tone="bad" role="alert" className="mx-4 mb-4">
          {saveError}
        </Notice>
      ) : null}
    </Card>
  );
}
