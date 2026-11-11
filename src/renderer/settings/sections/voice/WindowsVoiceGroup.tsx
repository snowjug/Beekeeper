import { useMemo } from 'react';
import { Button } from '@renderer/components/Button';
import {
  SelectField,
  SettingRow,
  SettingsGroup,
  type SelectOption,
} from '@renderer/components/forms';
import { useSetter, useView } from '../../context';
import { useSpeechVoices } from '../../hooks/useSpeechVoices';
import { useVoicePreview } from '../../hooks/useVoicePreview';
import { shapeVoiceChoices } from '../../lib/devices';
import { formatRate } from '../../lib/format';
import { SliderField } from '../../ui/fields';

const LOADING_VOICES: readonly SelectOption[] = [{ value: '', label: 'Loading voices...' }];
const NO_VOICES: readonly SelectOption[] = [{ value: '', label: 'Windows default voice' }];

/** The voices installed in Windows: which one, how fast, and a preview. */
export function WindowsVoiceGroup() {
  const { voice } = useView();
  const setVoice = useSetter('voice');
  const { voices, loading, supported } = useSpeechVoices();
  const preview = useVoicePreview();
  const choices = useMemo(
    () => shapeVoiceChoices(voices, voice.ttsVoiceUri),
    [voices, voice.ttsVoiceUri],
  );
  const options = loading ? LOADING_VOICES : voices.length === 0 ? NO_VOICES : choices.options;

  return (
    <SettingsGroup title="Windows voices">
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
        description="Plays a short sentence with the voice and speed above."
      >
        <Button
          size="sm"
          icon={preview.speaking ? 'stop' : 'play'}
          disabled={!supported}
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
