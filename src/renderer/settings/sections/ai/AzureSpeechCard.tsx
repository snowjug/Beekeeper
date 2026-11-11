import { SettingRow, SettingsGroup, ToggleRow } from '@renderer/components/forms';
import { useSetter, useView } from '../../context';
import { speechFieldsSet } from '../../lib/azure';
import { validateSpeechRegion } from '../../lib/validation';
import { TextField } from '../../ui/fields';
import { InlineNotice } from '../../ui/InlineNotice';
import { ConnectionTest } from './ConnectionTest';
import { SecretField } from './SecretField';

export function AzureSpeechCard() {
  const view = useView();
  const { ai, secrets } = view;
  const setAi = useSetter('ai');
  const configured = speechFieldsSet(view);

  return (
    <SettingsGroup
      title="Azure Speech"
      footer="Optional cloud speech recognition and neural voices. Offline speech keeps working without it."
    >
      <ToggleRow
        label="Use Azure Speech"
        description="Lets you choose Azure as the recognition and voice engine under Voice."
        checked={ai.useAzureSpeech}
        onChange={(on) => setAi('useAzureSpeech', on)}
        below={
          ai.useAzureSpeech && !configured ? (
            <InlineNotice tone="warning">
              Add the region and key below before Azure Speech can be used.
            </InlineNotice>
          ) : undefined
        }
      />
      <SettingRow
        label="Region"
        description="The Azure region of your Speech resource, for example westeurope."
      >
        <TextField
          label="Azure Speech region"
          value={ai.speechRegion}
          placeholder="westeurope"
          validate={validateSpeechRegion}
          onCommit={(region) => setAi('speechRegion', region)}
        />
      </SettingRow>
      <SettingRow
        stacked
        label="API key"
        description="Stored encrypted on this PC. It is never shown again."
      >
        <SecretField name="speech" label="Azure Speech API key" hint={secrets.speechKey} />
      </SettingRow>
      <ConnectionTest
        service="speech"
        canTest={configured}
        missingHint="Add a region and a key to test the connection."
        signature={`${ai.speechRegion}|${secrets.speechKey ?? ''}`}
      />
    </SettingsGroup>
  );
}
