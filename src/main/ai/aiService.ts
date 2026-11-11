import type { ConversationTurn } from '@shared/cards';
import type { AiTestResult, SpeechTokenResult, StreamEvent } from '@shared/ipc/types';
import type { Logger } from '@shared/logger';
import type { Settings } from '@shared/settings';
import type { AnswerStreamer } from '../assistant/assistantService';
import type { AzureEnv } from '../env';
import {
  AiError,
  describeAiError,
  type AzureOpenAiClient,
  type AzureOpenAiConfig,
  type ChatMessage,
} from './azureOpenAi';

const SYSTEM_PROMPT =
  'You are Beekeeper, a concise voice-first desktop assistant for Windows. Answer directly in a ' +
  'few sentences or a short list. Use light Markdown only when it helps. The reply may be read ' +
  'aloud, so avoid long URLs and avoid code unless asked.';

const VISION_PROMPT =
  'You are the visual search of Beekeeper. The user circled part of their screen. Say what it shows, ' +
  'answer their question if they asked one, and quote exact text when that is useful. Be concise.';

const DEFAULT_QUESTION = 'What is this? Explain what is shown and read out any important text.';
const MAX_CONTEXT_TURNS = 4;
const SPEECH_TOKEN_TTL_MS = 9 * 60_000;
const SPEECH_TIMEOUT_MS = 10_000;
const REGION = /^[a-z0-9-]{1,40}$/i;
const DEFAULT_API_VERSION = '2024-10-21';

export interface SecretReader {
  get(name: 'speech' | 'openai'): string | null;
}

export interface AiServiceDeps {
  client: AzureOpenAiClient;
  fetch: typeof fetch;
  settings: () => Settings;
  keys: SecretReader;
  /** Defaults from environment variables / .env; Settings values win. */
  env: AzureEnv;
  logger: Logger;
  now?: () => number;
}

export interface VisionRequest {
  /** PNG bytes of the circled region. */
  png: Buffer;
  question: string | undefined;
  streamId: string;
}

export type VisionEmit = (event: {
  streamId: string;
  delta?: string;
  done?: boolean;
  error?: string;
}) => void;

/** Builds the chat history for a plain question: system prompt, short context, the question. */
export function buildMessages(prompt: string, turns: readonly ConversationTurn[]): ChatMessage[] {
  const recent = turns
    .slice(-MAX_CONTEXT_TURNS)
    .map((turn) => `- ${turn.text.trim()}`)
    .filter((line) => line.length > 2);
  const system =
    recent.length > 0
      ? `${SYSTEM_PROMPT}\n\nEarlier requests from the user in this conversation (oldest first):\n${recent.join('\n')}`
      : SYSTEM_PROMPT;
  return [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ];
}

export function buildVisionMessages(png: Buffer, question: string | undefined): ChatMessage[] {
  const text = question && question.trim() !== '' ? question.trim() : DEFAULT_QUESTION;
  return [
    { role: 'system', content: VISION_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
        },
      ],
    },
  ];
}

/**
 * Optional cloud features. Everything here is main-process only: keys are read from secure storage
 * at call time and never returned to a renderer; the Speech SDK in the assistant window only
 * receives a short-lived token.
 */
export class AiService implements AnswerStreamer {
  private speechCache: {
    token: string;
    region: string;
    keyHint: string;
    expiresAt: number;
  } | null = null;

  constructor(private readonly deps: AiServiceDeps) {}

  /** Endpoint + deployment + key are present and valid (the user's toggle is checked separately). */
  openAiConfig(): AzureOpenAiConfig | null {
    const { ai } = this.deps.settings();
    const { env, keys } = this.deps;
    const endpoint = (ai.openAiEndpoint || env.openAiEndpoint || '').trim();
    const deployment = (ai.openAiDeployment || env.openAiDeployment || '').trim();
    const apiVersion = (ai.openAiApiVersion || env.openAiApiVersion || DEFAULT_API_VERSION).trim();
    const apiKey = keys.get('openai');
    if (!endpoint || !deployment || !apiKey || !endpoint.startsWith('https://')) return null;
    return { endpoint, deployment, apiVersion, apiKey };
  }

  isConfigured(): boolean {
    return this.deps.settings().ai.useAzureOpenAi && this.openAiConfig() !== null;
  }

  modelName(): string {
    return this.openAiConfig()?.deployment ?? '';
  }

