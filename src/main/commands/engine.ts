import { silentLogger } from '@shared/logger';
import type { Logger } from '@shared/logger';
import { normalizeInput } from './text';
import type { AnyCommandModule, ParseContext, ParsedIntent } from './types';

export interface CommandEngineOptions {
  modules: readonly AnyCommandModule[];
  /** Matches scoring below this are ignored. Default 0.5. */
  minScore?: number;
  /** Receives matchers that threw. Default: silent. */
  logger?: Logger;
}

export interface CommandEngine {
  readonly modules: readonly AnyCommandModule[];
  /** Picks the best command for `text`, or null when nothing matches (use the AI/web fallback). */
  parse(text: string, ctx: ParseContext): ParsedIntent | null;
}

const SCORE_EPSILON = 1e-9;

function beats(
  candidate: { module: AnyCommandModule; score: number },
  best: { module: AnyCommandModule; score: number },
): boolean {
  if (Math.abs(candidate.score - best.score) > SCORE_EPSILON) return candidate.score > best.score;
  const candidatePriority = candidate.module.priority ?? 0;
  const bestPriority = best.module.priority ?? 0;
  if (candidatePriority !== bestPriority) return candidatePriority > bestPriority;
  return candidate.module.number < best.module.number;
}

/**
 * Runs every command's matcher and keeps the highest score. Ties go to the higher `priority`,
 * then to the lower command number. A matcher that throws is skipped, never fatal.
 */
export function createCommandEngine(options: CommandEngineOptions): CommandEngine {
  const { modules, minScore = 0.5, logger = silentLogger } = options;

  return {
    modules,
    parse(text, ctx) {
      const input = normalizeInput(text);
      if (input.text.length === 0) return null;

      let best: { module: AnyCommandModule; score: number; slots: unknown } | null = null;
      for (const module of modules) {
        try {
          const match = module.match(input, ctx);
          if (!match || !(match.score >= minScore)) continue;
          const candidate = { module, score: Math.min(1, match.score), slots: match.slots };
          if (best === null || beats(candidate, best)) best = candidate;
        } catch (error) {
          logger.warn(`Command "${module.id}" failed to match`, error);
        }
      }
      return best === null
        ? null
        : { command: best.module, slots: best.slots, score: best.score, input };
    },
  };
}
