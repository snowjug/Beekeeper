import type { VoiceLanguage } from '@shared/settings';

export type SampleLanguage = 'en' | 'hi';

/** What a voice says when you press its play button. */
export const SAMPLE_TEXT: Record<SampleLanguage, string> = {
  en: 'Good morning! It is twenty-three degrees and sunny. You have two reminders today.',
  hi: 'नमस्ते! आज मौसम साफ़ है और आपके दो रिमाइंडर हैं।',
};

/** Hindi when the person speaks Hindi; English otherwise (Auto speaks both, English is the default). */
export function sampleLanguage(language: VoiceLanguage): SampleLanguage {
  return language === 'hi' ? 'hi' : 'en';
}
