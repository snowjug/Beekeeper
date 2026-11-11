import { AnimatePresence } from 'framer-motion';
import { useRef, type ComponentType } from 'react';
import { Button } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';
import { ToastHost } from '@renderer/components/Toast';
import { useController, useSettingsStore } from './context';
import { PANEL_ID, tabId, type SettingsPage } from './lib/nav';
import { AboutSection } from './sections/AboutSection';
import { AiSection } from './sections/AiSection';
import { CaptureSection } from './sections/CaptureSection';
import { CircleSection } from './sections/CircleSection';
import { DictationSection } from './sections/DictationSection';
import { GeneralSection } from './sections/GeneralSection';
import { HotkeysSection } from './sections/HotkeysSection';
import { PrivacySection } from './sections/PrivacySection';
import { UpdatesSection } from './sections/UpdatesSection';
import { VoiceSection } from './sections/VoiceSection';
import { SideNav } from './SideNav';
import { TitleStrip } from './TitleStrip';
import { SettingsSkeleton } from './ui/Skeleton';

const SECTION_VIEWS: Record<SettingsPage, ComponentType> = {
  general: GeneralSection,
  voice: VoiceSection,
  hotkeys: HotkeysSection,
  circle: CircleSection,
  capture: CaptureSection,
  dictation: DictationSection,
  ai: AiSection,
  privacy: PrivacySection,
  updates: UpdatesSection,
  about: AboutSection,
};

function LoadFailed() {
  const controller = useController();
  const message = useSettingsStore((state) => state.loadError);
  return (
    <div
      role="alert"
      className="bk-glass-card mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-card p-8 text-center"
    >
      <span className="text-danger">
        <Icon name="error" size={28} />
      </span>
      <h1 className="font-display text-[18px] font-semibold text-fg">
        Could not load your settings
      </h1>
      <p className="text-[13px] leading-5 text-fg-muted">
        {message ?? 'Something went wrong while reading them.'} Your saved settings were not
        changed.
      </p>
      <Button variant="primary" icon="refresh" onClick={() => void controller.load()}>
        Try again
      </Button>
    </div>
  );
}

/** Settings window: draggable title strip, section navigation and the animated page. */
export function App() {
  const controller = useController();
  const phase = useSettingsStore((state) => state.phase);
  const section = useSettingsStore((state) => state.section);
  const material = useSettingsStore((state) => state.info?.material);
  const scroller = useRef<HTMLElement>(null);
  const SectionView = SECTION_VIEWS[section];

  return (
    <div
      className={`flex h-full flex-col text-fg ${material === 'none' ? 'bg-surface-solid' : ''}`}
    >
      <TitleStrip />
      <div className="flex min-h-0 flex-1">
        <SideNav section={section} onSelect={(next) => controller.navigate(next)} />
        <main ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
          <div
            role="tabpanel"
            id={PANEL_ID}
            aria-labelledby={tabId(section)}
            className="mx-auto w-full max-w-[720px] px-6 pt-2 pb-10"
          >
            {phase === 'loading' ? <SettingsSkeleton /> : null}
            {phase === 'error' ? <LoadFailed /> : null}
            {phase === 'ready' ? (
              <AnimatePresence
                mode="wait"
                onExitComplete={() => {
                  if (scroller.current) scroller.current.scrollTop = 0;
                }}
              >
                <SectionView key={section} />
              </AnimatePresence>
            ) : null}
          </div>
        </main>
      </div>
      <ToastHost className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" />
    </div>
  );
}