  async stream(
    request: { cardId: string; prompt: string; turns: readonly ConversationTurn[] },
    signal: AbortSignal,
    emit: (event: StreamEvent) => void,
  ): Promise<void> {
    const { cardId } = request;
    try {
      const config = this.require();
      for await (const delta of this.deps.client.stream(
        config,
        buildMessages(request.prompt, request.turns),
        signal,
      )) {
        emit({ cardId, delta });
      }
      emit({ cardId, done: true });
    } catch (error) {
      this.finishWithError(
        error,
        (message) => emit({ cardId, error: message }),
        () => emit({ cardId, done: true }),
      );
    }
  }

  /** Streams an answer about a circled screenshot region (Circle to Search "Ask about this"). */
  async askAboutImage(
    request: VisionRequest,
    signal: AbortSignal,
    emit: VisionEmit,
  ): Promise<void> {
    const { streamId } = request;
    try {
      const config = this.require();
      for await (const delta of this.deps.client.stream(
        config,
        buildVisionMessages(request.png, request.question),
        signal,
      )) {
        emit({ streamId, delta });
      }
      emit({ streamId, done: true });
    } catch (error) {
      this.finishWithError(
        error,
        (message) => emit({ streamId, error: message }),
        () => emit({ streamId, done: true }),
      );
    }
  }

  async test(service: 'speech' | 'openai'): Promise<AiTestResult> {
    if (service === 'openai') {
      const config = this.openAiConfig();
      if (!config) {
        return { ok: false, message: 'Enter the endpoint, deployment name and API key first.' };
      }
      return this.deps.client.test(config);
    }
    const started = Date.now();
    const result = await this.fetchSpeechToken(true);
    if (typeof result === 'string') return { ok: false, message: result };
    return {
      ok: true,
      message: `Connected to Azure Speech in "${result.region}".`,
      latencyMs: Date.now() - started,
    };
  }

  /** Short-lived token for the Speech SDK; null when Azure Speech is not configured. */
  async speechToken(): Promise<SpeechTokenResult | null> {
    if (!this.deps.settings().ai.useAzureSpeech) return null;
    const result = await this.fetchSpeechToken(false);
    return typeof result === 'string' ? null : result;
  }

  private require(): AzureOpenAiConfig {
    const config = this.openAiConfig();
    if (!config) throw new AiError('unconfigured', 'Azure OpenAI is not configured.');
    return config;
  }

  private finishWithError(
    error: unknown,
    onError: (message: string) => void,
    onAbort: () => void,
  ): void {
    if (error instanceof AiError && error.kind === 'aborted') {
      onAbort();
      return;
    }
    this.deps.logger.warn(
      'AI request failed',
      error instanceof AiError
        ? `${error.kind} (${error.status ?? 'no status'})`
        : 'unexpected error',
    );
    onError(describeAiError(error));
  }

  /** Returns the token, or a user-facing reason string when it cannot be issued. */
  private async fetchSpeechToken(force: boolean): Promise<SpeechTokenResult | string> {
    const { ai } = this.deps.settings();
    const region = (ai.speechRegion || this.deps.env.speechRegion || '').trim();
    const key = this.deps.keys.get('speech');
    if (!key || !region) return 'Enter the Speech region and key first.';
    if (!REGION.test(region)) return 'The Speech region looks invalid (for example "westeurope").';

    const now = (this.deps.now ?? Date.now)();
    const hint = `${region}:${key.length}:${key.slice(-4)}`;
    const cached = this.speechCache;
    if (!force && cached && cached.keyHint === hint && cached.expiresAt > now + 30_000) {
      return { token: cached.token, region: cached.region, expiresAt: cached.expiresAt };
    }

    try {
      const response = await this.deps.fetch(
        `https://${region}.api.cognitive.microsoft.com/sdk/token/issueToken`,
        {
          method: 'POST',
          headers: { 'Ocp-Apim-Subscription-Key': key },
          signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
        },
      );
      if (response.status === 401 || response.status === 403) {
        return 'Azure rejected the Speech key. Check the key and region.';
      }
      if (!response.ok) return `Azure Speech answered with HTTP ${response.status}.`;
      const token = (await response.text()).trim();
      if (token === '') return 'Azure Speech returned an empty token.';
      this.speechCache = { token, region, keyHint: hint, expiresAt: now + SPEECH_TOKEN_TTL_MS };
      return { token, region, expiresAt: now + SPEECH_TOKEN_TTL_MS };
    } catch {
      return 'I could not reach Azure Speech. Check your internet connection and the region.';
    }
  }
}
