import type { Bridge } from '@shared/ipc/bridge';

export type OnboardingBridge = Bridge<'onboarding'>;

const MAX_MESSAGE = 3900;
const MAX_STACK = 7900;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Forwards renderer crashes to the main-process log. Logging itself must never throw or reject. */
export function createErrorReporter(
  bridge: OnboardingBridge,
): (error: Error, scope: string) => void {
  return (error, scope) => {
    void bridge
      .invoke('app:log', {
        level: 'error',
        scope,
        message: error.message.slice(0, MAX_MESSAGE),
        ...(error.stack ? { stack: error.stack.slice(0, MAX_STACK) } : {}),
      })
      .catch(() => undefined);
  };
}

/** Records a non-fatal IPC failure (the UI already shows its own friendly message). */
export function logFailure(bridge: OnboardingBridge, action: string, error: unknown): void {
  void bridge
    .invoke('app:log', {
      level: 'warn',
      scope: 'onboarding',
      message: `${action}: ${messageOf(error)}`.slice(0, MAX_MESSAGE),
    })
    .catch(() => undefined);
}
