import { join } from 'node:path';
import log from 'electron-log/main';
import type { Logger } from '@shared/logger';
import { redactValue } from '@shared/redact';
import { rotateLogFile } from './logRotation';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;

export type AppLogger = Logger & { scope(name: string): Logger };

/**
 * File logging with rotation (5 files x 5 MB) under <userData>/logs and secret redaction applied to
 * every message before it reaches any transport.
 */
export function initLogging(logsDir: string, isDev: boolean): AppLogger {
  log.initialize();
  log.transports.file.resolvePathFn = () => join(logsDir, 'main.log');
  log.transports.file.maxSize = MAX_FILE_BYTES;
  log.transports.file.archiveLogFn = (file) => {
    try {
      rotateLogFile(file.path, MAX_FILES);
    } catch (error) {
      console.warn('log rotation failed', error);
    }
  };
  log.transports.file.level = 'info';
  log.transports.console.level = isDev ? 'debug' : 'warn';
  log.hooks.push((message) => ({
    ...message,
    data: message.data.map((entry) => redactValue(entry)),
  }));
  return log;
}
