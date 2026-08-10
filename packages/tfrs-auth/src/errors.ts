import { OAuthErrorCode } from "./contract.js";

export class TfrsAuthError extends Error {
  override readonly name: string = "TfrsAuthError";
}

export class TransportError extends TfrsAuthError {
  override readonly name = "TransportError";
}

export class TokenVerificationError extends TfrsAuthError {
  override readonly name = "TokenVerificationError";
}

export class DiscoveryError extends TfrsAuthError {
  override readonly name = "DiscoveryError";
}

export type TokenExchangeErrorOptions = {
  httpStatus?: number | undefined;
  description?: string | undefined;
  retryable?: boolean | undefined;
  cause?: unknown;
};

export class TokenExchangeError extends TfrsAuthError {
  override readonly name: string = "TokenExchangeError";
  readonly code: string;
  readonly httpStatus: number | undefined;
  readonly description: string | undefined;
  readonly retryable: boolean;

  constructor(
    code = "token_exchange_error",
    message?: string,
    options: TokenExchangeErrorOptions = {},
  ) {
    super(message ?? options.description ?? code, { cause: options.cause });
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.description = options.description;
    this.retryable = options.retryable ?? false;
  }
}

type ExchangeErrorConstructor = new (
  message?: string,
  options?: TokenExchangeErrorOptions,
) => TokenExchangeError;

function typedExchangeError(
  name: string,
  code: string,
  retryable = false,
): ExchangeErrorConstructor {
  return class extends TokenExchangeError {
    override readonly name = name;

    constructor(message?: string, options: TokenExchangeErrorOptions = {}) {
      super(code, message, {
        ...options,
        retryable: options.retryable ?? retryable,
      });
    }
  };
}

export const InvalidRequestError = typedExchangeError(
  "InvalidRequestError",
  OAuthErrorCode.InvalidRequest,
);
export const InvalidGrantError = typedExchangeError(
  "InvalidGrantError",
  OAuthErrorCode.InvalidGrant,
);
export const InvalidClientError = typedExchangeError(
  "InvalidClientError",
  OAuthErrorCode.InvalidClient,
);
export const InvalidTargetError = typedExchangeError(
  "InvalidTargetError",
  OAuthErrorCode.InvalidTarget,
);
export const InvalidScopeError = typedExchangeError(
  "InvalidScopeError",
  OAuthErrorCode.InvalidScope,
);
export const UnsupportedGrantTypeError = typedExchangeError(
  "UnsupportedGrantTypeError",
  OAuthErrorCode.UnsupportedGrantType,
);
export const TemporarilyUnavailableError = typedExchangeError(
  "TemporarilyUnavailableError",
  OAuthErrorCode.TemporarilyUnavailable,
  true,
);
export const ServerError = typedExchangeError(
  "ServerError",
  OAuthErrorCode.ServerError,
);
export const RateLimitedError = typedExchangeError(
  "RateLimitedError",
  "rate_limited",
  true,
);

export class PaymentRequiredError extends TokenExchangeError {
  override readonly name = "PaymentRequiredError";
  readonly renewUrl: string | undefined;

  constructor(
    message?: string,
    options: TokenExchangeErrorOptions & {
      renewUrl?: string | undefined;
    } = {},
  ) {
    super("payment_required", message, { ...options, httpStatus: 402 });
    this.renewUrl = options.renewUrl;
  }
}

const errorClassByCode: Readonly<Record<string, ExchangeErrorConstructor>> = {
  [OAuthErrorCode.InvalidRequest]: InvalidRequestError,
  [OAuthErrorCode.InvalidGrant]: InvalidGrantError,
  [OAuthErrorCode.InvalidClient]: InvalidClientError,
  [OAuthErrorCode.InvalidTarget]: InvalidTargetError,
  [OAuthErrorCode.InvalidScope]: InvalidScopeError,
  [OAuthErrorCode.UnsupportedGrantType]: UnsupportedGrantTypeError,
  [OAuthErrorCode.TemporarilyUnavailable]: TemporarilyUnavailableError,
  [OAuthErrorCode.ServerError]: ServerError,
};

export function fromOAuthError(
  code: string,
  options: TokenExchangeErrorOptions = {},
): TokenExchangeError {
  const ErrorClass = errorClassByCode[code];
  return ErrorClass === undefined
    ? new TokenExchangeError(code, undefined, options)
    : new ErrorClass(undefined, options);
}
