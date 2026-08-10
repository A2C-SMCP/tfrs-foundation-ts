import { describe, expect, it, vi } from "vitest";

import {
  buildTokenExchangeForm,
  CachingTokenSource,
  GrantType,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  PatCredential,
  PaymentRequiredError,
  RateLimitedError,
  SubjectTokenType,
  type TokenExchangeError,
} from "../src/index.js";

const TOKEN_URL = "https://user.example.test/api/v1/oauth/token";
const expectedForm = {
  grant_type: GrantType.TokenExchange,
  subject_token: "tfp_pat_secret",
  subject_token_type: SubjectTokenType.AccessToken,
  audience: "robot:turingfocus:000042",
  scope: "config:read",
};

function credential(): PatCredential {
  return new PatCredential({
    pat: "tfp_pat_secret",
    audience: "robot:turingfocus:000042",
    scope: "config:read",
  });
}

function success(): Response {
  return Response.json({
    access_token: "header.payload.sig",
    issued_token_type: SubjectTokenType.Jwt,
    token_type: "Bearer",
    expires_in: 300,
    scope: "config:read",
  });
}

describe("Python parity: test_pat.py", () => {
  it("normalizes the subject-token type constant", () => {
    expect(
      buildTokenExchangeForm({
        subjectToken: "tfp_pat_secret",
        subjectTokenType: SubjectTokenType.AccessToken,
        audience: "robot:turingfocus:000042",
        scope: "config:read",
      }),
    ).toEqual(expectedForm);
  });

  it("accepts a bare subject-token type and omits absent scope", () => {
    const form = buildTokenExchangeForm({
      subjectToken: "tfp_pat_secret",
      subjectTokenType: "urn:ietf:params:oauth:token-type:access_token",
      audience: "robot:turingfocus:000042",
    });
    expect(form).not.toHaveProperty("scope");
    expect(form.grant_type).toBe(GrantType.TokenExchange);
    expect(form.subject_token_type).toBe(SubjectTokenType.AccessToken);
  });

  it("builds the exact PAT credential form", () => {
    expect(credential().requestForm()).toEqual(expectedForm);
  });

  it.each([undefined, ""])("omits empty scope %s", (scope) => {
    const form = new PatCredential({
      pat: "tfp_x",
      audience: "robot:turingfocus:000009",
      ...(scope === undefined ? {} : { scope }),
    }).requestForm();
    expect(form).not.toHaveProperty("scope");
  });

  it("exchanges PAT over exact form wire and parses the result", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.headers.get("content-type")).toContain(
        "application/x-www-form-urlencoded",
      );
      expect(Object.fromEntries(new URLSearchParams(await request.text()))).toEqual(
        expectedForm,
      );
      return success();
    });
    const token = await new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
      clock: () => 1_000,
    }).token();
    expect(token).toMatchObject({
      accessToken: "header.payload.sig",
      tokenType: "Bearer",
      scope: "config:read",
      issuedTokenType: SubjectTokenType.Jwt,
      expiresAt: 1_300,
    });
  });

  it.each([
    [400, "invalid_grant", InvalidGrantError],
    [400, "invalid_target", InvalidTargetError],
    [400, "invalid_scope", InvalidScopeError],
  ] as const)("maps %i %s to its typed error", async (status, code, ErrorClass) => {
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: vi.fn(async () =>
        Response.json({ error: code, error_description: "fixed" }, { status }),
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

  it("maps 429 to retryable RateLimitedError", async () => {
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: vi.fn(async () => new Response(null, { status: 429 })),
      maxRetries: 0,
    });
    try {
      await source.token();
      expect.fail("expected RateLimitedError");
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitedError);
      expect((error as TokenExchangeError).retryable).toBe(true);
    }
  });

  it("maps the Manager 402 envelope for PAT", async () => {
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: vi.fn(async () =>
        Response.json(
          { message: "组织订阅已冻结", data: { redirectUrl: "https://pay" } },
          { status: 402 },
        ),
      ),
      maxRetries: 0,
    });
    await expect(source.token()).rejects.toMatchObject({
      name: new PaymentRequiredError().name,
      httpStatus: 402,
      renewUrl: "https://pay",
    });
  });
});
