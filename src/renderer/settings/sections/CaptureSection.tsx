import { Button } from '@renderer/components/Button';
import {
  KeyCombo,
  SelectField,
  SettingRow,
  SettingsGroup,
  ToggleRow,
  type SelectOption,
} from '@renderer/components/forms';
import { useController, useSetter, useView } from '../context';
import { validateSaveFolder } from '../lib/validation';
import { TextField } from '../ui/fields';
import { FeatureList, type FeatureItem } from '../ui/FeatureList';
import { InlineNotice } from '../ui/InlineNotice';
import { LinkButton } from '../ui/LinkButton';
import { SectionPage } from '../ui/SectionPage';

const DISMISS_SECONDS: readonly number[] = [0, 5, 10, 20, 30, 60];

/** The fixed choices, plus the saved value when it is not one of them (so it is never shown wrong). */
function dismissOptions(current: number): SelectOption[] {
  const seconds = DISMISS_SECONDS.includes(current)
    ? DISMISS_SECONDS
    : [...DISMISS_SECONDS, current].sort((a, b) => a - b);
  return seconds.map((value) => ({
    value: String(value),
    label: value === 0 ? 'Never' : `${value} seconds`,
  }));
}

const STEPS: readonly FeatureItem[] = [
  { icon: 'edit', title: 'Edit', text: 'Mark up the screenshot right in the preview.' },
  {
    icon: 'pin',
    title: 'Pin to screen',
    text: 'Keep it floating above your windows while you work.',
  },
  { icon: 'copy', title: 'Copy', text: 'Put the image on the clipboard to paste anywhere.' },
  {
    icon: 'external',
    title: 'Share',
    text: 'Open it in another app, show it in its folder or attach it to an email.',
  },
  { icon: 'download', title: 'Save', text: 'Keep it as a file in your screenshots folder.' },
  {
    icon: 'sparkle',
    title: 'Photo assist',
    text: 'Extract the text in the picture, or hide sensitive information such as emails and card numbers before you share it.',
  },
];

export function CaptureSection() {
  const controller = useController();
  const view = useView();
  const { capture } = view;
  const setCapture = useSetter('capture');
  const goesNowhere = !capture.openStudio && !capture.autoSave && !capture.autoCopy;

  return (
    <SectionPage section="capture">
      <SettingsGroup title="After you capture">
        <ToggleRow
          label="Open the preview"
          description="Shows the screenshot in Capture Studio so you can mark it up, pin it or share it."
          checked={capture.openStudio}
          onChange={(on) => setCapture('openStudio', on)}
          below={
            goesNowhere ? (
              <InlineNotice tone="warning">
                The preview, saving and copying are all off, so a screenshot would be thrown away.
                Turn one of them on.
              </InlineNotice>
            ) : undefined
          }
        />
        <ToggleRow
          label="Glow frame"
          description="A softly flowing gradient glow around the preview."
          checked={capture.glowFrame}
          disabled={!capture.openStudio}
          onChange={(on) => setCapture('glowFrame', on)}
        />
        <ToggleRow
          label="Save automatically"
          description="Every screenshot goes to the folder below right away."
          checked={capture.autoSave}
          onChange={(on) => setCapture('autoSave', on)}
        />
        <ToggleRow
          label="Copy automatically"
          description="Every screenshot is also copied to the clipboard."
          checked={capture.autoCopy}
          onChange={(on) => setCapture('autoCopy', on)}
        />
        <ToggleRow
          label="Shutter sound"
          description="A short click when you capture. It follows the Sound effects switch under Voice."
          checked={capture.shutterSound}
          onChange={(on) => setCapture('shutterSound', on)}
          below={
            capture.shutterSound && !view.voice.earcons ? (
              <InlineNotice
                action={
                  <LinkButton onClick={() => controller.navigate('voice')}>Open Voice</LinkButton>
                }
              >
                Sound effects are off, so you will not hear it.
              </InlineNotice>
            ) : undefined
          }
        />
        <SettingRow
          label="Close the preview by itself"
          description="After this long without a click or key press. Never keeps it open until you close it."
        >
          <SelectField
            label="Close the preview by itself"
            value={String(capture.dismissAfterSeconds)}
            options={dismissOptions(capture.dismissAfterSeconds)}
            onChange={(seconds) => setCapture('dismissAfterSeconds', Number(seconds))}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Saving">
        <SettingRow
          stacked
          label="Screenshots folder"
          description="Where saved screenshots go. Leave it empty to use Pictures\Beekeeper."
        >
          <TextField
            label="Screenshots folder"
            value={capture.saveFolder}
            placeholder="Pictures\Beekeeper"
            fullWidth
            mono
            debounceMs={0}
            validate={validateSaveFolder}
            onCommit={(folder) => setCapture('saveFolder', folder)}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Shortcut">
        <SettingRow
          label="Take a screenshot"
          description="Press it from any app to capture the screen you are on."
        >
          <div className="flex items-center gap-3">
            <KeyCombo accelerator={view.hotkeys.capture} />
            <LinkButton icon="chevron-right" onClick={() => controller.navigate('hotkeys')}>
              Change shortcut
            </LinkButton>
          </div>
        </SettingRow>
        <SettingRow
          label="Try it"
          description="Takes a screenshot now and opens it the way you set up above."
        >
          <Button
            size="sm"
            icon="screenshot"
            onClick={() =>
              void controller.run('Could not take the screenshot', (bridge) =>
                bridge.invoke('capture:start', {}),
              )
            }
          >
            Take a screenshot now
          </Button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="How it works">
        <FeatureList items={STEPS} />
      </SettingsGroup>
    </SectionPage>
  );
}
