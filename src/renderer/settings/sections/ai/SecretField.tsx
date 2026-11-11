import { useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/components/Button';
import { useRowDescription } from '@renderer/components/forms';
import { showToast } from '@renderer/components/Toast';
import { useController } from '../../context';
import type { SecretName } from '../../controller';
import { friendlyError } from '../../lib/errors';
import { validateApiKey } from '../../lib/validation';
import { ConfirmButton } from '../../ui/ConfirmButton';

export interface SecretFieldProps {
  name: SecretName;
  /** Accessible name of the key input. */
  label: string;
  /** Masked hint such as "â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢1a2b" from the main process; null when no key is stored. */
  hint: string | null;
}

/** Text a screen reader hears instead of a run of bullet characters. */
function spokenHint(hint: string): string {
  const tail = hint.replace(/\u2022/g, '');
  return tail === '' ? 'A key is saved' : `A key is saved, ending in ${tail}`;
}

/**
 * Write-only API key editor. The stored key is never sent back to this window: only the masked
 * hint is shown. A new key is typed into a password field, saved through the main process and the
 * field is cleared (and unmounted) straight away.
 */
export function SecretField({ name, label, hint }: SecretFieldProps) {
  const controller = useController();
  const describedBy = useRowDescription();
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const stopEditing = (): void => {
    setDraft('');
    setError(null);
    setReplacing(false);
  };

  const save = async (): Promise<void> => {
    const problem = validateApiKey(name, draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await controller.setKey(name, draft.trim());
      if (alive.current) stopEditing();
      showToast({ title: 'Key saved', message: 'Stored encrypted on this PC.', tone: 'success' });
    } catch (failure) {
      if (alive.current) {
        setError(friendlyError(failure, 'Could not save the key. Please try again.'));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await controller.clearKey(name);
      showToast({ title: 'Key removed', tone: 'info' });
    } catch (failure) {
      showToast({
        title: 'Could not remove the key',
        message: friendlyError(failure, 'Please try again.'),
        tone: 'error',
      });
    }
  };

  if (hint !== null && !replacing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="font-mono text-[13px] text-fg">
          {hint}
        </span>
        <span className="sr-only">{spokenHint(hint)}</span>
        <Button size="sm" onClick={() => setReplacing(true)}>
          Replace
        </Button>
        <ConfirmButton
          label="Remove"
          confirmLabel="Yes, remove"
          icon="trash-can"
          onConfirm={remove}
        />
      </div>
    );
  }

  return (
    <form
      className="flex flex-col items-start gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex w-full items-center gap-2">
        <input
          type="password"
          value={draft}
          aria-label={label}
          aria-invalid={error !== null}
          aria-describedby={describedBy}
          placeholder="Paste your key"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          className={`h-9 w-full max-w-[320px] rounded-control border bg-sunken px-3 text-[14px] text-fg placeholder:text-fg-faint ${
            error ? 'border-danger' : 'border-line'
          }`}
        />
        <Button type="submit" size="sm" variant="primary" disabled={busy || draft.trim() === ''}>
          {busy ? 'Saving...' : 'Save key'}
        </Button>
        {replacing ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={stopEditing}>
            Cancel
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] leading-[18px] text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
