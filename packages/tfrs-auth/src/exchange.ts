import {
  GrantType,
  HOUSE_PAYMENT_REDIRECT_FIELD,
  isTokenProfile,
  ISSUED_TOKEN_TYPE_JWT,
  SubjectTokenType,
  TOKEN_PROFILE_FORM_FIELD,
  TOKEN_TYPE_BEARER,
  type TokenProfile,
} from "./contract.js";
import {
  fromOAuthError,
  PaymentRequiredError,
  RateLimitedError,
  TokenExchangeError,
} from "./errors.js";

export type ExchangeResult = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
  issuedTokenType: string;
};

export function buildClientCredentialsForm(options: {
  clientId: string;
  clientSecret: string;
  audience: string;
  scope?: string | null | undefined;
}): Record<string, string> {
  return compactForm({
    grant_type: GrantType.ClientCredentials,
    client_id: options.clientId,
    client_secret: options.clientSecret,
    audience: options.audience,
    scope: options.scope,
  });
}

export function buildTokenExchangeForm(options: {
  subjectToken: string;
  subjectTokenType: string;
  audience: string;
  scope?: string | null | undefined;
  tokenProfile?: TokenProfile | null | undefined;
}): Record<string, string> {
  // Runtime guard for untyped callers; the Manager fails unknown profiles
  // with invalid_request, so reject them before they reach the wire. The
  // value itself is never echoed: a misplaced subject token must not leak
  // into error text.
  const tokenProfile: unknown = options.tokenProfile;
  if (
    tokenProfile !== undefined &&
    tokenProfile !== null &&
    !isTokenProfile(tokenProfile)
  ) {
    throw new TypeError(`Unknown token profile (${typeof tokenProfile})`);
  }
  return compactForm({
    grant_type: GrantType.TokenExchange,
    subject_token: options.subjectToken,
    subject_token_type: options.subjectTokenType,
    audience: options.audience,
    scope: options.scope,
    [TOKEN_PROFILE_FORM_FIELD]: options.tokenProfile,
  });
}

export function parseTokenResponse(
  status: number,
  body: unknown,
): ExchangeResult {
  if (status === 200) {
    return parseSuccess(body);
  }
  if (status === 429) {
    throw new RateLimitedError(undefined, { httpStatus: status });
  }
  if (status === 402) {
    throw paymentRequired(body);
  }

  const record = asRecord(body);
  const fallback = status >= 500 ? "server_error" : "invalid_request";
  const code = nonEmptyString(record?.error) ?? fallback;
  const description = optionalString(record?.error_description);
  throw fromOAuthError(code, {
    httpStatus: status,
    description,
    retryable: status >= 500 && status < 600,
  });
}

function parseSuccess(body: unknown): ExchangeResult {
  const record = asRecord(body);
  if (record === undefined) {
    throw new TokenExchangeError(
      "token_exchange_error",
      "Token response is not a JSON object",
      { httpStatus: 200 },
    );
  }
  const accessToken = nonEmptyString(record.access_token);
  if (accessToken === undefined) {
    throw new TokenExchangeError(
      "token_exchange_error",
      "Token response is missing access_token",
      { httpStatus: 200 },
    );
  }
  const expiresIn = Number(record.expires_in ?? 0);
  if (!Number.isFinite(expiresIn) || expiresIn < 0) {
    throw new TokenExchangeError(
      "token_exchange_error",
      "Token response has an invalid expires_in",
      { httpStatus: 200 },
    );
  }
  return {
    accessToken,
    tokenType: optionalString(record.token_type) ?? TOKEN_TYPE_BEARER,
    expiresIn,
    scope: optionalString(record.scope) ?? "",
    issuedTokenType:
      optionalString(record.issued_token_type) ?? ISSUED_TOKEN_TYPE_JWT,
  };
}

function paymentRequired(body: unknown): PaymentRequiredError {
  const record = asRecord(body);
  const data = asRecord(record?.data);
  const message = firstString(record, "message", "msg", "error_description");
  const renewUrl =
    firstString(
      data,
      HOUSE_PAYMENT_REDIRECT_FIELD,
      "renewUrl",
      "renew_url",
      "url",
    ) ??
    firstString(
      record,
      HOUSE_PAYMENT_REDIRECT_FIELD,
      "renewUrl",
      "renew_url",
    );
  return new PaymentRequiredError(message, { renewUrl });
}

function compactForm(
  values: Readonly<Record<string, string | null | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string] => Boolean(entry[1]),
    ),
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
    ? String(value)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  const result = optionalString(value);
  return result === "" ? undefined : result;
}

function firstString(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = nonEmptyString(record?.[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export { SubjectTokenType };
