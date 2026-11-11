/**
 * The ten preset voices of the on-device natural text-to-speech model (Supertonic 3). The model
 * addresses them by speaker index; the ids are stable names stored in settings. Speakers 0-4 are
 * the female voices and 5-9 the male voices (measured with a pitch analysis of the model output),
 * and the labels are ordered from the brightest to the deepest voice inside each group.
 */
export const NATURAL_VOICES = [
  { id: 'asha', sid: 0, label: 'Asha', gender: 'female', tone: 'Warm and clear' },
  { id: 'anaya', sid: 1, label: 'Anaya', gender: 'female', tone: 'Bright and energetic' },
  { id: 'meera', sid: 3, label: 'Meera', gender: 'female', tone: 'Smooth and friendly' },
  { id: 'diya', sid: 2, label: 'Diya', gender: 'female', tone: 'Calm and natural' },
  { id: 'kavya', sid: 4, label: 'Kavya', gender: 'female', tone: 'Soft and low' },
  { id: 'arjun', sid: 5, label: 'Arjun', gender: 'male', tone: 'Warm and confident' },
  { id: 'vihaan', sid: 8, label: 'Vihaan', gender: 'male', tone: 'Clear and steady' },
  { id: 'rohan', sid: 7, label: 'Rohan', gender: 'male', tone: 'Deep and relaxed' },
  { id: 'kabir', sid: 6, label: 'Kabir', gender: 'male', tone: 'Deep and rich' },
  { id: 'dev', sid: 9, label: 'Dev', gender: 'male', tone: 'Deepest and calm' },
] as const;

export type NaturalVoice = (typeof NATURAL_VOICES)[number];
export type NaturalVoiceId = NaturalVoice['id'];

export const NATURAL_VOICE_IDS = NATURAL_VOICES.map((voice) => voice.id) as [
  NaturalVoiceId,
  ...NaturalVoiceId[],
];

export const DEFAULT_NATURAL_VOICE: NaturalVoiceId = 'asha';

/** Speaker index of a stored voice id (falls back to the default voice for unknown ids). */
export function naturalVoiceSid(id: string): number {
  const match = NATURAL_VOICES.find((voice) => voice.id === id);
  return (match ?? NATURAL_VOICES[0]).sid;
}
