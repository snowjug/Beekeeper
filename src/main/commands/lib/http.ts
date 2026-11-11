type HttpFailureReason = 'network' | 'timeout' | 'status' | 'json';

/** Why a JSON request failed; callers map this onto their own error vocabulary. */
export class HttpFailure extends Error {
  constructor(
    readonly reason: HttpFailureReason,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'HttpFailure';
  }
}

/**
 * GETs `url` and parses the JSON body. The timeout covers the whole exchange, including
 * reading the body, so a stalled connection can never hang a command.
 */
export async function getJson(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetchFn(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      throw new HttpFailure(
        timedOut ? 'timeout' : 'network',
        timedOut ? `Request timed out after ${timeoutMs} ms` : 'Request failed',
        undefined,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new HttpFailure('status', `Unexpected HTTP status ${response.status}`, response.status);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new HttpFailure(
        timedOut ? 'timeout' : 'json',
        timedOut ? `Response timed out after ${timeoutMs} ms` : 'Response was not valid JSON',
        response.status,
        { cause: error },
      );
    }
  } finally {
    clearTimeout(timer);
  }
}
