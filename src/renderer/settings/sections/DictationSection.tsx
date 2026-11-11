import {
  KeyCombo,
  SelectField,
  SettingRow,
  SettingsGroup,
  ToggleRow,
  type SelectOption,
} from '@renderer/components/forms';
import { useController, useSetter, useSettingsStore, useView } from '../context';
import { describeDictationNotice, resolveFor } from '../lib/engines';
import { SliderField } from '../ui/fields';
import { FeatureList, type FeatureItem } from '../ui/FeatureList';
import { InlineNotice } from '../ui/InlineNotice';
import { LinkButton } from '../ui/LinkButton';
import { SectionPage } from '../ui/SectionPage';

const LANGUAGES: readonly SelectOption[] = [
  { value: 'inherit', label: 'Same as Voice' },
  { value: 'auto', label: 'Auto (English + Hindi)' },
  { value: 'en', label: 'English (India)' },
  { value: 'hi', label: 'Hindi' },
];

const METHODS: readonly SelectOption[] = [
  { value: 'type', label: 'Type with the keyboard' },
  { value: 'paste', label: 'Paste' },
];

function isLanguage(value: string): value is 'inherit' | 'auto' | 'en' | 'hi' {
  return LANGUAGES.some((language) => language.value === value);
}

function isMethod(value: string): value is 'type' | 'paste' {
  return METHODS.some((method) => method.value === value);
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}

const STEPS: readonly FeatureItem[] = [
  {
    icon: 'edit',
    title: 'Click where the text should go',
    text: 'Any text box in any app: a document, a chat, a web page.',
  },
  {
    icon: 'mic',
    title: 'Press the shortcut and talk',
    text: 'A small bar shows that Beekeeper is listening.',
  },
  {
    icon: 'check',
    title: 'Pause when you are done',
    text: 'After the silence set above Beekeeper stops listening and enters what you said.',
  },
  {
    icon: 'sparkle',
    title: 'Say the punctuation',
    text: 'Say “comma”, “full stop” or “new line” and Beekeeper types the symbol. Hindi words work too.',
  },
];

export function DictationSection() {
  const controller = useController();
  const view = useView();
  const { dictation } = view;
  const setDictation = useSetter('dictation');
  const speech = useSettingsStore((state) => state.speech);
  const model = useSettingsStore((state) => state.model);
  const notice = describeDictationNotice(view, resolveFor(view, speech, model));

  return (
    <SectionPage section="dictation">
      <SettingsGroup title="Dictation anywhere">
        <ToggleRow
          label="Dictation"
          description="Press the shortcut in any app, speak, and Beekeeper types what you said. Turn it off to free the shortcut."
          checked={dictation.enabled}
          onChange={(on) => setDictation('enabled', on)}
          below={
            notice ? (
              <InlineNotice
                tone={notice.tone}
                action={
                  <LinkButton onClick={() => controller.navigate('voice')}>Open Voice</LinkButton>
                }
              >
                {notice.text}
              </InlineNotice>
            ) : undefined
          }
        />
        <SettingRow
          label="Language"
          description="Same as Voice follows the language you chose under Voice. Pick one here to dictate in another language."
        >
          <SelectField
            label="Dictation language"
            value={dictation.language}
            options={LANGUAGES}
            onChange={(language) => {
              if (isLanguage(language)) setDictation('language', language);
            }}
          />
        </SettingRow>
        <SettingRow
          label="How the text is entered"
          description="Typing works in every app. Paste is faster for long text, but it uses the clipboard."
        >
          <SelectField
            label="How the text is entered"
            value={dictation.method}
            options={METHODS}
            onChange={(method) => {
              if (isMethod(method)) setDictation('method', method);
            }}
          />
        </SettingRow>
        <SettingRow
          label="Stop after silence"
          description="How long you can pause before dictation stops and enters your words."
        >
          <SliderField
            label="Stop after silence"
            value={dictation.silenceSeconds}
            min={0.8}
            max={8}
            step={0.1}
            format={formatSeconds}
            onCommit={(seconds) => setDictation('silenceSeconds', Math.round(seconds * 10) / 10)}
          />
        </SettingRow>
        <ToggleRow
          label="Spoken punctuation"
          description="Turns “comma”, “full stop” and “new line” (and the Hindi words) into the symbols."
          checked={dictation.spokenPunctuation}
          onChange={(on) => setDictation('spokenPunctuation', on)}
        />
      </SettingsGroup>

      <SettingsGroup title="Shortcut">
        <SettingRow
          label="Start dictating"
          description="Press it from any app, then start talking."
        >
          <div className="flex items-center gap-3">
            <KeyCombo accelerator={view.hotkeys.dictation} />
            <LinkButton icon="chevron-right" onClick={() => controller.navigate('hotkeys')}>
              Change shortcut
            </LinkButton>
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="How it works">
        <FeatureList items={STEPS} />
      </SettingsGroup>
    </SectionPage>
  );
}
