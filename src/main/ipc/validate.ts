import type { InvokeChannel } from '@shared/ipc/channels';
import { invokeSchemas, type InvokeParsed } from '@shared/ipc/schemas';

export type ValidationResult<C extends InvokeChannel> =
  { ok: true; data: InvokeParsed<C> } | { ok: false; message: string };

/** Validates a raw payload against the channel's zod schema (no Electron dependency). */
export function validateInvoke<C extends InvokeChannel>(
  channel: C,
  raw: unknown,
): ValidationResult<C> {
  const schema = invokeSchemas[channel].input;
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data as InvokeParsed<C> };
  const issue = result.error.issues[0];
  const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
  return { ok: false, message: `Invalid request for ${channel}${where}` };
}
