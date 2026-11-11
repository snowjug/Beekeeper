import type { ReactNode } from 'react';
import { Icon, type IconName } from '@renderer/components/Icon';

export interface FeatureItem {
  icon: IconName;
  title: string;
  text: ReactNode;
}

/** A short "how it works" list: round icon, bold title and one line of explanation per item. */
export function FeatureList({ items }: { items: readonly FeatureItem[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <li key={item.title} className="flex items-center gap-3 px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken text-accent-text">
            <Icon name={item.icon} size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] leading-5 font-medium text-fg">{item.title}</p>
            <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-muted">{item.text}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
