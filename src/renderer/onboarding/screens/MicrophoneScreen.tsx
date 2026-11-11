import { Button } from '@renderer/components/Button';
import { Card } from '@renderer/components/Card';
import { Icon, type IconName } from '@renderer/components/Icon';
import { Orb } from '@renderer/components/Orb';
import type { OrbState } from '@renderer/components/orbMath';
import { Waveform } from '@renderer/components/Waveform';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import type { OnboardingBridge } from '../bridge';
import { LevelMeter } from '../components/LevelMeter';
import { Notice } from '../components/Notice';
import { Reveal, ScreenFrame } from '../components/ScreenFrame';
import { SuccessMark } from '../components/SuccessMark';
import type { MicTest } from '../hooks/useMicTest';
import { useOpenMicSettings } from '../hooks/useOpenMicSettings';
import { describeMicStatus, type MicStatusTone } from '../micCopy';
import type { Direction } from '../navigation';
import { MIC_TEST_OPTIONS, toMeterLevel } from '../voiceDetector';

const TONE_TEXT: Record<MicStatusTone, string> = {
  neutral: 'text-fg-muted',
  active: 'text-fg',
  good: 'font-semibold text-success',
  warn: 'text-accent-text',
  bad: 'text-danger',
};

const TONE_ICON: Record<Exclude<MicStatusTone, 'good'>, IconName> = {
  neutral: 'mic',
  active: 'mic',
  warn: 'info',
  bad: 'error',
};

/** Visible privacy indicator: shown for as long as the microphone is actually open. */
function MicIndicator({ active }: { active: boolean }) {
  const reduceMotion = useReduceMotion();
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/15 px-2.5 py-1 text-[12px] font-semibold text-danger">
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full bg-danger ${reduceMotion ? '' : 'ob-live'}`}
      />
      Microphone on
    </span>
  );
}

export interface MicrophoneScreenProps {
  direction: Direction;
  mic: MicTest;
  bridge: OnboardingBridge;
}

export function MicrophoneScreen({ direction, mic, bridge }: MicrophoneScreenProps) {
  const reduceMotion = useReduceMotion();
  const settingsLink = useOpenMicSettings(bridge);
  const status = describeMicStatus(mic.state);
  const orb: OrbState = mic.active ? 'listening' : mic.state.status === 'error' ? 'error' : 'idle';
  const denied = mic.state.status === 'error' && mic.state.kind === 'denied';

  return (
    <ScreenFrame
      direction={direction}
      hero={<Orb state={orb} size={64} levelRef={mic.levelRef} decorative />}
      title={
        <>
          Let’s try your <span className="bk-brand-text">microphone</span>
        </>
      }
      description="Beekeeper only listens while you’re talking to it — or, if you turn it on, for the wake word. Your audio never leaves this PC unless you enable Azure speech."
    >
      <Card
        index={1}
        lift={false}
        icon="mic"
        title="Microphone test"
        headerActions={<MicIndicator active={mic.active} />}
        className="mt-5 w-full max-w-[560px] text-left"
      >
        <div className="flex flex-col gap-3 px-4 pt-2 pb-4">
          {reduceMotion ? null : <Waveform levelRef={mic.levelRef} active height={36} />}
          <LevelMeter
            levelRef={mic.levelRef}
            active={mic.active}
            threshold={toMeterLevel(MIC_TEST_OPTIONS.threshold)}
          />
          <div className="flex min-h-8 items-center gap-2.5">
            {status.tone === 'good' ? (
              <SuccessMark size={28} />
            ) : (
              <span className={TONE_TEXT[status.tone]}>
                <Icon name={TONE_ICON[status.tone]} size={20} />
              </span>
            )}
            <p className={`text-[15px] leading-snug ${TONE_TEXT[status.tone]}`}>{status.text}</p>
          </div>
        </div>
      </Card>

      {denied ? (
        <Reveal className="mt-3 flex flex-col items-center gap-2">
          <Button variant="secondary" icon="settings" onClick={settingsLink.open}>
            Open Windows microphone settings
          </Button>
          {settingsLink.failed ? (
            <Notice tone="bad" role="alert">
              Couldn’t open Windows Settings. Open Privacy &amp; security &gt; Microphone yourself,
              then try again.
            </Notice>
          ) : null}
        </Reveal>
      ) : null}

      <Reveal className="mt-3">
        <p className="text-[13px] text-fg-faint">
          You can skip this — without a microphone, Beekeeper works with typed commands.
        </p>
      </Reveal>
    </ScreenFrame>
  );
}
