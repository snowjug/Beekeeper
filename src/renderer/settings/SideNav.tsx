import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@renderer/components/Icon';
import { spring } from '@renderer/motion/tokens';
import { nextTabIndex, PANEL_ID, SECTIONS, tabId, type SettingsPage } from './lib/nav';

export interface SideNavProps {
  section: SettingsPage;
  onSelect: (section: SettingsPage) => void;
}

function indexOfSection(section: SettingsPage): number {
  return Math.max(
    0,
    SECTIONS.findIndex((entry) => entry.id === section),
  );
}

/**
 * Vertical tab list with roving tabindex: Tab enters it once, arrow keys / Home / End move the
 * focus and Enter or Space activate the focused section. The active indicator glides between items.
 */
export function SideNav({ section, onSelect }: SideNavProps) {
  const [focusIndex, setFocusIndex] = useState(() => indexOfSection(section));
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setFocusIndex(indexOfSection(section));
  }, [section]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const next = nextTabIndex(index, event.key, SECTIONS.length);
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    tabs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label="Settings sections"
      className="flex w-[232px] shrink-0 flex-col gap-0.5 px-3 pb-4"
    >
      {SECTIONS.map((item, index) => {
        const selected = item.id === section;
        return (
          <button
            key={item.id}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            id={tabId(item.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={PANEL_ID}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onSelect(item.id)}
            onFocus={() => setFocusIndex(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className="relative flex h-10 items-center gap-3 rounded-control px-3 text-left text-[14px] transition-colors duration-[var(--bk-dur-fast)] hover:bg-raised"
          >
            {selected ? (
              <motion.span
                aria-hidden
                layoutId="settings-nav-indicator"
                transition={spring.snappy}
                className="absolute inset-0 rounded-control bg-raised-hover"
              >
                <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-accent" />
              </motion.span>
            ) : null}
            <span className={`relative ${selected ? 'text-accent-text' : 'text-fg-muted'}`}>
              <Icon name={item.icon} size={18} />
            </span>
            <span
              className={`relative ${selected ? 'font-semibold text-fg' : 'font-medium text-fg-muted'}`}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
