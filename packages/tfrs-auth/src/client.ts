import { parseTokenResponse, type ExchangeResult } from "./exchange.js";
import { TokenExchangeError, TransportError } from "./errors.js";
import type { Credential } from "./credentials.js";

export const DEFAULT_EXPIRY_SKEW_SECONDS = 30;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_BACKOFF_BASE_MS = 500;
export const DEFAULT_BACKOFF_FACTOR = 2;

export class Token {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly scope: string;
  readonly issuedTokenType: string;
  readonly expiresAt: number;

  constructor(values: {
    accessToken: string;
    tokenType: string;
    scope: string;
    issuedTokenType: string;
    expiresAt: number;
  }) {
    this.accessToken = values.accessToken;
    this.tokenType = values.tokenType;
    this.scope = values.scope;
    this.issuedTokenType = values.issuedTokenType;
    this.expiresAt = values.expiresAt;
  }

  isExpired(skewSeconds = 0, nowSeconds = Date.now() / 1000): boolean {
    return nowSeconds >= this.expiresAt - skewSeconds;
  }

  expiresIn(nowSeconds = Date.now() / 1000): number {
    return this.expiresAt - nowSeconds;
  }

  static fromExchange(result: ExchangeResult, issuedAt: number): Token {
    return new Token({
      accessToken: result.accessToken,
      tokenType: result.tokenType,
      scope: result.scope,
      issuedTokenType: result.issuedTokenType,
      expiresAt: issuedAt + result.expiresIn,
    });
  }
}

export type TokenSource = {
  token(): Promise<Token>;
  invalidate(): void;
};

export type CachingTokenSourceOptions = {
  tokenUrl: string;
  fetch?: typeof globalThis.fetch;
  expirySkewSeconds?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  backoffFactor?: number;
  clock?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

type InflightExchange = {
  generation: number;
  promise: Promise<Token>;
};

/** Cached asynchronous token source with early refresh and single-flight exchange. */
export class CachingTokenSource implements TokenSource {
  private readonly credential: Credential;
  private readonly tokenUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly expirySkewSeconds: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly clock: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private cached: Token | undefined;
  private generation = 0;
  private inflight: InflightExchange | undefined;

  constructor(credential: Credential, options: CachingTokenSourceOptions) {
    this.credential = credential;
    this.tokenUrl = options.tokenUrl;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.expirySkewSeconds =
      options.expirySkewSeconds ?? DEFAULT_EXPIRY_SKEW_SECONDS;
    this.clock = options.clock ?? (() => Date.now() / 1000);
    this.sleep = options.sleep ?? defaultSleep;
    this.retryDelaysMs = retryDelays(
      options.maxRetries ?? DEFAULT_MAX_RETRIES,
      options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
      options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR,
    );
  }

  token(): Promise<Token> {
    if (this.cached !== undefined && !this.isStale(this.cached)) {
      return Promise.resolve(this.cached);
    }

    const generation = this.generation;
    if (this.inflight?.generation === generation) {
      return this.inflight.promise;
    }

    const promise = this.exchangeWithRetry().then((token) => {
      if (this.generation === generation) this.cached = token;
      return token;
    });
    const inflight = { generation, promise };
    this.inflight = inflight;
    const clearInflight = (): void => {
      if (this.inflight === inflight) this.inflight = undefined;
    };
    void promise.then(clearInflight, clearInflight);
    return promise;
  }

  invalidate(): void {
    this.generation += 1;
    this.cached = undefined;
  }

  private isStale(token: Token): boolean {
    return token.isExpired(this.expirySkewSeconds, this.clock());
  }

  private async exchangeWithRetry(): Promise<Token> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.exchange();
      } catch (error) {
        const delay = this.retryDelaysMs[attempt];
        if (!isRetryable(error) || delay === undefined) throw error;
        await this.sleep(delay);
      }
    }
  }

  private async exchange(): Promise<Token> {
    let response: Response;
    try {
      response = await this.fetchFn(this.tokenUrl, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new URLSearchParams(this.credential.requestForm()),
      });
    } catch (error) {
      throw new TransportError("Token endpoint request failed", { cause: error });
    }
    const body = await safeJson(response);
    const result = parseTokenResponse(response.status, body);
    return Token.fromExchange(result, this.clock());
  }
}

function retryDelays(
  maxRetries: number,
  baseMilliseconds: number,
  factor: number,
): number[] {
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError("maxRetries must be a non-negative integer");
  }
  return Array.from(
    { length: maxRetries },
    (_, index) => baseMilliseconds * factor ** index,
  );
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof TransportError ||
    (error instanceof TokenExchangeError && error.retryable)
  );
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
