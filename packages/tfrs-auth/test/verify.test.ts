import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  JwtVerifier,
  TokenVerificationError,
  TransportError,
} from "../src/index.js";

const ISSUER = "https://user.example.test";
const AUDIENCE = "robot:turingfocus:000042";
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const NOW = 1_000;

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let publicJwk: JWK;
let otherPublicJwk: JWK;

beforeAll(async () => {
  const primary = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  privateKey = primary.privateKey;
  otherPrivateKey = other.privateKey;
  publicJwk = {
    ...(await exportJWK(primary.publicKey)),
    kid: "tfrm-at-1",
    alg: "RS256",
    use: "sig",
  };
  otherPublicJwk = {
    ...(await exportJWK(other.publicKey)),
    kid: "rotated-key",
    alg: "RS256",
    use: "sig",
  };
});

type SignOptions = {
  key?: CryptoKey;
  kid?: string;
  issuer?: string;
  audience?: string;
  scope?: string;
  issuedAt?: number;
  expiresAt?: number;
  jti?: string;
};

async function sign(options: SignOptions = {}): Promise<string> {
  const issuedAt = options.issuedAt ?? NOW;
  return new SignJWT({
    org: "7",
    scope: options.scope ?? "a2a:invoke",
    jti: options.jti ?? "test-jti-1",
  })
    .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "tfrm-at-1" })
    .setIssuer(options.issuer ?? ISSUER)
    .setSubject("robot:turingfocus:000101")
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(options.expiresAt ?? issuedAt + 300)
    .sign(options.key ?? privateKey);
}

function staticVerifier(options: { issuer?: string; audience?: string } = {}): JwtVerifier {
  return JwtVerifier.fromJwks(
    { keys: [publicJwk] },
    {
      ...(options.issuer === undefined ? { issuer: ISSUER } : { issuer: options.issuer }),
      ...(options.audience === undefined
        ? { audience: AUDIENCE }
        : { audience: options.audience }),
      clock: () => NOW,
    },
  );
}

function validPayload(): JWTPayload {
  return {
    iss: ISSUER,
    sub: "robot:turingfocus:000101",
    aud: AUDIENCE,
    org: "7",
    scope: "a2a:invoke",
    exp: NOW + 300,
    iat: NOW,
    jti: "test-jti-1",
  };
}

async function signPayload(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "tfrm-at-1" })
    .sign(privateKey);
}

