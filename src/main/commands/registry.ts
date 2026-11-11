import { appsWebCommands } from './groups/apps-web';
import { assistantCommands } from './groups/assistant';
import { infoCommands } from './groups/info';
import { productivityCommands } from './groups/productivity';
import { systemCommands } from './groups/system';
import type { AnyCommandModule } from './types';

/**
 * Flattens command groups into one list sorted by spec number. Throws on duplicate ids or
 * numbers so a bad registration fails at start-up instead of shadowing another command.
 */
export function buildRegistry(
  groups: ReadonlyArray<readonly AnyCommandModule[]>,
): readonly AnyCommandModule[] {
  const ids = new Map<string, AnyCommandModule>();
  const numbers = new Map<number, AnyCommandModule>();
  for (const module of groups.flat()) {
    if (ids.has(module.id)) throw new Error(`Duplicate command id "${module.id}"`);
    const sameNumber = numbers.get(module.number);
    if (sameNumber) {
      throw new Error(
        `Duplicate command number ${module.number} ("${sameNumber.id}" and "${module.id}")`,
      );
    }
    ids.set(module.id, module);
    numbers.set(module.number, module);
  }
  return Object.freeze([...ids.values()].sort((a, b) => a.number - b.number));
}

/** Every registered command, in spec order. */
export const allCommands = buildRegistry([
  appsWebCommands,
  infoCommands,
  productivityCommands,
  systemCommands,
  assistantCommands,
]);
