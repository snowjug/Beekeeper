import type { StatusCard } from '@shared/cards';
import type { RunContext } from '../types';

type StatusFields = Pick<StatusCard, 'tone' | 'icon' | 'title'> &
  Partial<Pick<StatusCard, 'detail' | 'actions'>>;

/** A StatusCard with a fresh id and timestamp. */
export function statusCard(
  ctx: Pick<RunContext, 'newId' | 'now'>,
  fields: StatusFields,
): StatusCard {
  return { kind: 'status', id: ctx.newId(), createdAt: ctx.now.getTime(), ...fields };
}
