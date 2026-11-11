import { z } from 'zod';
import type { DefinitionCard } from '@shared/cards';
import type { Logger } from '@shared/logger';
import { parseSafeExternalUrl } from '@shared/url';
import { getJson, HttpFailure } from '../commands/lib/http';
import type { DictionaryService } from '../commands/types';

export interface DictionaryServiceOptions {
  fetch: typeof fetch;
  logger: Logger;
}

const ENTRIES_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const TIMEOUT_MS = 8000;
const MAX_DEFINITIONS = 3;
const MAX_SYNONYMS = 5;

const entriesSchema = z.array(
  z.object({
    word: z.string(),
    phonetic: z.string().nullish(),
    phonetics: z.array(z.object({ text: z.string().nullish() })).nullish(),
    meanings: z.array(
      z.object({
        partOfSpeech: z.string(),
        definitions: z.array(
          z.object({
            definition: z.string(),
            example: z.string().nullish(),
            synonyms: z.array(z.string()).nullish(),
          }),
        ),
        synonyms: z.array(z.string()).nullish(),
      }),
    ),
    sourceUrls: z.array(z.string()).nullish(),
  }),
);

type Entry = z.infer<typeof entriesSchema>[number];
type Definition = Omit<DefinitionCard, 'id' | 'createdAt'>;
type Meaning = DefinitionCard['meanings'][number];

/** Merges the meanings of all entries by part of speech and keeps the top few of each. */
function toMeanings(entries: readonly Entry[]): Meaning[] {
  const byPartOfSpeech = new Map<string, Meaning>();
  for (const entry of entries) {
    for (const meaning of entry.meanings) {
      const target = byPartOfSpeech.get(meaning.partOfSpeech) ?? {
        partOfSpeech: meaning.partOfSpeech,
        definitions: [],
        synonyms: [],
      };
      const synonyms = target.synonyms ?? [];
      const candidates = [...(meaning.synonyms ?? [])];

      for (const item of meaning.definitions) {
        const text = item.definition.trim();
        if (text.length > 0 && target.definitions.length < MAX_DEFINITIONS) {
          const example = item.example?.trim();
          target.definitions.push(
            example !== undefined && example.length > 0
              ? { definition: text, example }
              : { definition: text },
          );
        }
        candidates.push(...(item.synonyms ?? []));
      }
      for (const synonym of candidates) {
        if (synonyms.length < MAX_SYNONYMS && !synonyms.includes(synonym)) synonyms.push(synonym);
      }
      target.synonyms = synonyms;
      byPartOfSpeech.set(meaning.partOfSpeech, target);
    }
  }
  return [...byPartOfSpeech.values()]
    .filter((meaning) => meaning.definitions.length > 0)
    .map(({ synonyms, ...meaning }) =>
      synonyms !== undefined && synonyms.length > 0 ? { ...meaning, synonyms } : meaning,
    );
}

function toDefinition(entries: readonly Entry[]): Definition | null {
  const first = entries[0];
  if (!first) return null;
  const meanings = toMeanings(entries);
  if (meanings.length === 0) return null;

  const result: Definition = { kind: 'definition', word: first.word, meanings };
  const phonetic = first.phonetic ?? first.phonetics?.find((item) => item.text)?.text;
  if (phonetic) result.phonetic = phonetic;
  const source = first.sourceUrls?.find((url) => parseSafeExternalUrl(url) !== null);
  if (source) result.sourceUrl = source;
  return result;
}

/** dictionaryapi.dev lookups (no API key). Unknown words resolve to null. */
export function createDictionaryService(options: DictionaryServiceOptions): DictionaryService {
  return {
    async define(word) {
      const term = word.trim().toLowerCase();
      if (term.length === 0) return null;

      let json: unknown;
      try {
        json = await getJson(
          options.fetch,
          `${ENTRIES_URL}/${encodeURIComponent(term)}`,
          TIMEOUT_MS,
        );
      } catch (error) {
        if (error instanceof HttpFailure && error.reason === 'status' && error.status === 404) {
          return null;
        }
        options.logger.warn('Dictionary lookup failed:', error);
        throw new Error("Couldn't reach the dictionary service", { cause: error });
      }

      const parsed = entriesSchema.safeParse(json);
      if (!parsed.success) {
        options.logger.warn('Dictionary response did not match the expected shape');
        throw new Error('The dictionary service returned an unexpected response');
      }
      return toDefinition(parsed.data);
    },
  };
}
