import { Card } from '@renderer/components/Card';
import type { IconName } from '@renderer/components/Icon';
import type { HotkeyStatusEntry } from '@shared/ipc/types';
import { KeyCaps } from './KeyCaps';
import { Notice } from './Notice';
import { Pill } from './Pill';

export interface HotkeyCardProps {
  /** Stagger index of the card entrance. */
  index: number;
  icon: IconName;
  title: string;
  description: string;
  accelerator: string;
  /** Registration result; undefined while unknown (no badge then). */
  status: HotkeyStatusEntry | undefined;
}

/** One global shortcut: animated key caps, what it does and whether Windows accepted it. */
export function HotkeyCard({
  index,
  icon,
  title,
  description,
  accelerator,
  status,
}: HotkeyCardProps) {
  return (
    <Card
      index={index}
      lift={false}
      icon={icon}
      title={title}
      headerActions={
        status ? (
          <Pill tone={status.registered ? 'good' : 'bad'} size="sm">
            {status.registered ? 'Ready' : 'Not active'}
          </Pill>
        ) : undefined
      }
      className="flex-1 text-left"
    >
      <div className="flex flex-col items-start gap-2.5 px-4 pt-1.5 pb-4">
        <KeyCaps accelerator={accelerator} delay={0.3 + index * 0.25} />
        <p className="text-[13px] leading-snug text-fg-muted">{description}</p>
        {status && !status.registered ? (
          <Notice tone="bad" role="status" compact>
            Taken by another app — change it in Settings &gt; Hotkeys
          </Notice>
        ) : null}
      </div>
    </Card>
  );
}
