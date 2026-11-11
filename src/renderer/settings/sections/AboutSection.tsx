import { Button } from '@renderer/components/Button';
import { SettingRow, SettingsGroup } from '@renderer/components/forms';
import { useController, useSettingsStore } from '../context';
import { ISSUES_URL, REPO_URL } from '../lib/links';
import { BrandMark } from '../ui/BrandMark';
import { SectionPage } from '../ui/SectionPage';
import { LicenseCard, ThirdPartyNotices } from './about/Legal';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="text-[13px] text-fg-muted">{label}</dt>
      <dd data-selectable="true" className="text-[13px] font-medium text-fg tabular-nums">
        {value}
      </dd>
    </div>
  );
}

export function AboutSection() {
  const controller = useController();
  const info = useSettingsStore((state) => state.info);

  return (
    <SectionPage section="about">
      <div className="bk-glass-card flex items-center gap-5 rounded-card px-6 py-5">
        <BrandMark size={72} title="Beekeeper logo" />
        <div className="min-w-0">
          <p className="bk-brand-text w-fit font-display text-[28px] leading-9 font-semibold">
            Beekeeper
          </p>
          <p className="text-[13px] leading-5 font-medium text-fg-muted">
            Version {info?.version ?? '...'}
          </p>
          <p className="mt-1 text-[13px] leading-5 text-fg">
            A voice-first desktop assistant for Windows with Circle to Search.
          </p>
        </div>
      </div>

      <SettingsGroup title="Details">
        <dl className="divide-y divide-line">
          <Fact label="Version" value={info?.version ?? '...'} />
          <Fact label="Electron" value={info?.electron ?? '...'} />
          <Fact label="Chromium" value={info?.chrome ?? '...'} />
          {info && info.osBuild > 0 ? (
            <Fact label="Windows build" value={String(info.osBuild)} />
          ) : null}
        </dl>
        <SettingRow
          label="Data folder"
          description={
            <span data-selectable="true" className="font-mono text-[12px] break-all">
              {info?.userDataPath ?? '...'}
            </span>
          }
        >
          <Button
            size="sm"
            icon="copy"
            disabled={!info}
            onClick={() => info && void controller.copyText(info.userDataPath, 'Path')}
          >
            Copy path
          </Button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Links">
        <SettingRow label="Source code" description="github.com/snowjug/Beekeeper">
          <Button size="sm" icon="external" onClick={() => void controller.openExternal(REPO_URL)}>
            Open on GitHub
          </Button>
        </SettingRow>
        <SettingRow
          label="Report an issue"
          description="Something not working or missing? Tell us what happened."
        >
          <Button
            size="sm"
            icon="external"
            onClick={() => void controller.openExternal(ISSUES_URL)}
          >
            Report an issue
          </Button>
        </SettingRow>
      </SettingsGroup>

      <LicenseCard />
      <ThirdPartyNotices />
    </SectionPage>
  );
}
