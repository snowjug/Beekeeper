/**
 * Catalogue of the downloadable speech packs (natural voice + Whisper recognition). Every file is
 * pinned by size and SHA-256, so a changed or tampered download is rejected. Types and data only:
 * the main process downloads and verifies, the settings UI shows names, sizes and licences.
 */

export const SPEECH_PACK_IDS = ['supertonic-3', 'whisper-small', 'whisper-base'] as const;
export type SpeechPackId = (typeof SPEECH_PACK_IDS)[number];

export interface SpeechPackFile {
  /** File name inside the pack folder. */
  name: string;
  bytes: number;
  sha256: string;
  url: string;
}

export interface SpeechPackArchive {
  url: string;
  bytes: number;
  sha256: string;
  format: 'tar.bz2';
  /** Files that must exist after extraction (name -> size in bytes). */
  files: Readonly<Record<string, number>>;
}

export interface SpeechPackSpec {
  id: SpeechPackId;
  kind: 'tts' | 'stt';
  name: string;
  description: string;
  languages: readonly string[];
  license: string;
  /** Source shown in the privacy list. */
  host: string;
  /** Total download size in bytes. */
  sizeBytes: number;
  files?: readonly SpeechPackFile[];
  archive?: SpeechPackArchive;
}

const WHISPER_BASE_REVISION = 'bb53ee204431c90d314c1cc08d28d23e5b7927cc';
const WHISPER_SMALL_REVISION = '8f3c18b358db4d1f2fc1eae49d75cd20989e4309';

function whisperFile(
  repo: string,
  revision: string,
  name: string,
  bytes: number,
  sha256: string,
): SpeechPackFile {
  return {
    name,
    bytes,
    sha256,
    url: `https://huggingface.co/${repo}/resolve/${revision}/${name}`,
  };
}

export const SPEECH_PACKS: Readonly<Record<SpeechPackId, SpeechPackSpec>> = {
  'supertonic-3': {
    id: 'supertonic-3',
    kind: 'tts',
    name: 'Natural voice',
    description:
      'Human-sounding on-device voice (Supertonic 3) in English and Hindi with ten voices.',
    languages: ['en', 'hi'],
    license: 'Model: OpenRAIL-M, runtime: Apache-2.0',
    host: 'github.com (k2-fsa/sherpa-onnx releases)',
    sizeBytes: 128_774_318,
    archive: {
      url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2',
      bytes: 128_774_318,
      sha256: '82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427',
      format: 'tar.bz2',
      files: {
        'duration_predictor.int8.onnx': 3_700_147,
        'text_encoder.int8.onnx': 36_416_150,
        'vector_estimator.int8.onnx': 78_400_833,
        'vocoder.int8.onnx': 25_991_073,
        'tts.json': 8_253,
        'unicode_indexer.bin': 262_144,
        'voice.bin': 517_168,
      },
    },
  },
  'whisper-small': {
    id: 'whisper-small',
    kind: 'stt',
    name: 'Accurate recognition (Whisper small)',
    description:
      'Understands accented English and Hindi and detects the language automatically. Best accuracy.',
    languages: ['en', 'hi'],
    license: 'MIT (OpenAI Whisper), runtime: Apache-2.0',
    host: 'huggingface.co (csukuangfj/sherpa-onnx-whisper-small)',
    sizeBytes: 112_442_483 + 262_226_114 + 816_730,
    files: [
      whisperFile(
        'csukuangfj/sherpa-onnx-whisper-small',
        WHISPER_SMALL_REVISION,
        'small-encoder.int8.onnx',
        112_442_483,
        '4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9',
      ),
      whisperFile(
        'csukuangfj/sherpa-onnx-whisper-small',
        WHISPER_SMALL_REVISION,
        'small-decoder.int8.onnx',
        262_226_114,
        'acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee',
      ),
      whisperFile(
        'csukuangfj/sherpa-onnx-whisper-small',
        WHISPER_SMALL_REVISION,
        'small-tokens.txt',
        816_730,
        'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
      ),
    ],
  },
  'whisper-base': {
    id: 'whisper-base',
    kind: 'stt',
    name: 'Fast recognition (Whisper base)',
    description: 'Quicker and smaller, accurate for clear English. Less accurate for Hindi.',
    languages: ['en', 'hi'],
    license: 'MIT (OpenAI Whisper), runtime: Apache-2.0',
    host: 'huggingface.co (csukuangfj/sherpa-onnx-whisper-base)',
    sizeBytes: 29_120_534 + 130_672_026 + 816_730,
    files: [
      whisperFile(
        'csukuangfj/sherpa-onnx-whisper-base',
        WHISPER_BASE_REVISION,
        'base-encoder.int8.onnx',
        29_120_534,
        '0b8fb1304b6109976038efff5ace81720e00386f3ff6b54ee8c75291ca0a1e11',
      ),
      whisperFile(
        'csukuangfj/sherpa-onnx-whisper-base',
        WHISPER_BASE_REVISION,
        'base-decoder.int8.onnx',
        130_672_026,
        '9759d217388a01b3a4c7c15533201067b48ae819c4daafc8624e64b9409dc02d',
      ),
      whisperFile(
        'csukuangfj/sherpa-onnx-whisper-base',
        WHISPER_BASE_REVISION,
        'base-tokens.txt',
        816_730,
        'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
      ),
    ],
  },
};

export function isSpeechPackId(value: unknown): value is SpeechPackId {
  return typeof value === 'string' && (SPEECH_PACK_IDS as readonly string[]).includes(value);
}

/** The Whisper pack that serves a `voice.whisperModel` setting. */
export function whisperPackFor(model: 'small' | 'base'): SpeechPackId {
  return model === 'base' ? 'whisper-base' : 'whisper-small';
}
