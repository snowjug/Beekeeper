import { SettingRow, SettingsGroup } from '@renderer/components/forms';
import { useSetter, useView } from '../../context';
import { formatRate } from '../../lib/format';
import { validateAzureVoice } from '../../lib/validation';
import { SliderField, TextField } from '../../ui/fields';

/** Neural voice from the user's Azure Speech resource. It can only be heard in the assistant. */
export function AzureVoiceGroup() {
  const { voice } = useView();
  const setVoice = useSetter('voice');
  return (
    <SettingsGroup
      title="Azure voice"
      footer="Azure voices can only be heard in the assistant. To preview one here, switch to Windows voices or Natural voice."
    >
      <SettingRow
        label="Azure voice"
        description="For example en-US-AriaNeural or en-GB-SoniaNeural."
      >
        <TextField
          label="Azure voice"
          value={voice.azureVoice}
          validate={validateAzureVoice}
          onCommit={(name) => setVoice('azureVoice', name)}
        />
      </SettingRow>
      <SettingRow label="Speaking speed" description="From half speed to double speed.">
        <SliderField
          label="Speaking speed"
          value={voice.ttsRate}
          min={0.5}
          max={2}
          step={0.1}
          format={formatRate}
          onCommit={(rate) => setVoice('ttsRate', rate)}
        />
      </SettingRow>
    </SettingsGroup>
  );
}
