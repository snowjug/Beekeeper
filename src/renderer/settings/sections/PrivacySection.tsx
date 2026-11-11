import { useEffect, useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';
import { SettingRow, SettingsGroup, ToggleRow } from '@renderer/components/forms';
import { showToast } from '@renderer/components/Toast';
import { useController, useSetter, useView } from '../context';
import { pluralize } from '../lib/format';
import { ConfirmButton } from '../ui/ConfirmButton';
import { SectionPage } from '../ui/SectionPage';
import { NetworkList } from './privacy/NetworkList';

export function PrivacySection() {
  const controller = useController();
  const { privacy } = useView();
  const setPrivacy = useSetter('privacy');
  const [historyCount, setHistoryCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    controller.bridge
      .invoke('assistant:history', { limit: 1 })
      .then((list) => {
        if (alive) setHistoryCount(list.total);
      })
      .catch((error: unknown) => controller.report('assistant:history', error));
    return () => {
      alive = false;
    };
  }, [controller]);

  const clearHistory = async (): Promise<void> => {
    const cleared = await controller.run('Could not clear the history', (bridge) =>
      bridge.invoke('assistant:clearHistory'),
    );
    if (cleared === undefined) return;
    setHistoryCount(0);
    showToast({ title: `Cleared ${pluralize(cleared, 'item')}`, tone: 'success' });
  };

  const clearNotes = async (): Promise<void> => {
    const cleared = await controller.run('Could not clear the notes', (bridge) =>
      bridge.invoke('privacy:clearNotes'),
    );
    if (cleared === undefined) return;
    showToast({ title: `Cleared ${pluralize(cleared, 'note')}`, tone: 'success' });
  };

  return (
    <SectionPage section="privacy">
      <div className="bk-glass-card flex items-start gap-3 rounded-card px-4 py-3.5">
        <span className="mt-0.5 text-success">
          <Icon name="shield" size={20} />
        </span>
        <div>
          <p className="text-[14px] leading-5 font-semibold text-fg">
            Beekeeper has no telemetry: nothing is collected or sent about you.
          </p>
          <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-muted">
            No analytics, no crash reports, no accounts. It works offline; the few things that use
            the internet are listed below.
          </p>
        </div>
      </div>

      <SettingsGroup title="Your data">
        <ToggleRow
          label="Save conversation history"
          description="Keeps your last 200 requests on this PC so the Up arrow can recall them. Turn off to stop saving new ones."
          checked={privacy.saveHistory}
          onChange={(on) => setPrivacy('saveHistory', on)}
        />
        <SettingRow
          label="Clear history"
          description={
            historyCount === null
              ? 'Deletes every saved conversation on this PC.'
              : `Deletes ${pluralize(historyCount, 'saved conversation')} from this PC.`
          }
        >
          <ConfirmButton
            label="Clear history"
            confirmLabel="Yes, clear it"
            icon="trash-can"
            disabled={historyCount === 0}
            onConfirm={clearHistory}
          />
        </SettingRow>
        <SettingRow
          label="Clear notes"
          description="Deletes every note you asked Beekeeper to take."
        >
          <ConfirmButton
            label="Clear notes"
            confirmLabel="Yes, clear them"
            icon="trash-can"
            onConfirm={clearNotes}
          />
        </SettingRow>
        <SettingRow
          label="Logs"
          description="A small rotating log on this PC helps fix problems. Keys and tokens are never written to it."
        >
          <Button
            size="sm"
            icon="external"
            onClick={() =>
              void controller.run('Could not open the logs folder', (bridge) =>
                bridge.invoke('privacy:openLogs'),
              )
            }
          >
            Open logs folder
          </Button>
        </SettingRow>
      </SettingsGroup>

      <NetworkList />
    </SectionPage>
  );
}
