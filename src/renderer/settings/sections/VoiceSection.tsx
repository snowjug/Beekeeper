import { SettingsGroup, ToggleRow } from '@renderer/components/forms';
import { useSetter, useView } from '../context';
import { SectionPage } from '../ui/SectionPage';
import { AssistantVoiceGroup } from './voice/AssistantVoiceGroup';
import { LanguageGroup } from './voice/LanguageGroup';
import { ListeningGroup } from './voice/ListeningGroup';
import { MicrophoneGroup } from './voice/MicrophoneGroup';
import { RecognitionGroup } from './voice/RecognitionGroup';

export function VoiceSection() {
  const { voice } = useView();
  const setVoice = useSetter('voice');
  return (
    <SectionPage section="voice">
      <MicrophoneGroup />
      <LanguageGroup />
      <RecognitionGroup />
      <ListeningGroup />
      <AssistantVoiceGroup />
      <SettingsGroup title="Sounds">
        <ToggleRow
          label="Sound effects"
          description="Short chimes when Beekeeper starts or stops listening, or when something goes wrong."
          checked={voice.earcons}
          onChange={(on) => setVoice('earcons', on)}
        />
      </SettingsGroup>
    </SectionPage>
  );
}
