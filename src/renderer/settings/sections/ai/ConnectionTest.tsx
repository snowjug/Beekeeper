import { useEffect, useRef, useState } from 'react';
import type { AiTestResult } from '@shared/ipc/types';
import { Button } from '@renderer/components/Button';
import { SettingRow } from '@renderer/components/forms';
import { useController } from '../../context';
import type { SecretName } from '../../controller';
import { formatLatency } from '../../lib/format';
import { InlineNotice } from '../../ui/InlineNotice';

export interface ConnectionTestProps {
  service: SecretName;
  /** Everything needed (region / endpoint / deployment / key) is saved. */
  canTest: boolean;
  /** Why the button is disabled. */
  missingHint: string;
  /** Changes whenever a setting that affects the result changes; the shown result is then stale. */
  signature: string;
  /** Row title and button label; "Test connection" unless the service has something better. */
  label?: string;
  /** What pressing the button checks (shown while the test is possible). */
  description?: string;
}

type TestState =
  { status: 'idle' } | { status: 'testing' } | { status: 'done'; result: AiTestResult };

/** "Test connection": ok / error with latency. A failing handler reads as a friendly error. */
export function ConnectionTest({
  service,
  canTest,
  missingHint,
  signature,
  label = 'Test connection',
  description = 'Checks the saved settings and key against Azure.',
}: ConnectionTestProps) {
  const controller = useController();
  const [state, setState] = useState<TestState>({ status: 'idle' });
  const run = useRef(0);

  useEffect(() => {
    run.current += 1;
    setState({ status: 'idle' });
  }, [signature]);

  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );

  const test = async (): Promise<void> => {
    run.current += 1;
    const mine = run.current;
    setState({ status: 'testing' });
    const result = await controller.testService(service);
    if (run.current === mine) setState({ status: 'done', result });
  };

  const latency = state.status === 'done' ? formatLatency(state.result.latencyMs) : '';
  return (
    <SettingRow
      label={label}
      description={canTest ? description : missingHint}
      below={
        state.status === 'done' ? (
          <InlineNotice tone={state.result.ok ? 'success' : 'danger'} live>
            <strong className="font-semibold">
              {state.result.ok ? 'Connected' : 'Connection failed'}
            </strong>
            {latency ? <span> in {latency}</span> : null}
            {state.result.message ? <span>. {state.result.message}</span> : null}
          </InlineNotice>
        ) : undefined
      }
    >
      <Button
        size="sm"
        icon="bolt"
        disabled={!canTest || state.status === 'testing'}
        onClick={() => void test()}
      >
        {state.status === 'testing' ? 'Testing...' : label}
      </Button>
    </SettingRow>
  );
}
