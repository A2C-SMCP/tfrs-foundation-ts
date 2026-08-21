import { describe, expect, it, vi } from "vitest";

import {
  buildTokenExchangeForm,
  CachingTokenSource,
  ClientCredentials,
  GrantType,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  PatCredential,
  PaymentRequiredError,
  RateLimitedError,
  SubjectTokenType,
  type TokenExchangeError,
  TokenProfile,
  UserJwtCredential,
} from "../src/index.js";

const TOKEN_URL = "https://user.example.test/api/v1/oauth/token";
const USER_JWT = "eyJhbGci.payload.sig";
const expectedForm = {
  grant_type: GrantType.TokenExchange,
  subject_token: USER_JWT,
  subject_token_type: SubjectTokenType.Jwt,
  audience: "robot:turingfocus:000042",
  scope: "config:read",
};

function credential(): UserJwtCredential {
  return new UserJwtCredential({
    userJwt: USER_JWT,
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

describe("Python parity: test_user_jwt.py", () => {
  it("normalizes the JWT subject-token type constant", () => {
    expect(
      buildTokenExchangeForm({
        subjectToken: USER_JWT,
        subjectTokenType: SubjectTokenType.Jwt,
        audience: "robot:turingfocus:000042",
        scope: "config:read",
      }),
    ).toEqual(expectedForm);
  });

  it("accepts a bare JWT token type and omits absent scope", () => {
    const form = buildTokenExchangeForm({
      subjectToken: USER_JWT,
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      audience: "robot:turingfocus:000042",
    });
    expect(form).not.toHaveProperty("scope");
    expect(form.grant_type).toBe(GrantType.TokenExchange);
    expect(form.subject_token_type).toBe(SubjectTokenType.Jwt);
  });

  it("builds the exact User JWT credential form", () => {
    expect(credential().requestForm()).toEqual(expectedForm);
  });

  it.each([undefined, ""])("omits empty scope %s", (scope) => {
    const form = new UserJwtCredential({
      userJwt: USER_JWT,
      audience: "robot:turingfocus:000009",
      ...(scope === undefined ? {} : { scope }),
    }).requestForm();
    expect(form).not.toHaveProperty("scope");
  });

  it("exchanges User JWT over exact form wire and parses the result", async () => {
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

  it("preserves invalid_grant description", async () => {
    const source = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: vi.fn(async () =>
        Response.json(
          { error: "invalid_grant", error_description: "subject JWT 已撤销" },
          { status: 400 },
        ),
      ),
      maxRetries: 0,
    });
    try {
      await source.token();
      expect.fail("expected InvalidGrantError");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidGrantError);
      expect((error as TokenExchangeError).description).toContain("撤销");
      expect(String(error)).toContain("撤销");
    }
  });

  it("maps 429 to retryable RateLimitedError", async () => {
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

  it("maps the Manager 402 envelope for User JWT", async () => {
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

describe("TypeScript additions: session token profile (TFRM-189)", () => {
  const sessionForm = {
    ...expectedForm,
    token_profile: "session",
  };

  function sessionCredential(): UserJwtCredential {
    return new UserJwtCredential({
      userJwt: USER_JWT,
      audience: "robot:turingfocus:000042",
      scope: "config:read",
      tokenProfile: TokenProfile.Session,
    });
  }

  it("adds token_profile=session to the exchange form when requested", () => {
    expect(
      buildTokenExchangeForm({
        subjectToken: USER_JWT,
        subjectTokenType: SubjectTokenType.Jwt,
        audience: "robot:turingfocus:000042",
        scope: "config:read",
        tokenProfile: TokenProfile.Session,
      }),
    ).toEqual(sessionForm);
  });

  it("omits token_profile by default (5-minute profile zero regression)", () => {
    expect(
      buildTokenExchangeForm({
        subjectToken: USER_JWT,
        subjectTokenType: SubjectTokenType.Jwt,
        audience: "robot:turingfocus:000042",
        scope: "config:read",
      }),
    ).toEqual(expectedForm);
    expect(
      buildTokenExchangeForm({
        subjectToken: USER_JWT,
        subjectTokenType: SubjectTokenType.Jwt,
        audience: "robot:turingfocus:000042",
        scope: "config:read",
        tokenProfile: null,
      }),
    ).toEqual(expectedForm);
    expect(expectedForm).not.toHaveProperty("token_profile");
  });

  it("renders the session profile through UserJwtCredential", () => {
    expect(sessionCredential().requestForm()).toEqual(sessionForm);
  });

  it("rejects an unknown token profile at the form boundary", () => {
    expect(() =>
      buildTokenExchangeForm({
        subjectToken: USER_JWT,
        subjectTokenType: SubjectTokenType.Jwt,
        audience: "robot:turingfocus:000042",
        tokenProfile: "banana" as unknown as TokenProfile,
      }),
    ).toThrow(TypeError);
    expect(() =>
      buildTokenExchangeForm({
        subjectToken: USER_JWT,
        subjectTokenType: SubjectTokenType.Jwt,
        audience: "robot:turingfocus:000042",
        tokenProfile: "banana" as unknown as TokenProfile,
      }),
    ).toThrow(/token profile/u);
  });

  it("rejects an unknown token profile from a credential at request time", () => {
    const credential = new UserJwtCredential({
      userJwt: USER_JWT,
      audience: "robot:turingfocus:000042",
      tokenProfile: "banana" as unknown as TokenProfile,
    });
    expect(() => credential.requestForm()).toThrow(/token profile/u);
  });

  it("never echoes a misplaced subject JWT through the profile guard", () => {
    try {
      buildTokenExchangeForm({
        subjectToken: USER_JWT,
        subjectTokenType: SubjectTokenType.Jwt,
        audience: "robot:turingfocus:000042",
        tokenProfile: USER_JWT as unknown as TokenProfile,
      });
      expect.fail("expected TypeError");
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(String(error)).not.toContain(USER_JWT);
    }
  });

  it("exchanges a session-profile User JWT and honors the server expires_in", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(
        Object.fromEntries(new URLSearchParams(await request.text())),
      ).toEqual(sessionForm);
      return Response.json({
        access_token: "session.header.payload.sig",
        issued_token_type: SubjectTokenType.Jwt,
        token_type: "Bearer",
        // Deliberately not the Manager default (43200): a hardcoded session
        // TTL in the SDK would still pass if the fixture used 43_200.
        expires_in: 43_201,
        scope: "config:read",
      });
    });
    const token = await new CachingTokenSource(sessionCredential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
      clock: () => 1_000,
    }).token();
    expect(token).toMatchObject({
      accessToken: "session.header.payload.sig",
      expiresAt: 1_000 + 43_201,
    });
  });

  it("keeps session and default profile caches isolated per source", async () => {
    const sessionForms: Record<string, string>[] = [];
    const defaultForms: Record<string, string>[] = [];
    const sessionFetch = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      sessionForms.push(
        Object.fromEntries(new URLSearchParams(await request.text())),
      );
      return Response.json({
        access_token: "session-token",
        issued_token_type: SubjectTokenType.Jwt,
        token_type: "Bearer",
        expires_in: 43_200,
        scope: "config:read",
      });
    });
    const defaultFetch = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      defaultForms.push(
        Object.fromEntries(new URLSearchParams(await request.text())),
      );
      return Response.json({
        access_token: "default-token",
        issued_token_type: SubjectTokenType.Jwt,
        token_type: "Bearer",
        expires_in: 300,
        scope: "config:read",
      });
    });
    const sessionSource = new CachingTokenSource(sessionCredential(), {
      tokenUrl: TOKEN_URL,
      fetch: sessionFetch,
    });
    const defaultSource = new CachingTokenSource(credential(), {
      tokenUrl: TOKEN_URL,
      fetch: defaultFetch,
    });
    expect((await sessionSource.token()).accessToken).toBe("session-token");
    expect((await sessionSource.token()).accessToken).toBe("session-token");
    expect((await defaultSource.token()).accessToken).toBe("default-token");
    expect((await sessionSource.token()).accessToken).not.toBe(
      (await defaultSource.token()).accessToken,
    );
    expect(sessionFetch).toHaveBeenCalledTimes(1);
    expect(defaultFetch).toHaveBeenCalledTimes(1);
    expect(sessionForms[0]).toHaveProperty("token_profile", "session");
    expect(defaultForms[0]).not.toHaveProperty("token_profile");
  });

  it("never leaks the subject JWT or access token into error text", async () => {
    const accessToken = "session.header.payload.sig";
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          access_token: accessToken,
          issued_token_type: SubjectTokenType.Jwt,
          token_type: "Bearer",
          expires_in: 43_201,
          scope: "config:read",
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: "invalid_grant", error_description: "subject revoked" },
          { status: 400 },
        ),
      );
    const source = new CachingTokenSource(sessionCredential(), {
      tokenUrl: TOKEN_URL,
      fetch: fetchFn,
      maxRetries: 0,
    });
    // First obtain the real access token so it exists in the source state,
    // then force a failing exchange: neither token may surface in errors.
    expect((await source.token()).accessToken).toBe(accessToken);
    source.invalidate();
    try {
      await source.token();
      expect.fail("expected InvalidGrantError");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidGrantError);
      expect(String(error)).not.toContain(USER_JWT);
      expect(String(error)).not.toContain(accessToken);
    }
  });

  it("keeps machine identities unable to express a token profile at the type boundary", () => {
    const machineClient = new ClientCredentials({
      clientId: "turingfocus:000101",
      clientSecret: "tfp_secret",
      audience: "robot:turingfocus:000042",
      // @ts-expect-error machine identities cannot request a token profile
      tokenProfile: TokenProfile.Session,
    });
    // @ts-expect-error ClientCredentials is a machine identity: no tokenProfile option
    void machineClient.tokenProfile;
    const machinePat = new PatCredential({
      pat: "tfp_123",
      audience: "robot:turingfocus:000042",
      // @ts-expect-error machine identities cannot request a token profile
      tokenProfile: TokenProfile.Session,
    });
    // @ts-expect-error PatCredential is a machine identity: no tokenProfile option
    void machinePat.tokenProfile;
  });
});
