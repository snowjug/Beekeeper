import { SettingsGroup } from '@renderer/components/forms';
import { modelManifest } from '@shared/models';
import { LICENSE_URL } from '../../lib/links';
import { useController } from '../../context';
import { LinkButton } from '../../ui/LinkButton';
import { MIT_EXCERPT, THIRD_PARTY_NOTICES } from './notices';

export function LicenseCard() {
  const controller = useController();
  return (
    <SettingsGroup
      title="License"
      footer={
        <LinkButton icon="external" onClick={() => void controller.openExternal(LICENSE_URL)}>
          Read the full license
        </LinkButton>
      }
    >
      <div
        data-selectable="true"
        className="space-y-2 px-4 py-3 text-[12px] leading-[18px] text-fg-muted"
      >
        {MIT_EXCERPT.map((paragraph, index) => (
          <p key={index} className={index === 0 ? 'font-semibold text-fg' : undefined}>
            {paragraph}
          </p>
        ))}
      </div>
    </SettingsGroup>
  );
}

export function ThirdPartyNotices() {
  return (
    <SettingsGroup
      title="Third-party notices"
      footer={`Plus the ${modelManifest.license}-licensed Vosk speech model and other open-source packages listed in the project's package-lock.json. Thank you to every maintainer.`}
    >
      <ul className="divide-y divide-line">
        {THIRD_PARTY_NOTICES.map((notice) => (
          <li key={notice.name} className="flex items-center justify-between gap-4 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[13.5px] leading-5 font-medium text-fg">{notice.name}</p>
              <p className="text-[12px] leading-4 text-fg-muted">{notice.use}</p>
            </div>
            <span className="shrink-0 text-[12.5px] font-medium text-fg-muted">
              {notice.license}
            </span>
          </li>
        ))}
      </ul>
    </SettingsGroup>
  );
}
