import type { Logger } from '@shared/logger';
import type { AiTestResult } from '@shared/ipc/types';

export interface AzureOpenAiConfig {
  /** https://<resource>.openai.azure.com (a trailing slash is tolerated). */
  endpoint: string;
  deployment: string;
  apiVersion: string;
  apiKey: string;
}

export type ChatPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatPart[];
}

export type AiErrorKind =
  | 'unconfigured'
  | 'auth'
  | 'not-found'
  | 'rate-limit'
  | 'content-filter'
  | 'bad-request'
  | 'server'
  | 'network'
  | 'timeout'
  | 'aborted';

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

const FRIENDLY: Record<AiErrorKind, string> = {
  unconfigured: 'Azure OpenAI is not set up. Add an endpoint, deployment and key in Settings > AI.',
  auth: 'Azure rejected the API key. Check the key in Settings > AI.',
  'not-found':
    'Azure could not find that deployment. Check the endpoint and deployment name in Settings > AI.',
  'rate-limit': 'Azure OpenAI is rate limiting requests right now. Try again in a moment.',
  'content-filter': 'Azure OpenAI declined to answer because of its content filter.',
  'bad-request': 'Azure OpenAI did not accept the request. Check the API version in Settings > AI.',
  server: 'Azure OpenAI had a problem answering. Try again in a moment.',
  network: 'I could not reach Azure OpenAI. Check your internet connection and the endpoint.',
  timeout: 'Azure OpenAI took too long to respond.',
  aborted: 'Cancelled.',
};

/** User-facing sentence for any failure (never contains keys or response bodies). */
export function describeAiError(error: unknown): string {
  return error instanceof AiError ? FRIENDLY[error.kind] : FRIENDLY.server;
}

export function errorFromStatus(status: number, body: string): AiError {
  if (status === 401 || status === 403) return new AiError('auth', FRIENDLY.auth, status);
  if (status === 404) return new AiError('not-found', FRIENDLY['not-found'], status);
  if (status === 429) return new AiError('rate-limit', FRIENDLY['rate-limit'], status);
  if (status === 400) {
    const filtered = /content_filter|ResponsibleAIPolicyViolation/i.test(body);
    return filtered
      ? new AiError('content-filter', FRIENDLY['content-filter'], status)
      : new AiError('bad-request', FRIENDLY['bad-request'], status);
  }
  return new AiError('server', FRIENDLY.server, status);
}

export function buildChatUrl(config: AzureOpenAiConfig): string {
  const base = config.endpoint.trim().replace(/\/+$/, '');
  const deployment = encodeURIComponent(config.deployment.trim());
  const version = encodeURIComponent(config.apiVersion.trim());
  return `${base}/openai/deployments/${deployment}/chat/completions?api-version=${version}`;
}

/** Yields the payload of every `data:` line of a server-sent-events body until `[DONE]`. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const payloadOf = (line: string): string | null =>
    line.startsWith('data:') ? line.slice(5).trim() : null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const payload = payloadOf(buffer.slice(0, end).replace(/\r$/, ''));
        buffer = buffer.slice(end + 1);
        if (payload === '[DONE]') return;
        if (payload) yield payload;
      }
    }
    const rest = payloadOf(buffer.trim());
    if (rest && rest !== '[DONE]') yield rest;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

interface ChatChunk {
  choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string | null }>;
  error?: { message?: string; code?: string };
}

/** Text carried by one streamed chunk ('' for role/filter/empty chunks). Throws on in-stream errors. */
export function deltaOf(payload: string): string {
  let chunk: ChatChunk;
  try {
    chunk = JSON.parse(payload) as ChatChunk;
  } catch {
    return '';
  }
  if (chunk.error) {
    const filtered = chunk.error.code === 'content_filter';
    throw new AiError(
      filtered ? 'content-filter' : 'server',
      filtered ? FRIENDLY['content-filter'] : FRIENDLY.server,
    );
  }
  const content = chunk.choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
}

export interface AzureOpenAiClientDeps {
  fetch: typeof fetch;
  logger: Logger;
  /** Time allowed until the response headers arrive. Default 30 s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Minimal Azure OpenAI chat-completions client (REST + SSE) built on the app's fetch. */
export class AzureOpenAiClient {
  constructor(private readonly deps: AzureOpenAiClientDeps) {}

  /** Streams the assistant reply as text deltas. */
  async *stream(
    config: AzureOpenAiConfig,
    messages: readonly ChatMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const response = await this.post(config, { messages, stream: true }, signal);
    if (!response.body) throw new AiError('server', FRIENDLY.server);
    try {
      for await (const payload of readSse(response.body)) {
        const delta = deltaOf(payload);
        if (delta) yield delta;
      }
    } catch (error) {
      throw this.normalize(error, signal);
    }
  }

  /** Cheap round trip used by Settings > "Test connection". */
  async test(config: AzureOpenAiConfig, signal?: AbortSignal): Promise<AiTestResult> {
    const started = Date.now();
    try {
      const response = await this.post(
        config,
        {
          messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
          stream: false,
        },
        signal,
      );
      await response.arrayBuffer();
      return {
        ok: true,
        message: `Connected to deployment "${config.deployment}".`,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return { ok: false, message: describeAiError(error), latencyMs: Date.now() - started };
    }
  }

  private async post(
    config: AzureOpenAiConfig,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.deps.fetch(buildChatUrl(config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': config.apiKey },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      throw this.normalize(error, signal);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.deps.logger.warn(`Azure OpenAI responded with HTTP ${response.status}`);
      throw errorFromStatus(response.status, text);
    }
    return response;
  }

  private normalize(error: unknown, signal?: AbortSignal): AiError {
    if (error instanceof AiError) return error;
    if (signal?.aborted) return new AiError('aborted', FRIENDLY.aborted);
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError') return new AiError('timeout', FRIENDLY.timeout);
    if (name === 'AbortError') return new AiError('aborted', FRIENDLY.aborted);
    return new AiError('network', FRIENDLY.network);
  }
}
