import { SettingsGroup } from '@renderer/components/forms';
import { SectionPage } from '../ui/SectionPage';
import { HotkeyRow } from './HotkeyRow';

export function HotkeysSection() {
  return (
    <SectionPage section="hotkeys">
      <SettingsGroup
        title="Global shortcuts"
        footer="Shortcuts work from any app. Use Ctrl, Alt or Win with another key: Shift with just a letter would get in the way of typing."
      >
        <HotkeyRow
          id="assistant"
          label="Assistant"
          description="Open or close the assistant bar and start listening."
        />
        <HotkeyRow
          id="circle"
          label="Circle to Search"
          description="Freeze the screen and circle anything to read, copy, translate or search it."
        />
      </SettingsGroup>
    </SectionPage>
  );
}
