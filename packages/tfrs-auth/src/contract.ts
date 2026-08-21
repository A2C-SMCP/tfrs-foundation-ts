/** TFRSManager contract registry mirror. Change the Manager source of truth first. */

export const CONTRACT_VERSION = "1.0";
export const PAT_PREFIX = "tfp_";

export const Scope = {
  ChatRead: "chat:read",
  ChatSend: "chat:send",
  ConfigRead: "config:read",
  ConfigWrite: "config:write",
  ConfigPublish: "config:publish",
  ActionExecute: "action:execute",
  A2aInvoke: "a2a:invoke",
  RobotAdmin: "robot:admin",
} as const;

export type Scope = (typeof Scope)[keyof typeof Scope];

export const ACTIVE_SCOPES = [
  Scope.ChatRead,
  Scope.ChatSend,
  Scope.ConfigRead,
  Scope.ConfigWrite,
  Scope.ConfigPublish,
  Scope.ActionExecute,
  Scope.A2aInvoke,
  Scope.RobotAdmin,
] as const satisfies readonly Scope[];

export const RESERVED_SCOPES = [
  "chat:send:multimodal",
  "action:execute:<type>",
] as const;

const activeScopeValues = new Set<string>(ACTIVE_SCOPES);

export function isActiveScope(name: string): name is Scope {
  return activeScopeValues.has(name);
}

export function scopesToString(scopes: Iterable<string>): string {
  return [...scopes].join(" ");
}

export function scopesFromString(value: string | null | undefined): string[] {
  return value?.trim() ? value.trim().split(/\s+/u) : [];
}

export const GrantType = {
  TokenExchange: "urn:ietf:params:oauth:grant-type:token-exchange",
  ClientCredentials: "client_credentials",
} as const;

export type GrantType = (typeof GrantType)[keyof typeof GrantType];

export const SubjectTokenType = {
  AccessToken: "urn:ietf:params:oauth:token-type:access_token",
  Jwt: "urn:ietf:params:oauth:token-type:jwt",
} as const;

export type SubjectTokenType =
  (typeof SubjectTokenType)[keyof typeof SubjectTokenType];

/** Optional token-exchange form field: token_profile=session (TFRM-189). */
export const TOKEN_PROFILE_FORM_FIELD = "token_profile";

/** Discrete token profiles; the Manager controls TTL per profile (TFRM-189). */
export const TokenProfile = {
  Session: "session",
} as const;

export type TokenProfile = (typeof TokenProfile)[keyof typeof TokenProfile];

const tokenProfileValues = new Set<string>(Object.values(TokenProfile));

export function isTokenProfile(value: unknown): value is TokenProfile {
  return typeof value === "string" && tokenProfileValues.has(value);
}

export const ISSUED_TOKEN_TYPE_JWT = SubjectTokenType.Jwt;
export const TOKEN_TYPE_BEARER = "Bearer";

export const OAuthErrorCode = {
  InvalidRequest: "invalid_request",
  InvalidGrant: "invalid_grant",
  InvalidClient: "invalid_client",
  InvalidTarget: "invalid_target",
  InvalidScope: "invalid_scope",
  UnsupportedGrantType: "unsupported_grant_type",
  TemporarilyUnavailable: "temporarily_unavailable",
  ServerError: "server_error",
} as const;

export type OAuthErrorCode =
  (typeof OAuthErrorCode)[keyof typeof OAuthErrorCode];

export const OAUTH_ERROR_HTTP_STATUS = {
  [OAuthErrorCode.InvalidRequest]: 400,
  [OAuthErrorCode.InvalidGrant]: 400,
  [OAuthErrorCode.InvalidTarget]: 400,
  [OAuthErrorCode.InvalidScope]: 400,
  [OAuthErrorCode.UnsupportedGrantType]: 400,
  [OAuthErrorCode.InvalidClient]: 401,
  [OAuthErrorCode.TemporarilyUnavailable]: 503,
  [OAuthErrorCode.ServerError]: 500,
} as const satisfies Readonly<Record<OAuthErrorCode, number>>;

