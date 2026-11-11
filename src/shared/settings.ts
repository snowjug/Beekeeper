import { z } from 'zod';
import { DEFAULT_HOTKEYS } from './constants';
import { parseAccelerator } from './hotkeys';
import { DEFAULT_NATURAL_VOICE, NATURAL_VOICE_IDS } from './speech/voices';

const accelerator = z.string().refine((value) => parseAccelerator(value) !== null, {
  message: 'Invalid keyboard shortcut',
});

const httpsUrlOrEmpty = z
  .string()
  .trim()
  .max(300)
  .refine((value) => {
    if (value === '') return true;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname.length > 0;
    } catch {
      return false;
    }
  }, 'Must be an https:// URL');

export const GeneralSchema = z.object({
  startWithWindows: z.boolean().default(false),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  language: z.literal('en-US').default('en-US'),
  units: z.enum(['metric', 'imperial']).default('metric'),
  weatherLocation: z
    .object({
      mode: z.enum(['auto', 'manual']).default('auto'),
      city: z.string().trim().max(80).default(''),
    })
    .default({ mode: 'auto', city: '' }),
});

export const VOICE_LANGUAGES = ['auto', 'en', 'hi'] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

export const VoiceSchema = z.object({
  micDeviceId: z.string().max(300).default('default'),
  ttsEnabled: z.boolean().default(true),
  ttsVoiceUri: z.string().max(300).default(''),
  ttsRate: z.number().min(0.5).max(2).default(1),
  pushToTalk: z.boolean().default(false),
  wakeWord: z.boolean().default(false),
  wakeWordPauseOnBatterySaver: z.boolean().default(true),
  earcons: z.boolean().default(true),
  /** whisper = on-device Whisper (accents + Hindi), offline = Vosk (small), azure = cloud. */
  sttEngine: z.enum(['whisper', 'offline', 'azure']).default('whisper'),
  /** natural = on-device human-like voice, system = Windows voices, elevenlabs/azure = cloud. */
  ttsEngine: z.enum(['natural', 'system', 'elevenlabs', 'azure']).default('natural'),
  /** Language you speak: auto detects English and Hindi (and Hinglish). */
  language: z.enum(VOICE_LANGUAGES).default('auto'),
  whisperModel: z.enum(['small', 'base']).default('small'),
  naturalVoice: z.enum(NATURAL_VOICE_IDS).default(DEFAULT_NATURAL_VOICE),
  naturalSpeed: z.number().min(0.7).max(1.4).default(1),
  elevenLabsVoiceId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{0,40}$/)
    .default(''),
  elevenLabsModel: z
    .enum(['eleven_flash_v2_5', 'eleven_multilingual_v2'])
    .default('eleven_flash_v2_5'),
  azureVoice: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,64}$/)
    .default('en-US-AriaNeural'),
});

export const HotkeysSchema = z.object({
  assistant: accelerator.default(DEFAULT_HOTKEYS.assistant),
  circle: accelerator.default(DEFAULT_HOTKEYS.circle),
  capture: accelerator.default(DEFAULT_HOTKEYS.capture),
  dictation: accelerator.default(DEFAULT_HOTKEYS.dictation),
});

export const CircleSchema = z.object({
  defaultAction: z.enum(['show', 'copy', 'search', 'translate']).default('show'),
});

/** Capture Studio: the preview that opens after a screenshot (frame, toolbar, pin, share). */
export const CaptureSchema = z.object({
  /** Open the Studio preview after a capture (otherwise the capture is saved with a toast). */
  openStudio: z.boolean().default(true),
  /** Flowing gradient glow around the preview. */
  glowFrame: z.boolean().default(true),
  /** Save every capture to the screenshots folder right away. */
  autoSave: z.boolean().default(true),
  /** Copy every capture to the clipboard right away. */
  autoCopy: z.boolean().default(false),
  /** Absolute folder for saved captures; empty = Pictures\Beekeeper. */
  saveFolder: z.string().trim().max(260).default(''),
  /** Close the preview after this many seconds without interaction; 0 = stay open. */
  dismissAfterSeconds: z.number().int().min(0).max(60).default(0),
  /** Play the shutter sound when the earcons setting is on. */
  shutterSound: z.boolean().default(true),
});

