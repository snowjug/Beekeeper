import { useMemo } from 'react';
import { Button } from '@renderer/components/Button';
import {
  Segmented,
  SelectField,
  SettingRow,
  SettingsGroup,
  ToggleRow,
  type SegmentedOption,
  type SelectOption,
} from '@renderer/components/forms';
import { useSetter, useView } from '../../context';
import { useSpeechVoices } from '../../hooks/useSpeechVoices';
import { useVoicePreview } from '../../hooks/useVoicePreview';
import { shapeVoiceChoices } from '../../lib/devices';
import { formatRate } from '../../lib/format';
import { validateAzureVoice } from '../../lib/validation';
import { SliderField, TextField } from '../../ui/fields';
import { AzureSpeechHint } from './AzureSpeechHint';

const ENGINES: readonly SegmentedOption<'system' | 'azure'>[] = [
  { value: 'system', label: 'System' },
  { value: 'azure', label: 'Azure' },
];

const LOADING_VOICES: readonly SelectOption[] = [{ value: '', label: 'Loading voices...' }];
const NO_VOICES: readonly SelectOption[] = [{ value: '', label: 'Windows default voice' }];

export function SpeechGroup() {
  const { voice } = useView();
  const setVoice = useSetter('voice');
  const { voices, loading, supported } = useSpeechVoices();
  const preview = useVoicePreview();
  const choices = useMemo(
    () => shapeVoiceChoices(voices, voice.ttsVoiceUri),
    [voices, voice.ttsVoiceUri],
  );
  const azure = voice.ttsEngine === 'azure';
  const options = loading ? LOADING_VOICES : voices.length === 0 ? NO_VOICES : choices.options;

  return (
    <SettingsGroup title="Spoken replies">
      <ToggleRow
        label="Spoken replies"
        description="Beekeeper reads its answers aloud. Press Esc or the hotkey to interrupt."
        checked={voice.ttsEnabled}
        onChange={(on) => setVoice('ttsEnabled', on)}
      />
      <SettingRow
        label="Voice engine"
        description="System uses the voices installed in Windows. Azure uses neural voices."
        below={azure ? <AzureSpeechHint /> : undefined}
      >
        <Segmented
          label="Voice engine"
          value={voice.ttsEngine}
          options={ENGINES}
          onChange={(engine) => setVoice('ttsEngine', engine)}
        />
      </SettingRow>
      {azure ? (
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
      ) : (
        <SettingRow
          label="Voice"
          description="Automatic picks the best English voice that is installed."
        >
          <SelectField
            label="Voice"
            value={choices.value}
            options={options}
            disabled={loading || !supported}
            onChange={(uri) => setVoice('ttsVoiceUri', uri)}
          />
        </SettingRow>
      )}
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
      <SettingRow
        label="Preview"
        description={
          azure
            ? 'Azure voices can only be heard in the assistant. Switch the engine to System to preview a Windows voice.'
            : 'Plays a short sentence with the voice and speed above.'
        }
      >
        <Button
          size="sm"
          icon={preview.speaking ? 'stop' : 'play'}
          disabled={!supported || azure}
          onClick={() =>
            preview.speaking ? preview.stop() : preview.play(choices.value, voice.ttsRate)
          }
        >
          {preview.speaking ? 'Stop' : 'Preview'}
        </Button>
      </SettingRow>
    </SettingsGroup>
  );
}
