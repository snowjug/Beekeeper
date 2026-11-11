import type { HotkeyId, HotkeyStatus, WorkerStatus } from '@shared/ipc/types';
import { HotkeyCard } from '../components/HotkeyCard';
import { ScreenFrame } from '../components/ScreenFrame';
import { VoiceOptionsCard } from '../components/VoiceOptionsCard';
import type { VoicePrefs, VoicePrefsPatch } from '../hooks/useSettings';
import type { Direction } from '../navigation';

export interface HotkeysScreenProps {
  direction: Direction;
  /** Configured shortcuts; used until (or if) the registration status cannot be read. */
  hotkeys: Record<HotkeyId, string>;
  /** What Windows actually registered; null while unknown (then no status badge is shown). */
  status: HotkeyStatus | null;
  voice: VoicePrefs;
  onVoicePref: (patch: VoicePrefsPatch) => void;
  saveError: string | null;
  modelReady: boolean;
  /** The small offline model (the wake word's) is being downloaded right now. */
  modelDownloading: boolean;
  worker: WorkerStatus | null;
}

export function HotkeysScreen({
  direction,
  hotkeys,
  status,
  voice,
  onVoicePref,
  saveError,
  modelReady,
  modelDownloading,
  worker,
}: HotkeysScreenProps) {
  return (
    <ScreenFrame
      direction={direction}
      width="wide"
      title={
        <>
          Summon it <span className="bk-brand-text">anywhere</span>
        </>
      }
      description="Works from any app — change them any time in Settings > Hotkeys."
    >
      <div className="mt-4 grid w-full grid-cols-[1fr_1.25fr] items-stretch gap-4">
        <div className="flex flex-col gap-3">
          <HotkeyCard
            index={1}
            icon="sparkle"
            title="Assistant"
            description="Opens the assistant bar and starts listening — from any app."
            accelerator={status?.assistant.accelerator ?? hotkeys.assistant}
            status={status?.assistant}
          />
          <HotkeyCard
            index={2}
            icon="circle"
            title="Circle to Search"
            description="Draw around anything on your screen to read, copy, translate or search it."
            accelerator={status?.circle.accelerator ?? hotkeys.circle}
            status={status?.circle}
          />
          <p className="px-1 text-[13px] leading-snug text-fg-muted">
            Also: <span className="font-semibold text-fg">{hotkeys.capture}</span> takes a
            screenshot and <span className="font-semibold text-fg">{hotkeys.dictation}</span> types
            what you say, in any app.
          </p>
        </div>
        <VoiceOptionsCard
          voice={voice}
          onChange={onVoicePref}
          modelReady={modelReady}
          modelDownloading={modelDownloading}
          worker={worker}
          saveError={saveError}
        />
      </div>
    </ScreenFrame>
  );
}
