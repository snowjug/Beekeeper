import type { ReactNode } from 'react';
import { Icon, type IconName } from '@renderer/components/Icon';
import {
  KeyCombo,
  SelectField,
  SettingRow,
  SettingsGroup,
  type SelectOption,
} from '@renderer/components/forms';
import { useController, useSetter, useView } from '../context';
import { LinkButton } from '../ui/LinkButton';
import { SectionPage } from '../ui/SectionPage';

const ACTIONS: readonly SelectOption[] = [
  { value: 'show', label: 'Show the results' },
  { value: 'copy', label: 'Copy the text' },
  { value: 'search', label: 'Search the web' },
  { value: 'translate', label: 'Translate the text' },
];

interface Gesture {
  icon: IconName;
  title: string;
  text: ReactNode;
}

const GESTURES: readonly Gesture[] = [
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
        <ul className="divide-y divide-line">
          {GESTURES.map((gesture) => (
            <li key={gesture.title} className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken text-accent-text">
                <Icon name={gesture.icon} size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] leading-5 font-medium text-fg">{gesture.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-muted">{gesture.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </SettingsGroup>
    </SectionPage>
  );
}
