import { useId } from 'react';
import { Pill } from '../components/Pill';
import { ChoiceCard } from '../components/ChoiceCard';
import { DownloadCard } from '../components/DownloadCard';
import { Notice } from '../components/Notice';
import { Reveal, ScreenFrame } from '../components/ScreenFrame';
import type { VoicePrefs, VoicePrefsPatch } from '../hooks/useSettings';
import { describeModelCopy, type DownloadKind } from '../modelCopy';
import type { ModelView } from '../modelFormat';
import type { Direction } from '../navigation';
import type { PackLine } from '../packFormat';
import type { Quality } from '../summary';

/** What each quality writes to the settings (one save, so the choice is atomic). */
export const QUALITY_PREFS: Record<Quality, VoicePrefsPatch> = {
  best: { sttEngine: 'whisper', whisperModel: 'small', ttsEngine: 'natural' },
  light: { sttEngine: 'offline', ttsEngine: 'system' },
};

/** Light is the small offline model; anything else (Whisper, or a cloud engine) counts as Best. */
export function qualityOf(voice: Pick<VoicePrefs, 'sttEngine'>): Quality {
  return voice.sttEngine === 'offline' ? 'light' : 'best';
}

const LANGUAGES: ReadonlyArray<{
  value: VoicePrefs['language'];
  title: string;
  hindi?: boolean;
  description: string;
}> = [
  { value: 'en', title: 'English', description: 'Indian & other accents' },
  { value: 'hi', title: 'हिन्दी', hindi: true, description: 'Hindi' },
  { value: 'auto', title: 'Both', description: 'English + Hindi, mixed freely' },
];

export interface LanguageVoiceScreenProps {
  direction: Direction;
  voice: VoicePrefs;
  onVoicePref: (patch: VoicePrefsPatch) => void;
  /** Friendly text when saving a choice failed (the choice has already rolled back). */
  saveError: string | null;
  quality: Quality;
  /** The download behind the chosen quality; null while its state has not been read. */
  download: {
    view: ModelView | null;
    paused: boolean;
    /** Friendly text when talking to the main process failed. */
    error: string | null;
    onPause: () => void;
    /** One line per downloaded file set (Best only). */
    lines?: readonly PackLine[];
  };
}

/**
 * Step 2: which language you speak and how good the voice should be. The choices are saved at
 * once; downloads only start on "Download" and keep going in the background after Continue.
 */
export function LanguageVoiceScreen({
  direction,
  voice,
  onVoicePref,
  saveError,
  quality,
  download,
}: LanguageVoiceScreenProps) {
  const languageId = useId();
  const qualityId = useId();
  const { view } = download;
  const kind: DownloadKind = quality === 'best' ? 'speech' : 'model';
  const copy = describeModelCopy(view, download.paused, kind);
  // Switching while a download runs would leave it running unseen: pause it first.
  const busy = view?.phase === 'downloading' || view?.phase === 'verifying';

  return (
    <ScreenFrame
      direction={direction}
      width="wide"
      title={
        <>
          Pick your <span className="bk-brand-text">language &amp; voice</span>
        </>
      }
      description="Beekeeper understands Hindi, English and Hinglish, all on this PC."
    >
      <Reveal className="mt-3 w-full text-left">
        <h2
          id={languageId}
          className="mb-1.5 text-[12px] font-semibold tracking-wide text-fg-muted uppercase"
        >
          Which language do you speak?
        </h2>
        <div role="radiogroup" aria-labelledby={languageId} className="grid grid-cols-3 gap-3">
          {LANGUAGES.map((option) => (
            <ChoiceCard
              key={option.value}
              group="onboarding-language"
              value={option.value}
              title={option.hindi ? <span lang="hi">{option.title}</span> : option.title}
              description={option.description}
              checked={voice.language === option.value}
              onSelect={() => onVoicePref({ language: option.value })}
            />
          ))}
        </div>
      </Reveal>

      <Reveal className="mt-3 w-full text-left">
        <h2
          id={qualityId}
          className="mb-1.5 text-[12px] font-semibold tracking-wide text-fg-muted uppercase"
        >
          How should it sound and listen?
        </h2>
        <div role="radiogroup" aria-labelledby={qualityId} className="grid grid-cols-2 gap-3">
          <ChoiceCard
            group="onboarding-quality"
            value="best"
            title="Best"
            badge={
              <Pill size="sm" tone="good">
                Recommended
              </Pill>
            }
            description="Natural voice + accurate recognition"
            meta="≈ 500 MB download"
            checked={quality === 'best'}
            disabled={busy && quality !== 'best'}
            onSelect={() => onVoicePref(QUALITY_PREFS.best)}
          />
          <ChoiceCard
            group="onboarding-quality"
            value="light"
            title="Light"
            description="Small offline model, Windows voices"
            meta="≈ 40 MB · English"
            checked={quality === 'light'}
            disabled={busy && quality !== 'light'}
            onSelect={() => onVoicePref(QUALITY_PREFS.light)}
          />
        </div>
        {busy ? (
          <p className="mt-2 text-[12.5px] text-fg-faint">
            Pause the download to switch between Best and Light.
          </p>
        ) : null}
        {quality === 'light' && voice.language !== 'en' ? (
          <Notice tone="warn" role="status" compact className="mt-2">
            The small offline model understands English only. Choose Best to use Hindi.
          </Notice>
        ) : null}
      </Reveal>

      <DownloadCard
        view={view}
        copy={copy}
        subject={quality === 'best' ? 'Voice and recognition' : 'Voice model'}
        onPause={download.onPause}
        lines={download.lines}
      />
      {download.error ? (
        <Notice tone="bad" role="alert" className="mt-3">
          {download.error}
        </Notice>
      ) : null}
      {saveError ? (
        <Notice tone="bad" role="alert" className="mt-3">
          {saveError}
        </Notice>
      ) : null}
    </ScreenFrame>
  );
}
