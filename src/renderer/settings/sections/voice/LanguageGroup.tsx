import {
  Segmented,
  SettingRow,
  SettingsGroup,
  type SegmentedOption,
} from '@renderer/components/forms';
import type { VoiceLanguage } from '@shared/settings';
import { useSetter, useView } from '../../context';

const LANGUAGES: readonly SegmentedOption<VoiceLanguage>[] = [
  { value: 'auto', label: 'Auto (English + Hindi)' },
  { value: 'en', label: 'English (India)' },
  { value: 'hi', label: 'Hindi' },
];

/** The language of what you say: recognition, dictation and the voice samples follow it. */
export function LanguageGroup() {
  const { voice } = useView();
  const setVoice = useSetter('voice');
  return (
    <SettingsGroup title="Language">
      <SettingRow
        stacked
        label="Language you speak"
        description="Beekeeper understands Hindi, English and Hinglish. Auto picks the language for every sentence, so you can mix them."
      >
        <Segmented
          label="Language you speak"
          value={voice.language}
          options={LANGUAGES}
          onChange={(language) => setVoice('language', language)}
        />
      </SettingRow>
    </SettingsGroup>
  );
}
