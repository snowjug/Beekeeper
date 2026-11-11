import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '@renderer/components/Icon';
import { spring, tween } from '@renderer/motion/tokens';
import { useController, useStudio } from './context';
import type { MenuId } from './store';

export interface MenuEntry {
  id: string;
  label: string;
  icon: IconName;
  tone?: 'danger';
  /** Entries that do not apply are left out. */
  hidden?: boolean;
  onSelect: () => void;
}

export type MenuPlacement = 'bottom-start' | 'bottom-end' | 'top';

const PLACEMENT: Record<MenuPlacement, string> = {
  'bottom-start': 'left-0 top-[calc(100%+10px)]',
  'bottom-end': 'right-0 top-[calc(100%+10px)]',
  top: 'left-1/2 bottom-[calc(100%+14px)] -translate-x-1/2',
};

export interface MenuProps {
  id: MenuId;
  /** Accessible name of the menu. */
  label: string;
  entries: readonly MenuEntry[];
  placement: MenuPlacement;
  /** Draws the button that opens the menu. */
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
}

/** A trigger button with a popup menu: arrow keys move, Esc or a click outside closes it. */
export function Menu({ id, label, entries, placement, trigger }: MenuProps) {
  const controller = useController();
  const open = useStudio((state) => state.menu === id);
  const wrapper = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const visible = entries.filter((entry) => !entry.hidden);

  // Focus moves into the menu when it opens and back to its button when it closes.
  useEffect(() => {
    const root = wrapper.current;
    if (!root) return;
    if (open) {
      root.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    } else if (wasOpen.current) {
      const active = document.activeElement;
      if (active === document.body || root.contains(active)) {
        root.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
      }
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) {
        controller.closeMenu();
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [controller, open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const index = items.findIndex((item) => item === document.activeElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab') controller.closeMenu();
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus();
    }
  };

  return (
    <div ref={wrapper} className="relative">
      {trigger({ open, toggle: () => controller.toggleMenu(id) })}
      <AnimatePresence>
        {open ? (
          <div key="menu" className={`absolute z-30 ${PLACEMENT[placement]}`}>
            <motion.div
              role="menu"
              aria-label={label}
              tabIndex={-1}
              onKeyDown={onKeyDown}
              className="bk-glass w-max min-w-[220px] max-w-[340px] rounded-card p-1.5"
              initial={{ opacity: 0, scale: 0.96, y: placement === 'top' ? 6 : -6 }}
              animate={{ opacity: 1, scale: 1, y: 0, transition: spring.snappy }}
              exit={{ opacity: 0, scale: 0.97, transition: tween.fast }}
            >
              {visible.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  data-testid={`menu-${entry.id}`}
                  className={`flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left text-[14px] font-medium transition-colors duration-[var(--bk-dur-fast)] hover:bg-raised-hover focus-visible:bg-raised-hover ${
                    entry.tone === 'danger' ? 'text-danger' : 'text-fg'
                  }`}
                  onClick={() => {
                    controller.closeMenu();
                    entry.onSelect();
                  }}
                >
                  <span className={entry.tone === 'danger' ? '' : 'text-accent-text'}>
                    <Icon name={entry.icon} size={19} />
                  </span>
                  {entry.label}
                </button>
              ))}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
