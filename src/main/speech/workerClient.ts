import { Worker } from 'node:worker_threads';
import type { Logger } from '@shared/logger';
import type { ResultOf, WorkerRequestBody, WorkerResponse, WorkerResult } from './protocol';

/** One speech worker thread (the engine owns one for synthesis and one for recognition). */
export interface SpeechWorker {
  readonly alive: boolean;
  request<T extends WorkerResult['type']>(
    body: WorkerRequestBody,
    expect: T,
    transfer?: ArrayBuffer[],
  ): Promise<ResultOf<T>>;
  /** Stops the thread; everything it held in memory is returned to the system. */
  terminate(): Promise<void>;
}

export type SpeechWorkerFactory = () => SpeechWorker;

interface Pending {
  expect: WorkerResult['type'];
  resolve: (result: WorkerResult) => void;
  reject: (error: Error) => void;
}

/** Runs the speech worker script in a real worker thread. */
export function createWorkerThread(scriptPath: string, logger: Logger): SpeechWorker {
  const worker = new Worker(scriptPath);
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let alive = true;

  const failAll = (error: Error): void => {
    alive = false;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  worker.on('message', (response: WorkerResponse) => {
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (!response.ok) {
      entry.reject(new Error(response.error));
    } else if (response.result.type !== entry.expect) {
      entry.reject(new Error(`Unexpected speech worker reply: ${response.result.type}`));
    } else {
      entry.resolve(response.result);
    }
  });
  worker.on('error', (error) => {
    logger.error('Speech worker crashed', error);
    failAll(error instanceof Error ? error : new Error(String(error)));
  });
  worker.on('exit', (code) => {
    if (alive) logger.warn(`Speech worker exited with code ${code}`);
    failAll(new Error('The speech engine stopped unexpectedly'));
  });

  return {
    get alive() {
      return alive;
    },
    request<T extends WorkerResult['type']>(
      body: WorkerRequestBody,
      expect: T,
      transfer: ArrayBuffer[] = [],
    ): Promise<ResultOf<T>> {
      if (!alive) return Promise.reject(new Error('The speech engine is not running'));
      const id = nextId;
      nextId += 1;
      return new Promise<ResultOf<T>>((resolve, reject) => {
        pending.set(id, { expect, resolve: resolve as Pending['resolve'], reject });
        worker.postMessage({ ...body, id }, transfer);
      });
    },
    async terminate(): Promise<void> {
      if (!alive) return;
      alive = false;
      const stopped = new Error('The speech engine was stopped');
      for (const entry of pending.values()) entry.reject(stopped);
      pending.clear();
      await worker.terminate();
    },
  };
}
