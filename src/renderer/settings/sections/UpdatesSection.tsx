import { Button } from '@renderer/components/Button';
import { SettingsGroup, StatusPill, ToggleRow } from '@renderer/components/forms';
import { useController, useSettingsStore, useSetter, useView } from '../context';
import { describeUpdate } from '../lib/describe';
import { RELEASES_URL } from '../lib/links';
import { InlineNotice } from '../ui/InlineNotice';
import { LinkButton } from '../ui/LinkButton';
import { ProgressBar } from '../ui/ProgressBar';
import { SectionPage } from '../ui/SectionPage';

export function UpdatesSection() {
  const controller = useController();
  const { updates } = useView();
  const setUpdates = useSetter('updates');
  const info = useSettingsStore((state) => state.info);
  const state = useSettingsStore((store) => store.updates);
  const portable = info?.portable ?? false;
  const summary = describeUpdate(state, { autoUpdate: updates.autoUpdate });

  return (
    <SectionPage section="updates">
      <SettingsGroup title="Status">
        <div className="px-4 py-3.5">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] leading-5 font-medium text-fg">
                  Beekeeper {info?.version ?? ''}
                </span>
                <StatusPill tone={summary.tone}>{summary.label}</StatusPill>
              </div>
              <p role="status" className="mt-0.5 text-[12.5px] leading-[18px] text-fg-muted">
                {summary.detail}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {summary.canInstall ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon="restart"
                  onClick={() =>
                    void controller.run('Could not restart Beekeeper', (bridge) =>
                      bridge.invoke('updates:install'),
                    )
                  }
                >
                  Restart to update
                </Button>
              ) : null}
              <Button
                size="sm"
                icon="refresh"
                disabled={!summary.canCheck}
                onClick={() => void controller.checkForUpdates()}
              >
                {state.status === 'checking' ? 'Checking...' : 'Check for updates'}
              </Button>
            </div>
          </div>
          {summary.progress !== null ? (
            <div className="mt-3">
              <ProgressBar value={summary.progress} label="Update download" />
            </div>
          ) : null}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Preferences">
        <ToggleRow
          label="Update automatically"
          description={
            portable
              ? 'Portable builds do not update themselves.'
              : 'Check in the background and download new versions. You choose when to restart.'
          }
          checked={updates.autoUpdate}
          disabled={portable}
          onChange={(on) => setUpdates('autoUpdate', on)}
        />
      </SettingsGroup>

      {portable ? (
        <InlineNotice
          action={
            <LinkButton icon="external" onClick={() => void controller.openExternal(RELEASES_URL)}>
              Open the releases page
            </LinkButton>
          }
        >
          This is the portable build, which does not update itself. Download the newest version from
          GitHub whenever you want to update.
        </InlineNotice>
      ) : null}
    </SectionPage>
  );
}
