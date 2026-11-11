import {
  KeyCombo,
  SelectField,
  SettingRow,
  SettingsGroup,
  type SelectOption,
} from '@renderer/components/forms';
import { useController, useSetter, useView } from '../context';
import { FeatureList, type FeatureItem } from '../ui/FeatureList';
import { LinkButton } from '../ui/LinkButton';
import { SectionPage } from '../ui/SectionPage';

const ACTIONS: readonly SelectOption[] = [
  { value: 'show', label: 'Show the results' },
  { value: 'copy', label: 'Copy the text' },
  { value: 'search', label: 'Search the web' },
  { value: 'translate', label: 'Translate the text' },
];

const GESTURES: readonly FeatureItem[] = [
  { icon: 'circle', title: 'Circle', text: 'Draw a loop around anything on screen.' },
  { icon: 'edit', title: 'Scribble', text: 'Scribble over it, or drag a box.' },
  { icon: 'search', title: 'Tap', text: 'Tap a single word or line to pick just that.' },
  { icon: 'close', title: 'Esc', text: 'Press Esc or right-click to cancel.' },
];

function isAction(value: string): value is 'show' | 'copy' | 'search' | 'translate' {
  return ACTIONS.some((action) => action.value === value);
}

export function CircleSection() {
  const controller = useController();
  const view = useView();
  const setCircle = useSetter('circle');

  return (
    <SectionPage section="circle">
      <SettingsGroup title="Behavior">
        <SettingRow
          label="After you circle something"
          description="Beekeeper reads the text in your selection, then does this."
        >
          <SelectField
            label="Default action"
            value={view.circle.defaultAction}
            options={ACTIONS}
            onChange={(value) => {
              if (isAction(value)) setCircle('defaultAction', value);
            }}
          />
        </SettingRow>
        <SettingRow
          label="Shortcut"
          description="Press it from any app to freeze the screen and start circling."
        >
          <div className="flex items-center gap-3">
            <KeyCombo accelerator={view.hotkeys.circle} />
            <LinkButton icon="chevron-right" onClick={() => controller.navigate('hotkeys')}>
              Change shortcut
            </LinkButton>
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="How it works">
        <FeatureList items={GESTURES} />
      </SettingsGroup>
    </SectionPage>
  );
}
