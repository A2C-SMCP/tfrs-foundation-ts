import { describe, expect, it, vi } from "vitest";

import {
  CachingTokenSource,
  ClientCredentials,
  InvalidClientError,
  TemporarilyUnavailableError,
  TransportError,
} from "../src/index.js";

const TOKEN_URL = "https://user.example.test/api/v1/oauth/token";

function credential(): ClientCredentials {
  return new ClientCredentials({
    clientId: "turingfocus:000101",
    clientSecret: "tfp_secret",
    audience: "robot:turingfocus:000042",
  });
}

function tokenResponse(accessToken: string, expiresIn = 300): Response {
  return Response.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    scope: "a2a:invoke",
    issued_token_type: "urn:ietf:params:oauth:token-type:jwt",
  });
}

describe("Python parity: test_client_cache.py", () => {
  it("cache hit returns the same token without a second call", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => tokenResponse("jwt-A"));
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
    });
    const first = await source.token();
    expect(await source.token()).toBe(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the cached token is near expiry", async () => {
    let now = 1_000;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("jwt-A", 100))
      .mockResolvedValueOnce(tokenResponse("jwt-B", 100));
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
      clock: () => now,
      expirySkewSeconds: 30,
    });
    const first = await source.token();
    expect(await source.token()).toBe(first);
    now = 1_071;
    expect((await source.token()).accessToken).toBe("jwt-B");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("allows only one exchange under concurrency", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchFn = vi.fn<typeof fetch>(async () => {
      await gate;
      return tokenResponse("jwt-shared");
    });
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
    });
    const pending = Array.from({ length: 8 }, async () => source.token());
    release?.();
    const tokens = await Promise.all(pending);
    expect(tokens).toHaveLength(8);
    expect(tokens.every((token) => token.accessToken === "jwt-shared")).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient error and then succeeds", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: "temporarily_unavailable" }, { status: 503 }),
      )
      .mockResolvedValueOnce(tokenResponse("jwt-after-retry"));
    const sleep = vi.fn(async () => Promise.resolve());
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
      maxRetries: 2,
      backoffBaseMs: 25,
      sleep,
    });
    expect((await source.token()).accessToken).toBe("jwt-after-retry");
    expect(sleep).toHaveBeenCalledWith(25);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("raises after the transient retry budget is exhausted", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({ error: "temporarily_unavailable" }, { status: 503 }),
    );
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
      maxRetries: 1,
      sleep: vi.fn(async () => Promise.resolve()),
    });
    await expect(source.token()).rejects.toBeInstanceOf(
      TemporarilyUnavailableError,
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable error", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({ error: "invalid_client" }, { status: 401 }),
    );
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
      maxRetries: 3,
      sleep: vi.fn(async () => Promise.resolve()),
    });
    await expect(source.token()).rejects.toBeInstanceOf(InvalidClientError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("invalidate forces the next token call to exchange again", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("jwt-A"))
      .mockResolvedValueOnce(tokenResponse("jwt-B"));
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
    });
    const first = await source.token();
    source.invalidate();
    const second = await source.token();
    expect(second).not.toBe(first);
    expect(second.accessToken).toBe("jwt-B");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries generic gateway 5xx responses within the same budget", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(tokenResponse("jwt-after-gateway"));
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
      maxRetries: 1,
      sleep: vi.fn(async () => Promise.resolve()),
    });
    expect((await source.token()).accessToken).toBe("jwt-after-gateway");
  });

  it("stops generic 5xx retries at the configured budget", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 500 }),
    );
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
      maxRetries: 2,
      sleep: vi.fn(async () => Promise.resolve()),
    });
    await expect(source.token()).rejects.toMatchObject({
      code: "server_error",
      retryable: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("maps network failures to TransportError and retries them", async () => {
    const networkError = new TypeError("socket closed");
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(tokenResponse("jwt-after-network-error"));
    const sleep = vi.fn(async () => Promise.resolve());
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
      maxRetries: 1,
      sleep,
    });

    expect((await source.token()).accessToken).toBe("jwt-after-network-error");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);

    const failed = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: vi.fn(async () => Promise.reject(networkError)),
      maxRetries: 0,
    });
    await expect(failed.token()).rejects.toMatchObject({
      name: new TransportError().name,
      cause: networkError,
    });
  });

  it("rejects an invalid retry budget during construction", () => {
    expect(
      () =>
        new CachingTokenSource(credential(), {
          tokenUrl: TOKEN_URL,
          maxRetries: -1,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new CachingTokenSource(credential(), {
          tokenUrl: TOKEN_URL,
          maxRetries: 1.5,
        }),
    ).toThrow(/non-negative integer/u);
  });
});
