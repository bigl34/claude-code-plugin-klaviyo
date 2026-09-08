
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterPercent: number;
  retryableErrors: string[];
  timeoutMs: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  nextDelayMs?: (ctx: { attempt: number; error: unknown; baseDelayMs: number; maxDelayMs: number }) => number;
  operationKind?: 'read' | 'write';
  isPreSendError?: (error: unknown) => boolean;
  sleepImpl?: (ms: number) => Promise<void>;
  logger?: (message: string) => void;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  jitterPercent: 0.2,
  timeoutMs: 60000,
  retryableErrors: [
    '429',
    '500',
    '502',
    '503',
    '504',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'fetch failed',
    'AbortError',
    'socket hang up',
    'network error',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
  ],
};

export const RETRY_CONFIGS = {
  qdrant: {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
  } as RetryConfig,

  openai: {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: 3,
    baseDelayMs: 5000,
    maxDelayMs: 120000,
    retryableErrors: [
      ...DEFAULT_RETRY_CONFIG.retryableErrors,
      'rate_limit',
      'Rate limit',
    ],
  } as RetryConfig,

  slack: {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    retryableErrors: [
      ...DEFAULT_RETRY_CONFIG.retryableErrors,
      'rate_limited',
      'ratelimited',
    ],
  } as RetryConfig,

  notion: {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    retryableErrors: [
      ...DEFAULT_RETRY_CONFIG.retryableErrors,
      'conflict_error',
    ],
  } as RetryConfig,
};

export function calculateBackoff(
  attempt: number,
  config: Pick<RetryConfig, 'baseDelayMs' | 'maxDelayMs' | 'jitterPercent'>
): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);

  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  const jitterRange = cappedDelay * config.jitterPercent;
  const jitter = jitterRange * (Math.random() * 2 - 1);

  return Math.round(cappedDelay + jitter);
}

export function isRetryableError(
  error: Error | any,
  retryablePatterns: string[]
): boolean {
  const errorString = String(error?.message || error?.code || error || '').toLowerCase();
  const errorName = String(error?.name || '').toLowerCase();
  const statusCode = String(error?.status || error?.statusCode || '');

  return retryablePatterns.some(pattern => {
    if (/^\d+$/.test(pattern)) {
      return statusCode === pattern;
    }
    const p = pattern.toLowerCase();
    return (
      errorString.includes(p) ||
      errorName.includes(p)
    );
  });
}

export function isPreSendNetworkError(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null | undefined;
  const code = e?.cause?.code ?? e?.code;
  const ALLOW = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'EAI_NONAME', 'EAI_NODATA']);
  return typeof code === 'string' && ALLOW.has(code);
}

function isWriteRetryable(
  error: unknown,
  operationKind: RetryConfig['operationKind'],
  isPreSendError: RetryConfig['isPreSendError']
): boolean {
  if (operationKind !== 'write') return true;
  if ((isPreSendError ?? isPreSendNetworkError)(error)) return true;
  const rawStatus = (error as { status?: number | string; statusCode?: number | string })?.status
    ?? (error as { statusCode?: number | string })?.statusCode;
  return Number(rawStatus) === 429;
}

const RETRY_AFTER_MAX_MS = 300_000;

export function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function clampNextDelayMs(delayMs: number | undefined, maxDelayMs: number): number {
  const rawDelayMs = delayMs ?? 0;
  if (!Number.isFinite(rawDelayMs)) return 0;
  return Math.max(0, Math.min(maxDelayMs, rawDelayMs));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  context?: string
): Promise<RetryResult<T>> {
  const cfg: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  let lastError: Error | undefined;
  let attempts = 0;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    attempts = attempt + 1;

    try {
      const data = await operation();
      return {
        success: true,
        data,
        attempts,
        totalDelayMs,
      };
    } catch (error: unknown) {
      const err = error as Error & Record<string, unknown>;
      lastError = err;

      let isRetryable = cfg.shouldRetry ? cfg.shouldRetry(error, attempt) : isRetryableError(error, cfg.retryableErrors);
      isRetryable = isRetryable && isWriteRetryable(error, cfg.operationKind, cfg.isPreSendError);
      const hasRetriesLeft = attempt < cfg.maxRetries;

      if (isRetryable && hasRetriesLeft) {
        const delayMs = cfg.nextDelayMs
          ? clampNextDelayMs(cfg.nextDelayMs({ attempt, error, baseDelayMs: cfg.baseDelayMs, maxDelayMs: cfg.maxDelayMs }), cfg.maxDelayMs)
          : calculateBackoff(attempt, cfg);
        totalDelayMs += delayMs;

        const contextStr = context ? `[${context}] ` : '';
        const formattedMessage =
          `${contextStr}Retryable error (attempt ${attempt + 1}/${cfg.maxRetries + 1}): ` +
          `${err.message || error}. Waiting ${(delayMs / 1000).toFixed(1)}s...`;
        (cfg.logger ?? console.error)(formattedMessage);

        await (cfg.sleepImpl ?? sleep)(delayMs);
      } else {
        break;
      }
    }
  }

  return {
    success: false,
    error: lastError,
    attempts,
    totalDelayMs,
  };
}

export async function withRetryThrow<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  context?: string
): Promise<T> {
  const result = await withRetry(operation, config, context);

  if (result.success) {
    return result.data as T;
  }

  const contextStr = context ? `[${context}] ` : '';
  const error = new Error(
    `${contextStr}Operation failed after ${result.attempts} attempts: ${result.error?.message}`
  );
  const err = error as Error & Record<string, unknown>;
  err.cause = result.error;
  err.attempts = result.attempts;
  err.totalDelayMs = result.totalDelayMs;

  throw error;
}

export function createTimeoutController(timeoutMs: number): {
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    controller,
    timeoutId,
    cleanup: () => clearTimeout(timeoutId),
  };
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  config: Partial<RetryConfig> = {},
  context?: string
): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase();
  const isSafeMethod = method === 'GET' || method === 'HEAD';
  const cfg: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
    operationKind: config.operationKind ?? (isSafeMethod ? 'read' : 'write'),
  };
  if (!config.nextDelayMs) {
    const backoffMaxDelayMs = cfg.maxDelayMs;
    cfg.maxDelayMs = Math.max(cfg.maxDelayMs, RETRY_AFTER_MAX_MS);
    cfg.nextDelayMs = ({ attempt, error }) => {
      const retryAfterMs = (error as { retryAfterMs?: number } | null | undefined)?.retryAfterMs;
      if (typeof retryAfterMs === 'number' && retryAfterMs >= 0) {
        return Math.min(retryAfterMs, RETRY_AFTER_MAX_MS);
      }
      return calculateBackoff(attempt, { ...cfg, maxDelayMs: backoffMaxDelayMs });
    };
  }

  return withRetryThrow(
    async () => {
      const { controller, cleanup } = createTimeoutController(cfg.timeoutMs);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        if (!response.ok) {
          const statusStr = String(response.status);
          if (cfg.retryableErrors.includes(statusStr)) {
            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
            const err = error as Error & Record<string, unknown>;
            err.status = response.status;
            if (response.status === 429) {
              const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
              if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
            }
            throw error;
          }
        }

        return response;
      } finally {
        cleanup();
      }
    },
    cfg,
    context
  );
}
