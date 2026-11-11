import {
  SelectField,
  SettingRow,
  SettingsGroup,
  type SelectOption,
} from '@renderer/components/forms';
import { useSetter, useView } from '../../context';
import { elevenLabsConfigured } from '../../lib/engines';
import { validateElevenLabsVoiceId } from '../../lib/validation';
import { TextField } from '../../ui/fields';
import { InlineNotice } from '../../ui/InlineNotice';
import { ConnectionTest } from '../ai/ConnectionTest';
import { SecretField } from '../ai/SecretField';

const MODELS: readonly SelectOption[] = [
  { value: 'eleven_flash_v2_5', label: 'Flash v2.5 (fast)' },
  { value: 'eleven_multilingual_v2', label: 'Multilingual v2 (best quality)' },
];

function isModel(value: string): value is 'eleven_flash_v2_5' | 'eleven_multilingual_v2' {
  return MODELS.some((model) => model.value === value);
}

/** Optional cloud voice from the user's own ElevenLabs account. */
export function ElevenLabsGroup() {
  const view = useView();
  const { voice, secrets } = view;
  const setVoice = useSetter('voice');

  return (
    <SettingsGroup
      title="ElevenLabs"
      footer="ElevenLabs is optional and needs your own account. Without it Beekeeper keeps using the natural or Windows voice."
    >
      <div className="px-4 py-3">
        <InlineNotice icon="cloud">
          The text of Beekeeper&apos;s replies is sent to ElevenLabs (api.elevenlabs.io) to be
          turned into speech. Your key is stored encrypted on this PC.
        </InlineNotice>
      </div>
      <SettingRow
        stacked
        label="API key"
        description="From your ElevenLabs account. Stored encrypted on this PC. It is never shown again."
      >
        <SecretField name="elevenlabs" label="ElevenLabs API key" hint={secrets.elevenLabsKey} />
      </SettingRow>
      <SettingRow
        label="Voice ID"
        description="Paste a voice ID from your ElevenLabs Voice Library."
      >
        <TextField
          label="ElevenLabs voice ID"
          value={voice.elevenLabsVoiceId}
          placeholder="Voice ID"
          mono
          validate={validateElevenLabsVoiceId}
          onCommit={(id) => setVoice('elevenLabsVoiceId', id)}
        />
      </SettingRow>
      <SettingRow
        label="Model"
        description="Flash v2.5 answers fastest. Multilingual v2 has the best quality."
      >
        <SelectField
          label="ElevenLabs model"
          value={voice.elevenLabsModel}
          options={MODELS}
          onChange={(model) => {
            if (isModel(model)) setVoice('elevenLabsModel', model);
          }}
        />
      </SettingRow>
      <ConnectionTest
        service="elevenlabs"
        label="Test voice"
        description="Checks the saved key and voice ID with ElevenLabs."
        canTest={elevenLabsConfigured(view)}
        missingHint="Add an API key and a voice ID to test the voice."
        signature={`${voice.elevenLabsVoiceId}|${voice.elevenLabsModel}|${secrets.elevenLabsKey ?? ''}`}
      />
    </SettingsGroup>
  );
}
