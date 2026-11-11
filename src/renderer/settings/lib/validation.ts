import type { z } from 'zod';
import { invokeSchemas } from '@shared/ipc/schemas';
import { AiSchema, CaptureSchema, GeneralSchema, VoiceSchema } from '@shared/settings';

/** Returns a friendly problem description, or null when the value may be sent to the main process. */
export type FieldCheck = (value: string) => string | null;

function fromSchema(schema: z.ZodType, message: string): FieldCheck {
  return (value) => (schema.safeParse(value).success ? null : message);
}

export const validateSpeechRegion = fromSchema(
  AiSchema.shape.speechRegion,
  'Use letters, digits and dashes only, for example westeurope.',
);

export const validateDeployment = fromSchema(
  AiSchema.shape.openAiDeployment,
  'Use letters, digits, dots, dashes and underscores (up to 64 characters).',
);

export const validateApiVersion = fromSchema(
  AiSchema.shape.openAiApiVersion,
  'Use lowercase letters, digits and dashes, for example 2024-10-21.',
);

export const validateAzureVoice = fromSchema(
  VoiceSchema.shape.azureVoice,
  'Enter a voice name with letters, digits and dashes, for example en-US-AriaNeural.',
);

export const validateElevenLabsVoiceId = fromSchema(
  VoiceSchema.shape.elevenLabsVoiceId,
  'A voice ID has letters and digits only (up to 40). Copy it from your ElevenLabs Voice Library.',
);

const saveFolderLength = fromSchema(
  CaptureSchema.shape.saveFolder,
  'That folder path is too long (up to 260 characters).',
);

/** `C:\` or `C:/` or a network share (`\\server\share`). */
const ABSOLUTE_WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])/;
const INVALID_PATH_CHARS = /[<>:"|?*]/;

/** Empty (Pictures\Beekeeper) or a full Windows folder path. */
export const validateSaveFolder: FieldCheck = (value) => {
  if (value === '') return null;
  const tooLong = saveFolderLength(value);
  if (tooLong) return tooLong;
  if (!ABSOLUTE_WINDOWS_PATH.test(value)) {
    return 'Enter the full path, for example C:\\Users\\you\\Pictures\\Screenshots, or leave it empty.';
  }
  if (INVALID_PATH_CHARS.test(value.slice(2))) {
    return 'A folder name cannot contain < > : " | ? or *.';
  }
  return null;
};

const manualLocation = GeneralSchema.shape.weatherLocation;

export const validateCity: FieldCheck = (value) =>
  manualLocation.safeParse({ mode: 'manual', city: value }).success
    ? null
    : 'City names can be up to 80 characters.';

export const validateEndpoint: FieldCheck = (value) => {
  if (AiSchema.shape.openAiEndpoint.safeParse(value).success) return null;
  if (value.length > 300) return 'That address is too long.';
  if (/^http:\/\//i.test(value)) return 'Use https:// - plain http is not allowed.';
  return 'Enter an https:// address, for example https://my-resource.openai.azure.com.';
};

/** Same limits the main process enforces for `ai:setKey` (8-400 characters after trimming). */
export function validateApiKey(
  name: 'speech' | 'openai' | 'elevenlabs',
  value: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Paste your key first.';
  if (invokeSchemas['ai:setKey'].input.safeParse({ name, value }).success) return null;
  return trimmed.length < 8 ? 'That looks too short to be an API key.' : 'That is too long.';
}
