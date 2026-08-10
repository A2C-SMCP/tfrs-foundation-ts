import {
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from "jose";

import {
  Claims,
  DEFAULT_KID,
  SIGNING_ALG,
} from "./contract.js";
import {
  TokenVerificationError,
  TransportError,
} from "./errors.js";

export const DEFAULT_JWKS_CACHE_TTL_SECONDS = 300;
export const DEFAULT_MIN_REFRESH_INTERVAL_SECONDS = 10;

type JsonWebKeySet = { keys: readonly unknown[] };
type ImportedKey = Awaited<ReturnType<typeof importJWK>>;

export type JwtVerifierOptions = {
  issuer?: string;
  audience?: string;
  leewaySeconds?: number;
  fetch?: typeof globalThis.fetch;
  cacheTtlSeconds?: number;
  minRefreshIntervalSeconds?: number;
  clock?: () => number;
};

export type VerifyOptions = {
  audience?: string;
  requiredScope?: string;
  revocationWatermark?: number;
};

/** Framework-independent RS256 verifier backed by static or remote JWKS. */
export class JwtVerifier {
  private readonly issuer: string | undefined;
  private readonly audience: string | undefined;
  private readonly leewaySeconds: number;
  private readonly jwksUrl: string | undefined;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly cacheTtlSeconds: number;
  private readonly minRefreshIntervalSeconds: number;
  private readonly clock: () => number;
  private readonly staticKeys: boolean;
  private rawKeys = new Map<string, JWK>();
  private importedKeys = new Map<string, ImportedKey>();
  private fetchedAt = 0;
  private lastRefresh = Number.NEGATIVE_INFINITY;
  private refreshPromise: Promise<void> | undefined;

  private constructor(
    options: JwtVerifierOptions,
    source: { jwks?: JsonWebKeySet; jwksUrl?: string },
  ) {
    if (source.jwks === undefined && source.jwksUrl === undefined) {
      throw new TypeError("JwtVerifier requires jwks or jwksUrl");
    }
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.leewaySeconds = options.leewaySeconds ?? 0;
    this.jwksUrl = source.jwksUrl;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.cacheTtlSeconds =
      options.cacheTtlSeconds ?? DEFAULT_JWKS_CACHE_TTL_SECONDS;
    this.minRefreshIntervalSeconds =
      options.minRefreshIntervalSeconds ??
      DEFAULT_MIN_REFRESH_INTERVAL_SECONDS;
    this.clock = options.clock ?? (() => Date.now() / 1000);
    this.staticKeys = source.jwks !== undefined;
    if (source.jwks !== undefined) {
      this.rawKeys = indexJwks(source.jwks);
      this.fetchedAt = this.clock();
    }
  }

  static fromJwks(
    jwks: JsonWebKeySet,
    options: JwtVerifierOptions = {},
  ): JwtVerifier {
    return new JwtVerifier(options, { jwks });
  }

  static fromUrl(
    jwksUrl: string,
    options: JwtVerifierOptions = {},
  ): JwtVerifier {
    return new JwtVerifier(options, { jwksUrl });
  }

  async verify(token: string, options: VerifyOptions = {}): Promise<Claims> {
    let kid: string;
    try {
      kid = decodeProtectedHeader(token).kid ?? DEFAULT_KID;
    } catch (error) {
      throw new TokenVerificationError("JWT header cannot be decoded", {
        cause: error,
      });
    }

    const key = await this.keyFor(kid);
    const expectedAudience = options.audience ?? this.audience;
    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(token, key, {
        algorithms: [SIGNING_ALG],
        requiredClaims: [
          "iss",
          "sub",
          "aud",
          "org",
          "scope",
          "exp",
          "iat",
          "jti",
        ],
        clockTolerance: this.leewaySeconds,
        currentDate: new Date(this.clock() * 1000),
        ...(this.issuer === undefined ? {} : { issuer: this.issuer }),
        ...(expectedAudience === undefined
          ? {}
          : { audience: expectedAudience }),
      });
      payload = verified.payload;
    } catch (error) {
      throw new TokenVerificationError("JWT verification failed", {
        cause: error,
      });
    }

    let claims: Claims;
    try {
      claims = Claims.fromPayload(payload);
    } catch (error) {
      throw new TokenVerificationError("JWT claims do not match TFRS contract", {
        cause: error,
      });
    }
    if (
      options.requiredScope !== undefined &&
      !claims.hasScope(options.requiredScope)
    ) {
      throw new TokenVerificationError(
        `Insufficient scope: required=${options.requiredScope}, actual=${claims.scope || "(empty)"}`,
      );
    }
    if (
      options.revocationWatermark !== undefined &&
      options.revocationWatermark > 0 &&
      claims.iat < options.revocationWatermark
    ) {
      throw new TokenVerificationError(
        `Token was revoked: iat=${String(claims.iat)}, watermark=${String(options.revocationWatermark)}`,
      );
    }
    return claims;
  }

  private async keyFor(kid: string): Promise<ImportedKey> {
    const current = this.rawKeys.get(kid);
    if (this.staticKeys) {
      if (current === undefined) {
        throw new TokenVerificationError(`JWKS has no key matching kid=${kid}`);
      }
      return this.importKey(kid, current);
    }

    if (current !== undefined && !this.cacheIsStale()) {
      return this.importKey(kid, current);
    }

    if (this.refreshPromise !== undefined) {
      await this.refreshPromise;
    } else if (this.mayRefresh()) {
      await this.refresh();
    }
    const refreshed = this.rawKeys.get(kid);
    if (refreshed === undefined) {
      throw new TokenVerificationError(`JWKS has no key matching kid=${kid}`);
    }
    return this.importKey(kid, refreshed);
  }

  private async importKey(kid: string, jwk: JWK): Promise<ImportedKey> {
    const cached = this.importedKeys.get(kid);
    if (cached !== undefined) return cached;
    try {
      const key = await importJWK(jwk, SIGNING_ALG);
      this.importedKeys.set(kid, key);
      return key;
    } catch (error) {
      throw new TokenVerificationError(`JWK import failed for kid=${kid}`, {
        cause: error,
      });
    }
  }

  private cacheIsStale(): boolean {
    return (
      this.rawKeys.size === 0 ||
      this.clock() - this.fetchedAt >= this.cacheTtlSeconds
    );
  }

  private mayRefresh(): boolean {
    return (
      this.clock() - this.lastRefresh >= this.minRefreshIntervalSeconds
    );
  }

  private refresh(): Promise<void> {
    if (this.refreshPromise !== undefined) return this.refreshPromise;
    this.lastRefresh = this.clock();
    const promise = this.fetchJwks().then((jwks) => {
      this.rawKeys = indexJwks(jwks);
      this.importedKeys.clear();
      this.fetchedAt = this.clock();
    });
    this.refreshPromise = promise;
    const clearRefresh = (): void => {
      if (this.refreshPromise === promise) this.refreshPromise = undefined;
    };
    void promise.then(clearRefresh, clearRefresh);
    return promise;
  }

  private async fetchJwks(): Promise<JsonWebKeySet> {
    const jwksUrl = this.jwksUrl;
    if (jwksUrl === undefined) {
      throw new TypeError("Remote JwtVerifier requires jwksUrl");
    }
    let response: Response;
    try {
      response = await this.fetchFn(jwksUrl, {
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      throw new TransportError("JWKS request failed", { cause: error });
    }
    if (response.status !== 200) {
      throw new TransportError(
        `JWKS endpoint returned HTTP ${String(response.status)}`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new TokenVerificationError("JWKS response is not JSON", {
        cause: error,
      });
    }
    if (!isJsonWebKeySet(body)) {
      throw new TokenVerificationError("JWKS response has no keys array");
    }
    return body;
  }
}

function indexJwks(jwks: JsonWebKeySet): Map<string, JWK> {
  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    throw new TokenVerificationError("JWKS has no keys");
  }
  const result = new Map<string, JWK>();
  for (const value of jwks.keys) {
    if (!isJwk(value)) {
      throw new TokenVerificationError("JWKS contains an invalid key");
    }
    const key = value;
    result.set(key.kid ?? DEFAULT_KID, key);
  }
  if (result.size === 0) {
    throw new TokenVerificationError("JWKS has no usable keys");
  }
  return result;
}

function isJwk(value: unknown): value is JWK {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.kty !== "string" || candidate.kty === "") return false;
  return (
    candidate.kid === undefined ||
    (typeof candidate.kid === "string" && candidate.kid !== "")
  );
}

function isJsonWebKeySet(value: unknown): value is JsonWebKeySet {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { keys?: unknown }).keys)
  );
}
