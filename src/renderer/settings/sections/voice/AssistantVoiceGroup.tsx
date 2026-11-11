import {
  Segmented,
  SettingRow,
  SettingsGroup,
  ToggleRow,
  type SegmentedOption,
} from '@renderer/components/forms';
import { useSetter, useSettingsStore, useView } from '../../context';
import { describeTtsFallback, resolveFor } from '../../lib/engines';
import { InlineNotice } from '../../ui/InlineNotice';
import { AzureSpeechHint } from './AzureSpeechHint';
import { AzureVoiceGroup } from './AzureVoiceGroup';
import { ElevenLabsGroup } from './ElevenLabsGroup';
import { NaturalVoiceGroup } from './NaturalVoiceGroup';
import { WindowsVoiceGroup } from './WindowsVoiceGroup';

type Engine = 'natural' | 'system' | 'elevenlabs' | 'azure';

const ENGINES: readonly SegmentedOption<Engine>[] = [
  { value: 'natural', label: 'Natural voice' },
  { value: 'system', label: 'Windows voices' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'azure', label: 'Azure' },
];

const ENGINE_TEXT: Record<Engine, string> = {
  natural: 'On-device and human-sounding, in English and Hindi. Nothing you hear leaves this PC.',
  system: 'Uses the voices installed in Windows. Works offline.',
  elevenlabs: 'Optional cloud voice. The text of replies is sent to ElevenLabs.',
  azure: 'Neural voices from your Azure Speech resource. The text of replies is sent to Azure.',
};

/** What speaks the replies: the engine, its own settings (a card per engine) and spoken replies on/off. */
export function AssistantVoiceGroup() {
  const view = useView();
  const { voice } = view;
  const setVoice = useSetter('voice');
  const speech = useSettingsStore((state) => state.speech);
  const model = useSettingsStore((state) => state.model);
  const note = describeTtsFallback(view, resolveFor(view, speech, model), speech);

  return (
    <>
      <SettingsGroup title="Assistant voice">
        <ToggleRow
          label="Spoken replies"
          description="Beekeeper reads its answers aloud. Press Esc or the hotkey to interrupt."
          checked={voice.ttsEnabled}
          onChange={(on) => setVoice('ttsEnabled', on)}
        />
        <SettingRow
          stacked
          label="Voice engine"
          description={ENGINE_TEXT[voice.ttsEngine]}
          below={
            voice.ttsEngine === 'azure' || note ? (
              <div className="space-y-2.5">
                {voice.ttsEngine === 'azure' ? <AzureSpeechHint /> : null}
                {note ? <InlineNotice tone={note.tone}>{note.text}</InlineNotice> : null}
              </div>
            ) : undefined
          }
        >
          <Segmented
            label="Voice engine"
            value={voice.ttsEngine}
            options={ENGINES}
            onChange={(engine) => setVoice('ttsEngine', engine)}
          />
        </SettingRow>
      </SettingsGroup>
      {voice.ttsEngine === 'natural' ? <NaturalVoiceGroup /> : null}
      {voice.ttsEngine === 'system' ? <WindowsVoiceGroup /> : null}
      {voice.ttsEngine === 'elevenlabs' ? <ElevenLabsGroup /> : null}
      {voice.ttsEngine === 'azure' ? <AzureVoiceGroup /> : null}
    </>
  );
}
