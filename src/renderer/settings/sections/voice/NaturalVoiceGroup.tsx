import { useId } from 'react';
import { IconButton } from '@renderer/components/Button';
import { SettingRow, SettingsGroup } from '@renderer/components/forms';
import { SPEECH_PACKS } from '@shared/speech/packs';
import { NATURAL_VOICES, type NaturalVoice } from '@shared/speech/voices';
import { useSettingsStore, useSetter, useView } from '../../context';
import { useVoiceSample, type VoiceSample } from '../../hooks/useVoiceSample';
import { formatRate } from '../../lib/format';
import { sampleLanguage } from '../../lib/samples';
import { SliderField } from '../../ui/fields';
import { InlineNotice } from '../../ui/InlineNotice';
import { PackRow } from './PackRow';

const GENDER = { female: 'Female', male: 'Male' } as const;

interface VoiceTileProps {
  voice: NaturalVoice;
  selected: boolean;
  onSelect: () => void;
  sample: VoiceSample;
  /** The voice pack is installed, so a sample can be rendered. */
  canPlay: boolean;
  onPlay: () => void;
}

function VoiceTile({ voice, selected, onSelect, sample, canPlay, onPlay }: VoiceTileProps) {
  const inputId = useId();
  const nameId = useId();
  const toneId = useId();
  const active = sample.voice === voice.id && sample.phase !== 'idle';
  const preparing = active && sample.phase === 'preparing';

  return (
    <div
      className={`flex items-center gap-2.5 rounded-control border px-3 py-2.5 transition-colors duration-[var(--bk-dur-fast)] ${
        selected ? 'border-accent bg-accent/10' : 'border-line bg-sunken'
      }`}
    >
      <input
        id={inputId}
        type="radio"
        name="natural-voice"
        value={voice.id}
        checked={selected}
        aria-labelledby={nameId}
        aria-describedby={toneId}
        onChange={onSelect}
        className="size-4 shrink-0 cursor-pointer accent-accent"
      />
      <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer">
        <span id={nameId} className="block text-[14px] leading-5 font-medium text-fg">
          {voice.label}
        </span>
        <span id={toneId} className="block truncate text-[12px] leading-4 text-fg-muted">
          {GENDER[voice.gender]} · {voice.tone}
        </span>
      </label>
      <IconButton
        size="sm"
        icon={preparing ? 'refresh' : active ? 'stop' : 'play'}
        label={active ? `Stop sample of ${voice.label}` : `Play sample of ${voice.label}`}
        disabled={!canPlay && !active}
        aria-busy={preparing}
        className={preparing ? '[&_svg]:animate-spin' : ''}
        onClick={active ? sample.stop : onPlay}
      />
    </div>
  );
}

function sampleStatus(sample: VoiceSample): string {
  const name = NATURAL_VOICES.find((voice) => voice.id === sample.voice)?.label;
  if (sample.phase === 'preparing') return `Preparing the sample of ${name ?? 'the voice'}...`;
  if (sample.phase === 'playing') return `Playing the sample of ${name ?? 'the voice'}.`;
  return '';
}

/** The on-device human-sounding voice: its download, the ten voices with samples, and the speed. */
export function NaturalVoiceGroup() {
  const { voice } = useView();
  const setVoice = useSetter('voice');
  const ready = useSettingsStore((state) => state.speech?.packs['supertonic-3'].state === 'ready');
  const sample = useVoiceSample();
  const language = sampleLanguage(voice.language);
  const spec = SPEECH_PACKS['supertonic-3'];

  return (
    <SettingsGroup
      title="Natural voice"
      footer={`Runs on this PC and speaks English and Hindi. ${spec.license}.`}
    >
      <PackRow pack="supertonic-3" title="Voice pack" description={spec.description} />
      <SettingRow
        stacked
        label="Voice"
        description={
          language === 'hi'
            ? 'Press play to hear a voice. Samples are in Hindi because you speak Hindi.'
            : 'Press play to hear a voice. Samples are in English; choose Hindi under Language to hear Hindi.'
        }
        below={
          <div className="space-y-2.5">
            {sample.error ? <InlineNotice tone="danger">{sample.error}</InlineNotice> : null}
            {ready ? null : (
              <InlineNotice>Download the voice pack above to hear the voices.</InlineNotice>
            )}
            <span role="status" className="sr-only">
              {sampleStatus(sample)}
            </span>
          </div>
        }
      >
        <div role="radiogroup" aria-label="Natural voices" className="grid grid-cols-2 gap-2">
          {NATURAL_VOICES.map((entry) => (
            <VoiceTile
              key={entry.id}
              voice={entry}
              selected={voice.naturalVoice === entry.id}
              onSelect={() => setVoice('naturalVoice', entry.id)}
              sample={sample}
              canPlay={ready}
              onPlay={() => sample.play(entry.id, language, voice.naturalSpeed)}
            />
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Speaking speed" description="From a little slower to a little faster.">
        <SliderField
          label="Speaking speed"
          value={voice.naturalSpeed}
          min={0.7}
          max={1.4}
          step={0.1}
          format={formatRate}
          onCommit={(speed) => setVoice('naturalSpeed', Math.round(speed * 100) / 100)}
        />
      </SettingRow>
    </SettingsGroup>
  );
}
