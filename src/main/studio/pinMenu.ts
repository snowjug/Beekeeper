import type { PinInfo } from '@shared/ipc/types';

export interface PinMenuItem {
  label?: string;
  type?: 'normal' | 'separator' | 'checkbox' | 'radio';
  checked?: boolean;
  click?: () => void;
  submenu?: PinMenuItem[];
}

export interface PinMenuActions {
  copy(): void;
  save(): void;
  setOpacity(value: number): void;
  setScale(value: number): void;
  toggleClickThrough(): void;
  close(): void;
  closeAll(): void;
}

const OPACITIES = [1, 0.75, 0.5, 0.25] as const;
const SCALES = [0.25, 0.5, 1, 2] as const;
const SEPARATOR: PinMenuItem = { type: 'separator' };

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** The right-click menu of a pin, as plain data: Electron turns it into a native menu. */
export function buildPinMenu(
  info: PinInfo,
  actions: PinMenuActions,
  pinCount: number,
): PinMenuItem[] {
  const items: PinMenuItem[] = [
    { label: 'Copy image', click: () => actions.copy() },
    { label: 'Save image', click: () => actions.save() },
    SEPARATOR,
    {
      label: 'Opacity',
      submenu: OPACITIES.map((value) => ({
        label: percent(value),
        type: 'radio',
        checked: Math.abs(info.opacity - value) < 0.02,
        click: () => actions.setOpacity(value),
      })),
    },
    {
      label: `Size (${percent(info.scale)})`,
      submenu: SCALES.map((value) => ({
        label: value === 1 ? 'Actual size (100%)' : percent(value),
        type: 'radio',
        checked: Math.abs(info.scale - value) < 0.01,
        click: () => actions.setScale(value),
      })),
    },
    {
      label: 'Let clicks pass through',
      type: 'checkbox',
      checked: info.clickThrough,
      click: () => actions.toggleClickThrough(),
    },
    SEPARATOR,
    { label: 'Close pin', click: () => actions.close() },
  ];
  if (pinCount > 1)
    items.push({ label: `Close all ${pinCount} pins`, click: () => actions.closeAll() });
  return items;
}
