import { Button } from '@renderer/components/Button';
import { LevelMeter, SettingRow } from '@renderer/components/forms';
import { useMicTest, type MicTestState } from '../../hooks/useMicTest';
import { InlineNotice } from '../../ui/InlineNotice';
import { OpenMicSettingsButton } from './OpenMicSettingsButton';

const STATUS_TEXT: Record<'idle' | 'starting' | 'listening', string> = {
  idle: 'Press Test microphone, then say a few words.',
  starting: 'Opening the microphone...',
  listening: 'Listening. Say something.',
};

function Feedback({ state }: { state: MicTestState }) {
  if (state.status === 'error') {
    return (
      <InlineNotice tone="danger" action={<OpenMicSettingsButton />}>
        {state.message}
      </InlineNotice>
    );
  }
  if (state.status === 'done') {
    return state.heard ? (
      <InlineNotice tone="success" live>
        Your microphone works. I heard you loud and clear.
      </InlineNotice>
    ) : (
      <InlineNotice tone="warning" live>
        I could not hear anything. Check the device, or raise its input volume in Windows.
      </InlineNotice>
    );
  }
  return (
    <p role="status" className="text-[12.5px] leading-[18px] text-fg-muted">
      {STATUS_TEXT[state.status]}
      {state.status === 'listening' ? <span aria-hidden> {state.secondsLeft} s</span> : null}
    </p>
  );
}

/** "Test microphone": a live level meter for about five seconds, with clear idle / error states. */
export function MicTestRow({ deviceId }: { deviceId: string }) {
  const { state, levelRef, start, stop } = useMicTest(deviceId);
  const listening = state.status === 'listening';
  return (
    <SettingRow
      label="Test microphone"
      description="Speak for a few seconds and watch the level move."
      below={
        <div className="space-y-2.5">
          <LevelMeter levelRef={levelRef} active={listening} label="Microphone level" />
          <Feedback state={state} />
        </div>
      }
    >
      <Button
        size="sm"
        variant={listening ? 'secondary' : 'primary'}
        icon={listening ? 'stop' : 'mic'}
        disabled={state.status === 'starting'}
        onClick={() => (listening ? stop() : void start())}
      >
        {listening ? 'Stop test' : 'Test microphone'}
      </Button>
    </SettingRow>
  );
}
