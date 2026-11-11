import { useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/components/Button';
import type { IconName } from '@renderer/components/Icon';

const DISARM_AFTER_MS = 6000;

export interface ConfirmButtonProps {
  label: string;
  /** Label of the same button once armed, e.g. "Yes, clear 12 items". */
  confirmLabel: string;
  icon?: IconName;
  disabled?: boolean;
  /** Runs after the second press. It must report its own failures. */
  onConfirm: () => Promise<void>;
}

type Phase = 'idle' | 'armed' | 'busy';

/**
 * Two-step destructive action. The first press arms the button in place (so keyboard focus never
 * moves); the second press runs it. It disarms by itself after a few seconds or on Cancel.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  icon,
  disabled = false,
  onConfirm,
}: ConfirmButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'armed') return undefined;
    const timer = window.setTimeout(() => setPhase('idle'), DISARM_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const press = async (): Promise<void> => {
    if (phase === 'idle') {
      setPhase('armed');
      return;
    }
    if (phase !== 'armed') return;
    setPhase('busy');
    try {
      await onConfirm();
    } finally {
      if (mounted.current) setPhase('idle');
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant={phase === 'idle' ? 'secondary' : 'danger'}
        icon={icon}
        disabled={disabled || phase === 'busy'}
        onClick={() => void press()}
      >
        {phase === 'idle' ? label : phase === 'busy' ? 'Working...' : confirmLabel}
      </Button>
      {phase === 'armed' ? (
        <Button size="sm" variant="ghost" onClick={() => setPhase('idle')}>
          Cancel
        </Button>
      ) : null}
      <span role="status" className="sr-only">
        {phase === 'armed' ? `Press ${confirmLabel} to confirm, or Cancel.` : ''}
      </span>
    </span>
  );
}
