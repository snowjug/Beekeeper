import type { KeyboardEvent } from 'react';
import { useController, useStudio } from './context';
import { Menu, type MenuEntry } from './Menu';
import { ToolButton } from './ui';

/** Moves focus between the toolbar's buttons with the arrow keys (not inside an open menu). */
function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key) || event.defaultPrevented) return;
  if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
  ];
  const index = buttons.findIndex((button) => button === document.activeElement);
  if (buttons.length === 0 || index < 0) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

/** Edit, Pin to screen, Copy, Share and Save under the picture. */
export function Toolbar({ disabled }: { disabled: boolean }) {
  const controller = useController();
  const actions = useStudio((state) => state.actions);

  const shareEntries: MenuEntry[] = [
    {
      id: 'share-file',
      label: 'Copy as file',
      icon: 'copy',
      onSelect: () => void controller.share('file'),
    },
    {
      id: 'share-open-with',
      label: 'Open with…',
      icon: 'external',
      onSelect: () => void controller.share('openWith'),
    },
    {
      id: 'share-reveal',
      label: 'Show in folder',
      icon: 'folder',
      onSelect: () => void controller.share('reveal'),
    },
    {
      id: 'share-mail',
      label: 'Email…',
      icon: 'mail',
      onSelect: () => void controller.share('mail'),
    },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Screenshot actions"
      onKeyDown={moveFocus}
      className={`bk-glass flex items-center gap-1 rounded-full p-1.5 ${
        disabled ? 'pointer-events-none opacity-50' : ''
      }`}
    >
      <ToolButton
        icon="edit"
        label="Edit"
        status={actions.edit}
        disabled={disabled}
        testId="toolbar-edit"
        onClick={() => controller.enterEdit()}
      />
      <ToolButton
        icon="pin"
        label="Pin to screen"
        status={actions.pin}
        disabled={disabled}
        testId="toolbar-pin"
        onClick={() => void controller.pin()}
      />
      <ToolButton
        icon="copy"
        label="Copy"
        shortcut="Ctrl+C"
        status={actions.copy}
        disabled={disabled}
        testId="toolbar-copy"
        onClick={() => void controller.copy()}
      />
      <Menu
        id="share"
        label="Share"
        placement="top"
        entries={shareEntries}
        trigger={({ open, toggle }) => (
          <ToolButton
            icon="share"
            label="Share"
            status={actions.share}
            disabled={disabled}
            menu={{ open }}
            testId="toolbar-share"
            onClick={toggle}
          />
        )}
      />
      <ToolButton
        icon="download"
        label="Save"
        shortcut="Ctrl+S"
        status={actions.save}
        disabled={disabled}
        testId="toolbar-save"
        onClick={() => void controller.save()}
      />
    </div>
  );
}
