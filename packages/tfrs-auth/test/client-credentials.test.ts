import { describe, expect, it, vi } from "vitest";

import {
  CachingTokenSource,
  ClientCredentials,
  InvalidClientError,
  InvalidScopeError,
  InvalidTargetError,
  PaymentRequiredError,
  RateLimitedError,
  Scope,
  TokenExchangeError,
} from "../src/index.js";

const TOKEN_URL = "https://user.example.test/api/v1/oauth/token";

function credential(): ClientCredentials {
  return ClientCredentials.forRobot({
    clientId: "turingfocus:000101",
    clientSecret: "tfp_secret",
    calleeOrgSlug: "turingfocus",
    calleeEmployeeNo: "000042",
    scope: [Scope.A2aInvoke],
  });
}

function success(): Response {
  return Response.json({
    access_token: "header.payload.sig",
    issued_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_type: "Bearer",
    expires_in: 300,
    scope: "a2a:invoke",
  });
}

describe("Python parity: test_client_credentials.py", () => {
  it("builds the exact request form", () => {
    expect(credential().requestForm()).toEqual({
      grant_type: "client_credentials",
      client_id: "turingfocus:000101",
      client_secret: "tfp_secret",
      audience: "robot:turingfocus:000042",
      scope: "a2a:invoke",
    });
  });

  it("omits an absent scope", () => {
    const form = new ClientCredentials({
      clientId: "turingfocus:000005",
      clientSecret: "tfp_x",
      audience: "robot:turingfocus:000009",
    }).requestForm();
    expect(form).not.toHaveProperty("scope");
    expect(form.audience).toBe("robot:turingfocus:000009");
  });

  it("exchanges, parses metadata, and posts exact form-urlencoded wire", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.headers.get("content-type")).toContain(
        "application/x-www-form-urlencoded",
      );
      expect(Object.fromEntries(new URLSearchParams(await request.text()))).toEqual(
        credential().requestForm(),
      );
      return success();
    });
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
      clock: () => 1_000,
    });
    const token = await source.token();
    expect(token.accessToken).toBe("header.payload.sig");
    expect(token.tokenType).toBe("Bearer");
    expect(token.scope).toBe("a2a:invoke");
    expect(token.issuedTokenType).toBe(
      "urn:ietf:params:oauth:token-type:jwt",
    );
    expect(token.expiresIn(1_000)).toBe(300);
  });

  it.each([
    [401, "invalid_client", InvalidClientError],
    [400, "invalid_target", InvalidTargetError],
    [400, "invalid_scope", InvalidScopeError],
  ] as const)("maps %i %s to its typed error", async (status, code, ErrorClass) => {
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: vi.fn(async () =>
        Response.json(
          { error: code, error_description: "fixed description" },
          { status },
        ),
      ),
      maxRetries: 0,
    });
    try {
      await source.token();
      expect.fail("expected exchange error");
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorClass);
      expect((error as TokenExchangeError).code).toBe(code);
      expect((error as TokenExchangeError).httpStatus).toBe(status);
    }
  });

  it("maps 429 to a retryable RateLimitedError when retries are disabled", async () => {
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: vi.fn(async () => new Response(null, { status: 429 })),
      maxRetries: 0,
    });
    await expect(source.token()).rejects.toMatchObject({
      name: new RateLimitedError().name,
      retryable: true,
    });
  });

  it("maps the Manager 402 envelope", async () => {
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: vi.fn(async () =>
        Response.json(
          {
            code: 40_200,
            message: "组织订阅已冻结，请续费后重试",
            data: { redirectUrl: "https://pay" },
          },
          { status: 402 },
        ),
      ),
      maxRetries: 0,
    });
    try {
      await source.token();
      expect.fail("expected PaymentRequiredError");
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentRequiredError);
      expect((error as PaymentRequiredError).httpStatus).toBe(402);
      expect((error as PaymentRequiredError).renewUrl).toBe("https://pay");
      expect(String(error)).toContain("冻结");
    }
  });

  it.each([
    ["a non-object body", Response.json(["not", "an", "object"])],
    ["missing access_token", Response.json({ expires_in: 300 })],
    ["an empty access_token", Response.json({ access_token: "" })],
    ["a negative expires_in", Response.json({ access_token: "jwt", expires_in: -1 })],
    ["a non-numeric expires_in", Response.json({ access_token: "jwt", expires_in: "never" })],
    ["invalid JSON", new Response("not-json", { status: 200 })],
  ])("rejects a successful response with %s", async (_label, response) => {
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: vi.fn(async () => response),
      maxRetries: 0,
    });
    await expect(source.token()).rejects.toMatchObject({
      name: new TokenExchangeError().name,
      httpStatus: 200,
      retryable: false,
    });
  });

  it("applies contract defaults when optional success fields are absent", async () => {
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: vi.fn(async () => Response.json({ access_token: "jwt" })),
      maxRetries: 0,
      clock: () => 1_000,
    });
    const token = await source.token();
    expect(token).toMatchObject({
      accessToken: "jwt",
      tokenType: "Bearer",
      issuedTokenType: "urn:ietf:params:oauth:token-type:jwt",
      scope: "",
      expiresAt: 1_000,
    });
  });
});
