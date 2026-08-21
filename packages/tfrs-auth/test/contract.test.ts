import { describe, expect, it } from "vitest";

import * as contract from "../src/contract.js";

describe("Python parity: test_contract.py", () => {
  it("locks active scopes exactly and in order", () => {
    expect(contract.ACTIVE_SCOPES).toEqual([
      "chat:read",
      "chat:send",
      "config:read",
      "config:write",
      "config:publish",
      "action:execute",
      "a2a:invoke",
      "robot:admin",
    ]);
  });

  it("locks reserved scopes exactly", () => {
    expect(contract.RESERVED_SCOPES).toEqual([
      "chat:send:multimodal",
      "action:execute:<type>",
    ]);
  });

  it("uses default-deny active scope lookup", () => {
    expect(contract.isActiveScope("a2a:invoke")).toBe(true);
    expect(contract.isActiveScope("robot:admin")).toBe(true);
    expect(contract.isActiveScope("chat:send:multimodal")).toBe(false);
    expect(contract.isActiveScope("totally:unknown")).toBe(false);
  });

  it("locks grant and subject-token URNs", () => {
    expect(contract.GrantType.TokenExchange).toBe(
      "urn:ietf:params:oauth:grant-type:token-exchange",
    );
    expect(contract.GrantType.ClientCredentials).toBe("client_credentials");
    expect(contract.SubjectTokenType.AccessToken).toBe(
      "urn:ietf:params:oauth:token-type:access_token",
    );
    expect(contract.SubjectTokenType.Jwt).toBe(
      "urn:ietf:params:oauth:token-type:jwt",
    );
    expect(contract.ISSUED_TOKEN_TYPE_JWT).toBe(
      "urn:ietf:params:oauth:token-type:jwt",
    );
    expect(contract.TOKEN_TYPE_BEARER).toBe("Bearer");
  });

  it("locks OAuth error to HTTP status mapping", () => {
    expect(contract.OAUTH_ERROR_HTTP_STATUS).toEqual({
      invalid_request: 400,
      invalid_grant: 400,
      invalid_client: 401,
      invalid_target: 400,
      invalid_scope: 400,
      unsupported_grant_type: 400,
      temporarily_unavailable: 503,
      server_error: 500,
    });
  });

  it("locks JWKS, kid, algorithm, and discovery constants", () => {
    expect(contract.JWKS_WELL_KNOWN_PATH).toBe("/.well-known/jwks.json");
    expect(contract.AS_METADATA_WELL_KNOWN_PATH).toBe(
      "/.well-known/oauth-authorization-server",
    );
    expect(contract.PR_METADATA_WELL_KNOWN_PATH).toBe(
      "/.well-known/oauth-protected-resource",
    );
    expect(contract.SIGNING_ALG).toBe("RS256");
    expect(contract.DEFAULT_KID).toBe("tfrm-at-1");
    expect(contract.CONTRACT_VERSION).toBe("1.0");
  });

  it("locks auth field names", () => {
    expect(contract.SOCKETIO_AUTH_TOKEN_FIELD).toBe("token");
    expect(contract.HTTP_AUTHORIZATION_SCHEME).toBe("Bearer");
  });

  it("locks the house payment-required envelope", () => {
    expect(contract.HOUSE_PAYMENT_REQUIRED_CODE).toBe(40_200);
    expect(contract.HOUSE_PAYMENT_REDIRECT_FIELD).toBe("redirectUrl");
  });

  it("formats principal and audience helpers", () => {
    expect(contract.publicId("turingfocus", "000042")).toBe(
      "turingfocus:000042",
    );
    expect(contract.robotAudience("turingfocus", "000042")).toBe(
      "robot:turingfocus:000042",
    );
    expect(contract.robotSubject("turingfocus", "000101")).toBe(
      "robot:turingfocus:000101",
    );
    expect(contract.userSubject(7)).toBe("user:7");
  });

  it("preserves employee-number leading zeroes", () => {
    expect(contract.publicId("turingfocus", "000042")).toBe(
      "turingfocus:000042",
    );
    expect(contract.publicId("testorg", "42")).toBe("testorg:42");
    expect(contract.publicId("acme-corp", "00123")).toBe(
      "acme-corp:00123",
    );
  });

  it("round-trips scope strings", () => {
    const value = contract.scopesToString([
      contract.Scope.A2aInvoke,
      "chat:read",
    ]);
    expect(value).toBe("a2a:invoke chat:read");
    expect(contract.scopesFromString(value)).toEqual([
      "a2a:invoke",
      "chat:read",
    ]);
    expect(contract.scopesFromString("")).toEqual([]);
    expect(contract.scopesFromString(undefined)).toEqual([]);
  });

  it("constructs claims and preserves future fields", () => {
    const claims = contract.Claims.fromPayload({
      iss: "https://issuer",
      sub: "robot:turingfocus:000001",
      aud: "robot:turingfocus:000002",
      org: "5",
      scope: "a2a:invoke chat:read",
      exp: 1_300,
      iat: 1_000,
      jti: "x",
      future_field: "kept",
    });
    expect(claims.sub).toBe("robot:turingfocus:000001");
    expect(claims.org).toBe("5");
    expect(claims.scopes).toEqual(["a2a:invoke", "chat:read"]);
    expect(claims.hasScope("a2a:invoke")).toBe(true);
    expect(claims.hasScope("robot:admin")).toBe(false);
    expect(claims.extra.future_field).toBe("kept");
  });

  it("accepts a one-element audience array", () => {
    const claims = contract.Claims.fromPayload({
      iss: "https://issuer",
      sub: "robot:turingfocus:000001",
      aud: ["robot:turingfocus:000009"],
      org: "5",
      scope: "",
      exp: 1_300,
      iat: 1_000,
      jti: "x",
    });
    expect(claims.aud).toBe("robot:turingfocus:000009");
  });

  it("rejects incomplete or wrongly typed claim payloads", () => {
    expect(() => contract.Claims.fromPayload({})).toThrow(TypeError);
    expect(() =>
      contract.Claims.fromPayload({
        iss: "https://issuer",
        sub: "robot:turingfocus:000001",
        aud: "robot:turingfocus:000002",
        org: 5,
        scope: "a2a:invoke",
        exp: 1_300,
        iat: 1_000,
        jti: "x",
      }),
    ).toThrow(/org/u);
  });
});

describe("TypeScript additions: session token profile contract (TFRM-189)", () => {
  it("locks the token profile wire field and session value", () => {
    expect(contract.TOKEN_PROFILE_FORM_FIELD).toBe("token_profile");
    expect(contract.TokenProfile.Session).toBe("session");
  });

  it("default-deny token profile lookup", () => {
    expect(contract.isTokenProfile(contract.TokenProfile.Session)).toBe(true);
    expect(contract.isTokenProfile("banana")).toBe(false);
    expect(contract.isTokenProfile(42)).toBe(false);
    expect(contract.isTokenProfile(null)).toBe(false);
    expect(contract.isTokenProfile(undefined)).toBe(false);
  });
});
