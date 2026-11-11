import { useMemo, type ReactNode } from 'react';
import { Button } from '@renderer/components/Button';
import { SelectField, SettingRow, SettingsGroup } from '@renderer/components/forms';
import { MIC_ERROR_HELP } from '@renderer/lib/voice/mic';
import { useSetter, useView } from '../../context';
import { useMicDevices } from '../../hooks/useMicDevices';
import { shapeMicChoices } from '../../lib/devices';
import { InlineNotice } from '../../ui/InlineNotice';
import { LinkButton } from '../../ui/LinkButton';
import { MicTestRow } from './MicTestRow';
import { OpenMicSettingsButton } from './OpenMicSettingsButton';

export function MicrophoneGroup() {
  const { voice } = useView();
  const setVoice = useSetter('voice');
  const mics = useMicDevices();
  const { devices, loaded } = mics;
  const choices = useMemo(
    () => shapeMicChoices(devices, voice.micDeviceId, loaded),
    [devices, loaded, voice.micDeviceId],
  );

  const notices: ReactNode[] = [];
  if (choices.labelsHidden) {
    notices.push(
      <InlineNotice
        key="names"
        action={
          <Button size="sm" disabled={mics.requesting} onClick={() => void mics.requestNames()}>
            Allow microphone to show device names
          </Button>
        }
      >
        Windows hides microphone names until you allow access.
      </InlineNotice>,
    );
  }
  if (mics.permissionError) {
    notices.push(
      <InlineNotice key="permission" tone="danger" action={<OpenMicSettingsButton />}>
        {MIC_ERROR_HELP[mics.permissionError.kind]}
      </InlineNotice>,
    );
  }
  if (choices.savedMissing) {
    notices.push(
      <InlineNotice
        key="missing"
        tone="warning"
        action={
          <LinkButton onClick={() => setVoice('micDeviceId', 'default')}>
            Use the system default
          </LinkButton>
        }
      >
        Your saved microphone is not connected right now.
      </InlineNotice>,
    );
  }
  if (loaded && !choices.hasInputs) {
    notices.push(
      <InlineNotice key="none" tone="warning">
        {MIC_ERROR_HELP['no-device']}
      </InlineNotice>,
    );
  }
  if (!mics.supported) {
    notices.push(
      <InlineNotice key="unsupported" tone="warning">
        This window cannot list microphones. The system default is used.
      </InlineNotice>,
    );
  }

  return (
    <SettingsGroup title="Microphone">
      <SettingRow
        label="Microphone"
        description="Beekeeper listens to this device when you talk to it."
        below={notices.length > 0 ? <div className="space-y-2.5">{notices}</div> : undefined}
      >
        <SelectField
          label="Microphone"
          value={voice.micDeviceId}
          options={choices.options}
          onChange={(id) => setVoice('micDeviceId', id)}
        />
      </SettingRow>
      <MicTestRow deviceId={voice.micDeviceId} />
    </SettingsGroup>
  );
}
