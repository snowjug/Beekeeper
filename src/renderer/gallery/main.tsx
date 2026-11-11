import { MotionConfig } from 'framer-motion';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';
import {
  Button,
  Card,
  Chip,
  Icon,
  IconButton,
  Orb,
  Sheet,
  showToast,
  ToastHost,
  Toggle,
  Waveform,
  type OrbState,
} from '../components';
import { ProgressRing } from '../components/ProgressRing';

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset['theme'] = params.get('theme') === 'light' ? 'light' : 'dark';

const STATES: OrbState[] = ['idle', 'listening', 'thinking', 'speaking', 'error'];

function Gallery() {
  const levelRef = useRef(0);
  const [pulse, setPulse] = useState(0);
  const [toggle, setToggle] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(params.get('sheet') === '1');

  useEffect(() => {
    let frame = 0;
    const tick = (now: number): void => {
      const t = now / 1000;
      levelRef.current = Math.max(0, 0.5 + 0.35 * Math.sin(t * 3.1) + 0.15 * Math.sin(t * 7.7));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const interval = window.setInterval(() => setPulse((p) => p + 1), 450);
    showToast({
      title: 'Update ready',
      message: 'Restart Beekeeper to install 1.0.1',
      tone: 'success',
      durationMs: 0,
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="h-full overflow-auto p-8"
        style={{
          background:
            'radial-gradient(1200px 700px at 10% 0%, #3b82f6 0%, transparent 55%), radial-gradient(900px 600px at 100% 30%, #ec4899 0%, transparent 55%), #0f172a',
        }}
      >
        <div className="bk-glass mx-auto flex max-w-[860px] flex-col gap-6 rounded-bar p-6">
          <section aria-label="Orb states" className="flex items-end justify-between gap-4">
            {STATES.map((state) => (
              <div key={state} className="flex flex-col items-center gap-3">
                <Orb state={state} size={72} levelRef={levelRef} pulseSignal={pulse} />
                <span className="text-xs text-fg-muted">{state}</span>
              </div>
            ))}
          </section>

          <Waveform levelRef={levelRef} active height={56} />

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon="mic">
              Listen
            </Button>
            <Button variant="secondary" icon="settings">
              Settings
            </Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon="power">
              Shut down
            </Button>
            <IconButton icon="history" label="History" />
            <IconButton icon="pin-filled" label="Pinned" active />
            <Toggle checked={toggle} onChange={setToggle} label="Wake word" />
            <ProgressRing value={0.62} size={56} label="Timer">
              <span className="text-xs font-semibold">3:12</span>
            </ProgressRing>
          </div>

          <div className="flex flex-wrap gap-2">
            <Chip icon="weather">{"What's the weather?"}</Chip>
            <Chip icon="app">Open Notepad</Chip>
            <Chip icon="circle">Circle to Search</Chip>
            <Chip icon="timer">Set a 5 min timer</Chip>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Card
              icon="calculator"
              title="Calculation"
              headerActions={<IconButton size="sm" icon="copy" label="Copy" />}
            >
              <p className="px-4 pt-1 pb-4 text-3xl font-semibold">
                15% of 2400 <span className="bk-brand-text">= 360</span>
              </p>
            </Card>
            <Card index={1} icon="battery" title="Battery">
              <p className="px-4 pt-1 pb-4 text-sm text-fg-muted">
                82% — charging. About 1 h 12 min until full.
              </p>
            </Card>
          </div>

          <div className="flex flex-wrap gap-4 text-fg-muted">
            {(
              [
                'app',
                'web',
                'search',
                'clock',
                'weather',
                'battery',
                'timer',
                'bell',
                'note',
                'volume',
                'screenshot',
                'lock',
                'power',
                'moon',
                'circle',
                'sparkle',
                'mic',
                'wifi',
                'translate',
                'image',
              ] as const
            ).map((name) => (
              <Icon key={name} name={name} size={22} />
            ))}
          </div>
        </div>

        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          label="Results"
          header={<h2 className="text-base font-semibold">Results</h2>}
        >
          <p className="text-sm text-fg-muted">Extracted text appears here.</p>
        </Sheet>
        <ToastHost />
      </div>
    </MotionConfig>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
}
