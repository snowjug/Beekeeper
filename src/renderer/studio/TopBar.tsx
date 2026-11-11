import { useController, useStudio } from './context';
import { Menu, type MenuEntry } from './Menu';
import { Pill, ToolButton } from './ui';

/** Photo assist, Set as wallpaper and the more menu above the picture. */
export function TopBar() {
  const controller = useController();
  const wallpaper = useStudio((state) => state.actions.wallpaper);
  const assist = useStudio((state) => state.actions.assist);

  const assistEntries: MenuEntry[] = [
    {
      id: 'extract-text',
      label: 'Extract text',
      icon: 'note',
      onSelect: () => void controller.extractText(),
    },
    {
      id: 'hide-sensitive',
      label: 'Hide sensitive info',
      icon: 'shield',
      onSelect: () => void controller.hideSensitive(),
    },
  ];

  const moreEntries: MenuEntry[] = [
    {
      id: 'save-as',
      label: 'Save as…',
      icon: 'download',
      onSelect: () => void controller.save(true),
    },
    {
      id: 'open-folder',
      label: 'Open screenshots folder',
      icon: 'folder',
      onSelect: () => void controller.openFolder(),
    },
    {
      id: 'delete',
      label: 'Delete screenshot',
      icon: 'trash-can',
      tone: 'danger',
      onSelect: () => void controller.deleteScreenshot(),
    },
    {
      id: 'capture-again',
      label: 'Capture again',
      icon: 'screenshot',
      onSelect: () => void controller.recapture(),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: 'settings',
      onSelect: () => void controller.openSettings(),
    },
  ];

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Menu
          id="assist"
          label="Photo assist"
          placement="bottom-start"
          entries={assistEntries}
          trigger={({ open, toggle }) => (
            <Pill
              icon="sparkle"
              busy={assist === 'busy'}
              menu={{ open }}
              testId="pill-assist"
              onClick={toggle}
            >
              Photo assist
            </Pill>
          )}
        />
        <Pill
          busy={wallpaper === 'busy'}
          testId="pill-wallpaper"
          onClick={() => void controller.setWallpaper()}
        >
          Set as wallpaper
        </Pill>
      </div>
      <Menu
        id="more"
        label="More options"
        placement="bottom-end"
        entries={moreEntries}
        trigger={({ open, toggle }) => (
          <div className="bk-glass rounded-full">
            <ToolButton
              icon="more"
              label="More options"
              size="md"
              menu={{ open }}
              testId="button-more"
              onClick={toggle}
            />
          </div>
        )}
      />
    </div>
  );
}