/** Dictation anywhere: speak, and Beekeeper types the text into the app you are using. */
export const DictationSchema = z.object({
  enabled: z.boolean().default(true),
  /** inherit = same as voice.language. */
  language: z.enum(['inherit', 'auto', 'en', 'hi']).default('inherit'),
  /** type = synthetic keystrokes (works everywhere), paste = clipboard paste (faster for long text). */
  method: z.enum(['type', 'paste']).default('type'),
  /** Seconds of silence that end dictation automatically. */
  silenceSeconds: z.number().min(0.8).max(8).default(2),
  /** Turn spoken "comma", "full stop", "new line" (and Hindi equivalents) into punctuation. */
  spokenPunctuation: z.boolean().default(true),
});

export const AiSchema = z.object({
  useAzureSpeech: z.boolean().default(false),
  speechRegion: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{0,40}$/i)
    .default(''),
  useAzureOpenAi: z.boolean().default(false),
  openAiEndpoint: httpsUrlOrEmpty.default(''),
  openAiDeployment: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{0,64}$/)
    .default(''),
  openAiApiVersion: z
    .string()
    .trim()
    .regex(/^[0-9a-z-]{0,32}$/)
    .default('2024-10-21'),
});

export const PrivacySchema = z.object({
  saveHistory: z.boolean().default(true),
});

export const UpdatesSchema = z.object({
  autoUpdate: z.boolean().default(true),
});

export const OnboardingSchema = z.object({
  completed: z.boolean().default(false),
});

export const SettingsSchema = z.object({
  general: GeneralSchema.prefault({}),
  voice: VoiceSchema.prefault({}),
  hotkeys: HotkeysSchema.prefault({}),
  circle: CircleSchema.prefault({}),
  capture: CaptureSchema.prefault({}),
  dictation: DictationSchema.prefault({}),
  ai: AiSchema.prefault({}),
  privacy: PrivacySchema.prefault({}),
  updates: UpdatesSchema.prefault({}),
  onboarding: OnboardingSchema.prefault({}),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsSection = keyof Settings;

export const SETTINGS_SECTIONS = [
  'general',
  'voice',
  'hotkeys',
  'circle',
  'capture',
  'dictation',
  'ai',
  'privacy',
  'updates',
  'onboarding',
] as const satisfies readonly SettingsSection[];

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/** Section validators without defaults: a patch must never re-apply defaults to untouched fields. */
function patchOf(schema: z.ZodObject<z.ZodRawShape>): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const inner = field instanceof z.ZodDefault ? (field.unwrap() as z.ZodType) : field;
    shape[key] = z.optional(inner);
  }
  return z.object(shape);
}

type PatchableSection = Exclude<SettingsSection, 'hotkeys'>;

/** Partial update sent by the settings window. Hotkeys go through their own channel (conflict checks). */
export type SettingsPatch = { [S in PatchableSection]?: Partial<Settings[S]> };

export const SettingsPatchSchema = z
  .object({
    general: patchOf(GeneralSchema).optional(),
    voice: patchOf(VoiceSchema).optional(),
    circle: patchOf(CircleSchema).optional(),
    capture: patchOf(CaptureSchema).optional(),
    dictation: patchOf(DictationSchema).optional(),
    ai: patchOf(AiSchema).optional(),
    privacy: patchOf(PrivacySchema).optional(),
    updates: patchOf(UpdatesSchema).optional(),
    onboarding: patchOf(OnboardingSchema).optional(),
  })
  .strict() as unknown as z.ZodType<SettingsPatch, SettingsPatch>;

/** Secrets never leave the main process; renderers only see masked hints. */
export interface SecretsView {
  speechKey: string | null;
  openAiKey: string | null;
  elevenLabsKey: string | null;
}

export interface SettingsView extends Settings {
  secrets: SecretsView;
}

/** Applies a patch section by section (sections are one level deep). */
export function applySettingsPatch(settings: Settings, patch: SettingsPatch): Settings {
  const next: Settings = structuredClone(settings);
  for (const section of Object.keys(patch) as Array<keyof SettingsPatch>) {
    const values = patch[section];
    if (values) Object.assign(next[section], values);
  }
  return SettingsSchema.parse(next);
}

/**
 * Reads settings from disk resiliently: every section is validated on its own so one bad
 * value resets that section to defaults instead of wiping everything.
 */
export function parseStoredSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return structuredClone(DEFAULT_SETTINGS);
  const record = raw as Record<string, unknown>;
  const whole = SettingsSchema.safeParse(record);
  if (whole.success) return whole.data;

  const merged: Record<string, unknown> = {};
  for (const section of SETTINGS_SECTIONS) {
    const schema = SettingsSchema.shape[section];
    const result = schema.safeParse(record[section]);
    merged[section] = result.success ? result.data : DEFAULT_SETTINGS[section];
  }
  return SettingsSchema.parse(merged);
}