describe("Python parity: test_verify.py", () => {
  it("verifies a real RS256 roundtrip with static JWKS", async () => {
    const claims = await staticVerifier().verify(await sign());
    expect(claims.sub).toBe("robot:turingfocus:000101");
    expect(claims.aud).toBe(AUDIENCE);
    expect(claims.org).toBe("7");
    expect(claims.hasScope("a2a:invoke")).toBe(true);
    expect(claims.jti).toBe("test-jti-1");
  });

  it("rejects an expired token", async () => {
    await expect(
      staticVerifier().verify(
        await sign({ issuedAt: NOW - 310, expiresAt: NOW - 10 }),
      ),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it("rejects a wrong issuer", async () => {
    const verifier = JwtVerifier.fromJwks(
      { keys: [publicJwk] },
      { issuer: "https://evil.example", audience: AUDIENCE, clock: () => NOW },
    );
    await expect(verifier.verify(await sign())).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("rejects a wrong audience override", async () => {
    await expect(
      staticVerifier().verify(await sign(), {
        audience: "robot:turingfocus:000999",
      }),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it("rejects an unknown kid with static JWKS", async () => {
    await expect(
      staticVerifier().verify(await sign({ kid: "kid-not-in-jwks" })),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it("rejects a forged signature that reuses the valid kid", async () => {
    await expect(
      staticVerifier().verify(await sign({ key: otherPrivateKey })),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it("rejects a tampered payload", async () => {
    const parts = (await sign()).split(".");
    const header = parts[0] ?? "";
    const payload = parts[1] ?? "";
    const signature = parts[2] ?? "";
    const tampered = `${header}.${payload.slice(0, -2)}AA.${signature}`;
    await expect(staticVerifier().verify(tampered)).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("fetches remote JWKS once", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({ keys: [publicJwk] }),
    );
    const verifier = JwtVerifier.fromUrl(JWKS_URL, {
      issuer: ISSUER,
      audience: AUDIENCE,
      fetch: fetchFn,
      clock: () => NOW,
    });
    expect((await verifier.verify(await sign())).sub).toBe(
      "robot:turingfocus:000101",
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("caches remote JWKS across verifications", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({ keys: [publicJwk] }),
    );
    const verifier = JwtVerifier.fromUrl(JWKS_URL, {
      issuer: ISSUER,
      audience: AUDIENCE,
      fetch: fetchFn,
      clock: () => NOW,
    });
    await verifier.verify(await sign());
    await verifier.verify(await sign({ jti: "another" }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("skips issuer comparison when issuer is omitted", async () => {
    const verifier = JwtVerifier.fromJwks(
      { keys: [publicJwk] },
      { audience: AUDIENCE, clock: () => NOW },
    );
    expect((await verifier.verify(await sign({ issuer: "https://whatever" }))).iss).toBe(
      "https://whatever",
    );
  });

  it("accepts any audience when audience is omitted", async () => {
    const verifier = JwtVerifier.fromJwks(
      { keys: [publicJwk] },
      { issuer: ISSUER, clock: () => NOW },
    );
    expect(
      (await verifier.verify(
        await sign({ audience: "robot:turingfocus:099999" }),
      )).aud,
    ).toBe("robot:turingfocus:099999");
  });

  it("rate-limits unknown-kid JWKS refresh", async () => {
    let now = NOW;
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({ keys: [publicJwk] }),
    );
    const verifier = JwtVerifier.fromUrl(JWKS_URL, {
      issuer: ISSUER,
      audience: AUDIENCE,
      fetch: fetchFn,
      clock: () => now,
      minRefreshIntervalSeconds: 10,
    });
    await expect(verifier.verify(await sign({ kid: "unknown-1" }))).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
    now = NOW + 5;
    await expect(verifier.verify(await sign({ kid: "unknown-2" }))).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now = NOW + 20;
    await expect(verifier.verify(await sign({ kid: "unknown-3" }))).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((await verifier.verify(await sign())).sub).toBe(
      "robot:turingfocus:000101",
    );
  });

  it("accepts a satisfied required scope", async () => {
    const claims = await staticVerifier().verify(
      await sign({ scope: "a2a:invoke chat:read" }),
      { requiredScope: "a2a:invoke" },
    );
    expect(claims.hasScope("a2a:invoke")).toBe(true);
  });

  it("rejects an insufficient required scope", async () => {
    await expect(
      staticVerifier().verify(await sign({ scope: "chat:read" }), {
        requiredScope: "a2a:invoke",
      }),
    ).rejects.toThrow(/scope/u);
  });

  it("rejects an empty scope when a scope is required", async () => {
    await expect(
      staticVerifier().verify(await sign({ scope: "" }), {
        requiredScope: "chat:read",
      }),
    ).rejects.toThrow(/scope/u);
  });

  it("does not check scope when requiredScope is absent", async () => {
    expect((await staticVerifier().verify(await sign({ scope: "" }))).sub).toBe(
      "robot:turingfocus:000101",
    );
  });

  it("accepts a token issued after the revocation watermark", async () => {
    expect(
      (await staticVerifier().verify(await sign(), {
        revocationWatermark: NOW - 60,
      })).sub,
    ).toBe("robot:turingfocus:000101");
  });

  it("rejects a token issued before the revocation watermark", async () => {
    await expect(
      staticVerifier().verify(
        await sign({ issuedAt: NOW - 120, expiresAt: NOW + 180 }),
        { revocationWatermark: NOW - 60 },
      ),
    ).rejects.toThrow(/revoked/u);
  });

  it("does not check revocation when watermark is absent", async () => {
    expect(
      (await staticVerifier().verify(
        await sign({ issuedAt: NOW - 120, expiresAt: NOW + 180 }),
      )).sub,
    ).toBe("robot:turingfocus:000101");
  });

  it("treats revocation watermark zero as unset", async () => {
    expect(
      (await staticVerifier().verify(
        await sign({ issuedAt: NOW - 120, expiresAt: NOW + 180 }),
        { revocationWatermark: 0 },
      )).sub,
    ).toBe("robot:turingfocus:000101");
  });

  it("combines satisfied scope and revocation checks", async () => {
    const claims = await staticVerifier().verify(
      await sign({ scope: "a2a:invoke chat:read" }),
      { requiredScope: "chat:read", revocationWatermark: NOW - 60 },
    );
    expect(claims.hasScope("chat:read")).toBe(true);
    expect(claims.hasScope("a2a:invoke")).toBe(true);
  });

  it("fails combined checks when scope fails", async () => {
    await expect(
      staticVerifier().verify(await sign({ scope: "chat:read" }), {
        requiredScope: "a2a:invoke",
        revocationWatermark: NOW - 60,
      }),
    ).rejects.toThrow(/scope/u);
  });

  it("fails combined checks when revocation fails", async () => {
    await expect(
      staticVerifier().verify(
        await sign({ issuedAt: NOW - 120, expiresAt: NOW + 180 }),
        { requiredScope: "a2a:invoke", revocationWatermark: NOW - 60 },
      ),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it("rejects every missing or wrongly typed TFRS claim", async () => {
    const verifier = staticVerifier();
    for (const claim of ["iss", "sub", "aud", "org", "scope", "exp", "iat", "jti"]) {
      const payload = validPayload();
      Reflect.deleteProperty(payload, claim);
      await expect(verifier.verify(await signPayload(payload))).rejects.toBeInstanceOf(
        TokenVerificationError,
      );
    }
    const invalidClaims: readonly (readonly [string, unknown])[] = [
      ["org", 7],
      ["jti", 7],
      ["scope", ["a2a:invoke"]],
      ["aud", [AUDIENCE, "robot:turingfocus:000099"]],
      ["act", "not-an-object"],
    ];
    for (const [claim, value] of invalidClaims) {
      const payload = validPayload();
      Reflect.set(payload, claim, value);
      await expect(verifier.verify(await signPayload(payload))).rejects.toBeInstanceOf(
        TokenVerificationError,
      );
    }
  });

  it("shares one cold-start refresh across concurrent verifications", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchFn = vi.fn<typeof fetch>(async () => {
      await gate;
      return Response.json({ keys: [publicJwk] });
    });
    const verifier = JwtVerifier.fromUrl(JWKS_URL, {
      issuer: ISSUER,
      audience: AUDIENCE,
      fetch: fetchFn,
      clock: () => NOW,
    });
    const token = await sign();
    const pending = Array.from({ length: 5 }, async () => verifier.verify(token));
    release?.();
    expect(await Promise.all(pending)).toHaveLength(5);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh for a concurrently arriving rotated kid", async () => {
    let now = NOW;
    let calls = 0;
    const fetchFn = vi.fn<typeof fetch>(async () => {
      calls += 1;
      return Response.json({
        keys: calls === 1 ? [publicJwk] : [publicJwk, otherPublicJwk],
      });
    });
    const verifier = JwtVerifier.fromUrl(JWKS_URL, {
      issuer: ISSUER,
      audience: AUDIENCE,
      fetch: fetchFn,
      clock: () => now,
      minRefreshIntervalSeconds: 10,
    });
    await verifier.verify(await sign());
    now += 20;
    const rotated = await sign({ key: otherPrivateKey, kid: "rotated-key" });
    expect(
      await Promise.all(
        Array.from({ length: 5 }, async () => verifier.verify(rotated)),
      ),
    ).toHaveLength(5);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("maps malformed remote JWKS inputs to TokenVerificationError", async () => {
    const malformedSets: unknown[] = [
      { keys: [] },
      { keys: [null] },
      { keys: [7] },
      { keys: [{}] },
      { keys: [{ kty: "RSA", kid: 7 }] },
      { keys: [{ kty: "RSA", kid: "tfrm-at-1", n: "bad", e: "bad" }] },
    ];
    const token = await sign();
    for (const body of malformedSets) {
      const verifier = JwtVerifier.fromUrl(JWKS_URL, {
        issuer: ISSUER,
        audience: AUDIENCE,
        fetch: vi.fn(async () => Response.json(body)),
        clock: () => NOW,
      });
      await expect(verifier.verify(token)).rejects.toBeInstanceOf(
        TokenVerificationError,
      );
    }
  });

  it("maps JWKS network and HTTP failures to TransportError", async () => {
    const token = await sign();
    const networkError = new TypeError("connection reset");
    const networkVerifier = JwtVerifier.fromUrl(JWKS_URL, {
      fetch: vi.fn(async () => Promise.reject(networkError)),
      clock: () => NOW,
    });
    await expect(networkVerifier.verify(token)).rejects.toMatchObject({
      name: new TransportError().name,
      cause: networkError,
    });

    const httpVerifier = JwtVerifier.fromUrl(JWKS_URL, {
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
      clock: () => NOW,
    });
    try {
      await httpVerifier.verify(token);
      expect.fail("expected JWKS transport error");
    } catch (error) {
      expect(error).toBeInstanceOf(TransportError);
      expect((error as Error).message).toContain("503");
    }
  });

  it("rejects non-JSON JWKS and responses without a keys array", async () => {
    const token = await sign();
    for (const response of [
      new Response("not-json"),
      Response.json({ not_keys: [] }),
    ]) {
      const verifier = JwtVerifier.fromUrl(JWKS_URL, {
        fetch: vi.fn(async () => response),
        clock: () => NOW,
      });
      await expect(verifier.verify(token)).rejects.toBeInstanceOf(
        TokenVerificationError,
      );
    }
  });
});
