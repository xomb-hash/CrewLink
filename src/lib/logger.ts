type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogPayload {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

const SENSITIVE_KEYS = new Set([
  'accesstoken',
  'refreshtoken',
  'access_token',
  'refresh_token',
  'accesstokenciphertext',
  'refreshtokenciphertext',
  'token',
  'secret',
  'clientsecret',
  'client_secret',
  'webhooksecret',
  'webhook_secret',
  'password',
  'apppassword',
  'authorization',
  'cookie',
  'privatekey',
  'pendingoauthciphertext',
]);

function maskSensitiveData(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[DepthLimit]';
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => maskSensitiveData(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      sanitized[key] = maskSensitiveData(val, depth + 1);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

export class Logger {
  private formatMessage(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
    err?: Error | unknown
  ): string {
    const payload: LogPayload = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (meta && Object.keys(meta).length > 0) {
      payload.context = maskSensitiveData(meta) as Record<string, unknown>;
    }

    if (err instanceof Error) {
      payload.error = {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    } else if (err) {
      payload.error = {
        message: String(err),
      };
    }

    if (process.env.NODE_ENV === 'test') {
      // Keep test output clean unless explicit debug
      return JSON.stringify(payload);
    }

    return JSON.stringify(payload);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'production') return; // skip debug in production
    console.debug(this.formatMessage('debug', message, meta));
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'test') return;
    console.info(this.formatMessage('info', message, meta));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'test') return;
    console.warn(this.formatMessage('warn', message, meta));
  }

  error(message: string, err?: unknown, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'test') return;
    console.error(this.formatMessage('error', message, meta, err));
  }
}

export const logger = new Logger();
export default logger;