export const HOUSE_PAYMENT_REQUIRED_CODE = 40_200;
export const HOUSE_PAYMENT_REDIRECT_FIELD = "redirectUrl";
export const SOCKETIO_AUTH_TOKEN_FIELD = "token";
export const HTTP_AUTHORIZATION_SCHEME = TOKEN_TYPE_BEARER;
export const JWKS_WELL_KNOWN_PATH = "/.well-known/jwks.json";
export const AS_METADATA_WELL_KNOWN_PATH =
  "/.well-known/oauth-authorization-server";
export const PR_METADATA_WELL_KNOWN_PATH =
  "/.well-known/oauth-protected-resource";
export const SIGNING_ALG = "RS256";
export const DEFAULT_KID = "tfrm-at-1";
export const ROBOT_PRINCIPAL_PREFIX = "robot:";
export const PUBLIC_ID_SEPARATOR = ":";
export const USER_PRINCIPAL_PREFIX = "user:";

export function publicId(orgSlug: string, employeeNo: string): string {
  return `${orgSlug}${PUBLIC_ID_SEPARATOR}${employeeNo}`;
}

export function robotAudience(orgSlug: string, employeeNo: string): string {
  return `${ROBOT_PRINCIPAL_PREFIX}${publicId(orgSlug, employeeNo)}`;
}

export const robotSubject = robotAudience;

export function userSubject(userId: number | string): string {
  return `${USER_PRINCIPAL_PREFIX}${String(userId)}`;
}

export type ClaimsValues = {
  iss: string;
  sub: string;
  aud: string;
  org: string;
  scope: string;
  exp: number;
  iat: number;
  jti: string;
  act: Record<string, unknown> | undefined;
  extra: Readonly<Record<string, unknown>>;
};

export class Claims implements ClaimsValues {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly org: string;
  readonly scope: string;
  readonly exp: number;
  readonly iat: number;
  readonly jti: string;
  readonly act: Record<string, unknown> | undefined;
  readonly extra: Readonly<Record<string, unknown>>;

  constructor(values: ClaimsValues) {
    this.iss = values.iss;
    this.sub = values.sub;
    this.aud = values.aud;
    this.org = values.org;
    this.scope = values.scope;
    this.exp = values.exp;
    this.iat = values.iat;
    this.jti = values.jti;
    this.act = values.act;
    this.extra = values.extra;
  }

  get scopes(): string[] {
    return scopesFromString(this.scope);
  }

  hasScope(scope: string): boolean {
    return this.scopes.includes(scope);
  }

  static fromPayload(payload: Readonly<Record<string, unknown>>): Claims {
    const known = new Set([
      "iss",
      "sub",
      "aud",
      "org",
      "scope",
      "exp",
      "iat",
      "jti",
      "act",
    ]);
    const audience = requiredAudience(payload.aud);
    const act = optionalRecord(payload.act, "act");

    return new Claims({
      iss: requiredString(payload.iss, "iss"),
      sub: requiredString(payload.sub, "sub"),
      aud: audience,
      org: requiredString(payload.org, "org"),
      scope: requiredString(payload.scope, "scope", true),
      exp: requiredNumericDate(payload.exp, "exp"),
      iat: requiredNumericDate(payload.iat, "iat"),
      jti: requiredString(payload.jti, "jti"),
      act,
      extra: Object.fromEntries(
        Object.entries(payload).filter(([key]) => !known.has(key)),
      ),
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  claim: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && value === "")) {
    throw new TypeError(`JWT claim ${claim} must be a${allowEmpty ? "" : " non-empty"} string`);
  }
  return value;
}

function requiredAudience(value: unknown): string {
  if (typeof value === "string" && value !== "") return value;
  if (Array.isArray(value)) {
    const [audience, ...additional] = value as unknown[];
    if (
      additional.length === 0 &&
      typeof audience === "string" &&
      audience !== ""
    ) {
      return audience;
    }
  }
  throw new TypeError("JWT claim aud must identify exactly one audience");
}

function requiredNumericDate(value: unknown, claim: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError(`JWT claim ${claim} must be a non-negative integer`);
  }
  return value;
}

function optionalRecord(
  value: unknown,
  claim: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new TypeError(`JWT claim ${claim} must be an object when present`);
  }
  return value;
}
